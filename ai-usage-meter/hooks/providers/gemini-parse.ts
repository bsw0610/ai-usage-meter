import type { Reading } from '../../types/index'

const GROUP = 'Gemini Models'
const FIVE_HOURS_MS = 5 * 3_600_000
const SEVEN_DAYS_MS = 7 * 86_400_000

// `agy -p=/usage`의 출력: 탭으로 나뉜 "그룹 / 한도 이름 / 남은 % / 리셋(ISO)" 줄들.
// 남은 %를 쓴 %로 바꾼다. Gemini 그룹의 5시간 한도를 우선하고, 없으면 주간 한도.
export function parseUsage(text: string, observedAt: number): Reading | undefined {
  const rows: { name: string; remaining: number; resetsAt?: number }[] = []
  for (const line of text.split('\n')) {
    const [group, name, pct, reset] = line.split('\t').map(x => x.trim())
    if (group !== GROUP || !name || !pct) continue
    const m = /^(\d+(?:\.\d+)?)%$/.exec(pct)
    if (!m) continue
    const at = reset ? Date.parse(reset) : NaN
    rows.push({ name, remaining: Number(m[1]), ...(Number.isFinite(at) ? { resetsAt: at } : {}) })
  }
  const five = rows.find(r => /five hour/i.test(r.name))
  const row = five ?? rows.find(r => /weekly/i.test(r.name))
  if (!row) return undefined
  const percent = Math.min(100, Math.max(0, 100 - row.remaining))
  return {
    kind: 'percent',
    percent,
    windowMs: five ? FIVE_HOURS_MS : SEVEN_DAYS_MS,
    ...(row.resetsAt !== undefined ? { resetsAt: row.resetsAt } : {}),
    observedAt,
  }
}
