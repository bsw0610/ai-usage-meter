import type { Register, RenderChildren } from 'claude-code'

import type {} from '../types/index'
import type { Cell } from './format'
import { BAR_HEIGHT_PX, BAR_WIDTH_PX, barAlt, barSvg, columnWidths, partsOf, rowsFor } from './format'
import { providers } from './providers'
import { pullFromStore, put, refreshDue } from './readings'

const TICK_MS = 30_000

const readings = { plugin: 'ai-usage-meter', key: 'readings' } as const
const attempts = { plugin: 'ai-usage-meter', key: 'attempts' } as const

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
    const { value: lastAttempts = {} } = await $.state.get(attempts)
    const rows = rowsFor(providers, value, await $.clock.now(), e.props.bodyColumns, e.props.maxRows, lastAttempts)
    const widths = columnWidths(rows)
    const { Box, Text } = $.ui.resolve(e)
    const textOf = (text: string, color?: 'error') =>
      color ? <Text color={color} wrap="truncate-end">{text}</Text> : <Text dimColor wrap="truncate-end">{text}</Text>

    const rowOf = (cells: Cell[]) => {
      if (e.surface === 'terminal' || !cells.some(c => c.bar)) {
        // 바깥 Text를 흐리게 하면 안쪽 색까지 흐려지므로, 흐림은 조각마다 건다.
        return (
          <Text wrap="truncate-end">
            {partsOf(cells, widths).map(p => (p.color ? <Text color={p.color}>{p.text}</Text> : <Text dimColor>{p.text}</Text>))}
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)
      // 여러 줄일 때만 폭을 고정해 위아래를 맞춘다. 줄 끝의 값은 고정하지 않는다.
      const sized = (node: RenderChildren, width: number | undefined) =>
        rows.length > 1 && width !== undefined ? <Box width={width}>{node}</Box> : node
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {cells.flatMap((c, j) => [
            ...(j ? [textOf('·')] : []),
            sized(textOf(c.label), widths.label[j]),
            ...(c.bar ? [<Svg source={barSvg(c.bar, c.color)} alt={barAlt(c.bar)} width={BAR_WIDTH_PX} height={BAR_HEIGHT_PX} />] : []),
            sized(textOf(c.value, c.color), j < cells.length - 1 ? widths.value[j] : undefined),
          ])}
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
