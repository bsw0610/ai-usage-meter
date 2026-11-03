import type { SessionRateLimit } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { claude, pick } from './providers/claude'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const FIVE: SessionRateLimit = { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-11-03T19:50:00.000Z' }
const WEEK: SessionRateLimit = { kind: 'seven_day', percentUsed: 16, resetsAt: '2026-11-03T23:00:00.000Z' }

// Claude 앱이 이미 보여 주므로 목록에서는 빠져 있지만, 파일은 다시 꽂을 수 있게 남겨 둔다.
test('pick prefers five_hour, falls back to seven_day, else nothing', () => {
  expect(pick([WEEK, FIVE], NOW)).toEqual({ kind: 'percent', percent: 7, resetsAt: Date.parse(FIVE.resetsAt!), observedAt: NOW })
  expect(pick([WEEK], NOW)).toMatchObject({ kind: 'percent', percent: 16 })
  expect(pick([], NOW)).toBeUndefined()
  expect(pick([{ kind: 'spend_limit', percentUsed: 3 }], NOW)).toBeUndefined()
})

test('onMeasure keeps the last value when there is no figure', () => {
  expect(claude.onMeasure?.({ rateLimits: [] }, NOW)).toBeUndefined()
  expect(claude.onMeasure?.({ rateLimits: [FIVE] }, NOW)).toMatchObject({ percent: 7 })
})
