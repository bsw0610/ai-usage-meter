import type { Register } from 'claude-code'

import type {} from '../types/index'
import { BAR_HEIGHT_PX, BAR_WIDTH_PX, barAlt, barSvg, cellsFor, partsOf } from './format'
import { providers } from './providers'
import { pullFromStore, put, refreshDue } from './readings'

const TICK_MS = 30_000

const readings = { plugin: 'ai-usage-meter', key: 'readings' } as const

export const register: Register = on => {
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
    const cells = cellsFor(providers, value, await $.clock.now(), e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)
    const textOf = (text: string, color?: 'warning' | 'error') =>
      color ? <Text color={color} wrap="truncate-end">{text}</Text> : <Text dimColor wrap="truncate-end">{text}</Text>

    let mine
    if (e.surface !== 'terminal' && cells.some(c => c.bar)) {
      const { Svg } = $.ui.resolve(e)
      mine = (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {cells.flatMap((c, i) => [
            ...(i ? [textOf('·')] : []),
            textOf(c.label),
            ...(c.bar ? [<Svg source={barSvg(c.bar, c.color)} alt={barAlt(c.bar)} width={BAR_WIDTH_PX} height={BAR_HEIGHT_PX} />] : []),
            textOf(c.value, c.color),
          ])}
        </Box>
      )
    } else {
      // 바깥 Text를 흐리게 하면 안쪽 색까지 흐려지므로, 흐림은 조각마다 건다.
      mine = (
        <Text wrap="truncate-end">
          {partsOf(cells).map(p => (p.color ? <Text color={p.color}>{p.text}</Text> : <Text dimColor>{p.text}</Text>))}
        </Text>
      )
    }

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
