import type { Register, RenderChildren } from 'claude-code'

import type {} from '../types/index'
import type { Cell } from './format'
import { BAR_HEIGHT_PX, BAR_WIDTH_PX, DEFAULT_LANG, LOGO_PX, barAlt, barSvg, columnWidths, isLang, logoSvg, partsOf, rowsFor } from './format'
import { activeProviders } from './providers'
import { pullFromStore, put, refreshDue } from './readings'

const TICK_MS = 30_000

const readings = { plugin: 'ai-usage-meter', key: 'readings' } as const
const attempts = { plugin: 'ai-usage-meter', key: 'attempts' } as const

export const register: Register = (on, options) => {
  const lang = isLang(options.language) ? options.language : DEFAULT_LANG
  const providers = activeProviders(options.sources)

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

    const { value = {} } = await $.state.get(readings)
    const { value: lastAttempts = {} } = await $.state.get(attempts)
    // 데스크톱은 이름 대신 로고를 그리므로, 줄에 들어갈 자세함을 로고 폭으로 잰다.
    const rows = rowsFor(providers, value, await $.clock.now(), e.props.bodyColumns, e.props.maxRows, lastAttempts, lang, e.surface !== 'terminal')
    const widths = columnWidths(rows)
    const { Box, Text } = $.ui.resolve(e)
    const textOf = (text: string) => <Text dimColor wrap="truncate-end">{text}</Text>
    // 값은 앱 글꼴로 그리되 숫자 폭을 통일해, 값이 바뀌어도 흔들리지 않게 한다.
    const valueOf = (text: string, color: Cell['color'], isStrong: boolean) => {
      if (color) return <Text tabular color={color} wrap="truncate-end" {...(isStrong && color === 'error' ? { weight: 'bold' as const } : {})}>{text}</Text>
      return isStrong ? <Text tabular wrap="truncate-end">{text}</Text> : <Text tabular dimColor wrap="truncate-end">{text}</Text>
    }

    const rowOf = (cells: Cell[]) => {
      // 데스크톱은 막대나 로고가 있으면 칸별로 그린다. 막대를 내려놓은 좁은 줄(사이드 패널을 연 때 등)에서도 로고를 지킨다.
      if (e.surface === 'terminal' || !cells.some(c => c.bar || c.logo)) {
        // 바깥 Text를 흐리게 하면 안쪽 색까지 흐려지므로, 흐림은 조각마다 건다.
        return (
          <Text wrap="truncate-end">
            {partsOf(cells, widths).map(p =>
              p.color ? <Text color={p.color} {...(p.isStrong && p.color === 'error' ? { weight: 'bold' as const } : {})}>{p.text}</Text>
              : p.isStrong ? <Text>{p.text}</Text>
              : <Text dimColor>{p.text}</Text>,
            )}
          </Text>
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
        </Box>
      )
    }
    const mine = rows.length === 1 ? rowOf(rows[0]!) : <Box flexDirection="column">{rows.map(rowOf)}</Box>

    // 아래에 엔진 자신만 있으면 내 줄만 그린다. 다른 mod가 그린 내용이 있으면 함께 쌓는다.
    if (!rest || rest.type === 'engine') return <Box>{mine}</Box>
    return (
      <Box flexDirection="column">
        {rest}
        {mine}
      </Box>
    )
  })
}
