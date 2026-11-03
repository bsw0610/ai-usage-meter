import type { SessionRateLimit } from 'claude-code'

import type { Reading } from '../../types/index'
import type { Provider } from './types'

// five_hour 우선, 없으면 seven_day. 둘 다 없으면 undefined.
export function pick(limits: SessionRateLimit[], now: number): Reading | undefined {
  const w = limits.find(l => l.kind === 'five_hour') ?? limits.find(l => l.kind === 'seven_day')
  if (!w || typeof w.percentUsed !== 'number') return undefined

  const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return {
    kind: 'percent',
    percent: w.percentUsed,
    ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
    observedAt: now,
  }
}

export const claude: Provider = {
  id: 'claude',
  label: 'Claude',
  short: 'Cl',
  maxAgeMs: Infinity, // session.measure가 값이 움직일 때만 오므로 오래돼도 유효하다
  read: async io => pick(await io.rateLimits(), await io.now()) ?? null,
  onMeasure: (m, now) => pick(m.rateLimits, now),
}
