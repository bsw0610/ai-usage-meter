import type { Register } from 'claude-code'

import type {} from '../types/index'
import { lineFor } from './format'
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
    $.clock.every(TICK_MS, () => refreshDue($, providers))
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
    const line = lineFor(providers, value, await $.clock.now(), e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)
    const mine = <Text dimColor wrap="truncate-end">{line}</Text>

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
