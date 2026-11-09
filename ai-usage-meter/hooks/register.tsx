import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {} from '../types/index'
import type { Cell } from './format'
import {
  BAR_HEIGHT_PX,
  BAR_WIDTH_PX,
  DEFAULT_LANG,
  LOGO_PX,
  SPIN_ICON_PX,
  barAlt,
  barSvg,
  columnWidths,
  isLang,
  logoSvg,
  partsOf,
  refreshAlt,
  refreshSvg,
  rowsFor,
} from './format'
import { activeProviders } from './providers'
import type { Provider } from './providers'
import { pullFromStore, put, refreshDue } from './readings'

const TICK_MS = 30_000

// 새로고침 버튼. 첫 줄(Codex)의 오른쪽 끝에 두고, 첫 줄만 그 자리(사이 한 칸 포함)를 빼고 잰다.
// 터미널은 글자 하나, 데스크톱은 앱의 버튼으로 그려져 폭을 알 수 없어 넉넉히 4칸(약 32px)으로 잡는다.
const REFRESH_KEY = 'refresh'
const REFRESH_LABEL = '↻'
// 데스크톱 버튼의 글자. 앱은 버튼의 label만 그리고(자식은 버린다) 글자색을 바꿀 길이 없어, 보이지 않는 전각 폭 공백(em space)을 둔다.
// 폭은 글자 크기 하나라 ↻ 그림(14px)이 들어갈 자리가 되고, 쉴 때와 도는 때가 같은 글자라 버튼 크기가 바뀌지 않는다.
const REFRESH_LABEL_APP = ' '
const REFRESH_CELLS_TERMINAL = 2
const REFRESH_CELLS_APP = 4
// 조회가 도는 동안 터미널 버튼에 돌려 그리는 글자. 터미널은 글자를 바꿔 그릴 수밖에 없어, 잘게 나눈 10장을 빠르게 돌린다.
// 모두 ↻처럼 한 칸이라(모호 폭이 아님) 도는 동안 줄이 흔들리지 않는다. 데스크톱은 스스로 도는 SVG를 그린다(refreshSvg).
const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const SPIN_MS = 80

const readings = { plugin: 'ai-usage-meter', key: 'readings' } as const
const attempts = { plugin: 'ai-usage-meter', key: 'attempts' } as const

// 버튼으로 시작한 조회가 도는 동안은 버튼이 돌고, 다시 눌러도 겹쳐 돌지 않는다. 끝나면 ↻로 돌아온다.
// 잠깐의 표시라 세션 상태에 두지 않는다. register마다 새로 만들어, 다시 읽으면(reload) 도는 채로 멈춰 남지 않는다.
// drawsTerminal: 터미널이 밴드를 그린 적이 있다. 글자를 바꿔 그리는 회전은 터미널에만 필요하다.
type Spin = { isRefreshing: boolean; frame: number; drawsTerminal: boolean }

async function refreshNow($: EngineInterface, providers: Provider[], spin: Spin): Promise<void> {
  if (spin.isRefreshing) return
  spin.isRefreshing = true
  spin.frame = 0
  $.ui.invalidate('ui.render')
  // 데스크톱의 그림은 스스로 돈다. 다시 그리면 그림이 처음 각도부터 다시 돌아 제자리에서 떨리므로,
  // 터미널이 없으면 회전을 위해 다시 그리지 않는다.
  const timer = spin.drawsTerminal
    ? $.clock.every(SPIN_MS, () => {
        spin.frame = (spin.frame + 1) % SPIN_FRAMES.length
        $.ui.invalidate('ui.render')
      })
    : undefined
  try {
    await refreshDue($, providers, true)
  } finally {
    timer?.cancel()
    spin.isRefreshing = false
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  const lang = isLang(options.language) ? options.language : DEFAULT_LANG
  const providers = activeProviders(options.sources)
  const spin: Spin = { isRefreshing: false, frame: 0, drawsTerminal: false }

  on('session.start', async ($, e, next) => {
    await pullFromStore($)
    // 조회는 세션 시작을 막지 않는다. 타이머가 주기적으로 깨어나 조회할 때가 된 소스만 조회하고,
    // ui.render 안에서는 조회하지 않는다.
    void refreshDue($, providers)
    // 값이 그대로여도 시간 눈금과 남은 시간은 움직이므로 틱마다 다시 그린다.
    $.clock.every(TICK_MS, () => {
      $.ui.invalidate('ui.render')
      return refreshDue($, providers)
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    for (const p of providers) {
      const reading = p.onMeasure?.(e, now)
      if (reading !== undefined) await put($, p.id, reading)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    if (e.surface === 'terminal') spin.drawsTerminal = true

    const { value = {} } = await $.state.get(readings)
    const { value: lastAttempts = {} } = await $.state.get(attempts)
    // 데스크톱은 이름 대신 로고를 그리므로, 줄에 들어갈 자세함을 로고 폭으로 잰다.
    // 버튼은 첫 줄 끝에 붙으므로 첫 줄만 그 폭을 비운다. 아래 줄(Argon이 있는 Gemini 줄)은 폭을 다 쓴다.
    const tail = e.surface === 'terminal' ? REFRESH_CELLS_TERMINAL : REFRESH_CELLS_APP
    const rows = rowsFor(providers, value, await $.clock.now(), e.props.bodyColumns, e.props.maxRows, lastAttempts, lang, e.surface !== 'terminal', tail)
    const widths = columnWidths(rows)
    const { Box, Text, Button } = $.ui.resolve(e)
    const textOf = (text: string) => <Text dimColor wrap="truncate-end">{text}</Text>
    // 값은 앱 글꼴로 그리되 숫자 폭을 통일해, 값이 바뀌어도 흔들리지 않게 한다.
    const valueOf = (text: string, color: Cell['color'], isStrong: boolean) => {
      if (color) return <Text tabular color={color} wrap="truncate-end" {...(isStrong && color === 'error' ? { weight: 'bold' as const } : {})}>{text}</Text>
      return isStrong ? <Text tabular wrap="truncate-end">{text}</Text> : <Text tabular dimColor wrap="truncate-end">{text}</Text>
    }

    // 새로고침 버튼. 조회가 도는 동안은 돌고, 끝나면 ↻ 버튼으로 돌아온다.
    const press = () => refreshNow($, providers, spin)
    const refresh = (() => {
      if (e.surface === 'terminal') {
        return <Button key={REFRESH_KEY} label={spin.isRefreshing ? SPIN_FRAMES[spin.frame]! : REFRESH_LABEL} plain dimColor onPress={press} />
      }
      // 데스크톱은 버튼 안에 그림을 둘 수 없다. 그래서 쉴 때도 도는 때도 보이지 않는 글자의 같은 버튼을 두고,
      // 그 아래 한가운데에 같은 ↻ 그림을 깐다(도는 동안에만 그림이 돈다). 버튼 크기도 그림 자리도 그대로라 제자리에서 돈다.
      // 앱은 Box의 position으로 absolute만 따르고, absolute 자식을 둔 Box를 저절로 relative로 만든다.
      // 그림을 덮는 Box가 버튼보다 위에 그려지면 그림 자리의 누름을 가로채므로, 버튼을 담은 Box에도 빈 absolute 자식을 두어
      // 위치를 가진 상자로 만들고 그림보다 뒤에 둔다. 그러면 버튼이 그림 위에 그려져 누름을 받고, 버튼 바탕은 투명해 그림이 비친다.
      const { Svg } = $.ui.resolve(e)
      return (
        <Box>
          <Box position="absolute" top={0} bottom={0} left={0} right={0} alignItems="center" justifyContent="center">
            {/* isInteractive(샌드박스 틀)는 쓰지 않는다. 틀은 어두운 화면에서 흰 바탕이 깔릴 수 있고, 그림으로도 돈다. */}
            <Svg source={refreshSvg(spin.isRefreshing)} alt={refreshAlt(spin.isRefreshing, lang)} width={SPIN_ICON_PX} height={SPIN_ICON_PX} />
          </Box>
          <Box>
            <Button key={REFRESH_KEY} label={REFRESH_LABEL_APP} plain dimColor onPress={press} />
            <Box position="absolute" top={0} left={0} />
          </Box>
        </Box>
      )
    })()

    // end: 줄 끝에 붙일 것(첫 줄의 새로고침 버튼).
    const rowOf = (cells: Cell[], end?: RenderChildren) => {
      // 데스크톱은 막대나 로고가 있으면 칸별로 그린다. 막대를 내려놓은 좁은 줄(사이드 패널을 연 때 등)에서도 로고를 지킨다.
      if (e.surface === 'terminal' || !cells.some(c => c.bar || c.logo)) {
        // 바깥 Text를 흐리게 하면 안쪽 색까지 흐려지므로, 흐림은 조각마다 건다.
        const line = (
          <Text wrap="truncate-end">
            {partsOf(cells, widths).map(p =>
              p.color ? <Text color={p.color} {...(p.isStrong && p.color === 'error' ? { weight: 'bold' as const } : {})}>{p.text}</Text>
              : p.isStrong ? <Text>{p.text}</Text>
              : <Text dimColor>{p.text}</Text>,
            )}
          </Text>
        )
        if (!end) return line
        // 버튼은 줄의 오른쪽 끝으로 민다. 줄이 넘치면 버튼이 아니라 줄이 잘린다.
        return (
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
            <Box flexShrink={1}>{line}</Box>
            <Box flexShrink={0}>{end}</Box>
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      // 여러 줄일 때만 최소 폭을 줘 위아래를 맞춘다. 줄 끝의 값은 주지 않는다.
      // 칸 수는 고정폭 글꼴 기준이고 이름은 비례폭이라, 폭을 고정하면 넓은 글자가 많은 값이 잘린다.
      const sized = (node: RenderChildren, width: number | undefined) =>
        rows.length > 1 && width ? <Box minWidth={width}>{node}</Box> : node
      // 앱 글꼴에서는 빈칸으로 자리를 맞출 수 없어, 사용률은 칸 안에서 오른쪽으로 민다.
      const percentOf = (c: Cell, width: number | undefined) => {
        const node = valueOf(c.value.trim(), c.color, true)
        return rows.length > 1 && width ? <Box minWidth={width} justifyContent="flex-end">{node}</Box> : node
      }
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {cells.flatMap((c, j) => {
            const isLast = j === cells.length - 1
            return [
              ...(j ? [textOf('│')] : []),
              ...(c.logo
                ? [<Svg source={logoSvg(c.logo)} alt={c.source ?? ''} width={LOGO_PX} height={LOGO_PX} />]
                : c.source !== undefined
                  ? [sized(textOf(c.source), widths.source[j])]
                  : []),
              ...(widths.label[j] ? [sized(textOf(c.label), widths.label[j])] : []),
              ...(c.bar ? [<Svg source={barSvg(c.bar, c.color)} alt={barAlt(c.bar, lang)} width={BAR_WIDTH_PX} height={BAR_HEIGHT_PX} />] : []),
              percentOf(c, isLast && !c.reset ? undefined : widths.value[j]),
              ...(c.reset ? [sized(valueOf(c.reset, undefined, false), isLast ? undefined : widths.reset[j])] : []),
            ]
          })}
          {/* 버튼은 빈 자리를 채우는 상자 뒤에 둬 줄의 오른쪽 끝으로 민다. */}
          {end ? <Box flexGrow={1} /> : null}
          {end ? <Box flexShrink={0}>{end}</Box> : null}
        </Box>
      )
    }
    // 버튼은 첫 줄(Codex)의 오른쪽 끝에 둔다. 줄들을 밴드 폭만큼 펼쳐야 끝이 밴드의 오른쪽 끝이 된다.
    // 첫 줄은 Argon 칸이 없어 아래 줄보다 짧으므로, 버튼 자리 때문에 아래 줄이 좁아지지 않는다.
    const mine = (
      <Box flexDirection="column" width="100%">
        {rows.map((cells, i) => rowOf(cells, i === 0 ? refresh : undefined))}
      </Box>
    )

    // 아래에 엔진 자신만 있으면 내 줄만 그린다. 다른 mod가 그린 내용이 있으면 함께 쌓는다.
    if (!rest || rest.type === 'engine') return mine
    return (
      <Box flexDirection="column" width="100%">
        {rest}
        {mine}
      </Box>
    )
  })
}
