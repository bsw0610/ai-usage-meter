import type { PercentLimit, Reading } from '../../types/index'

const GROUP = 'Gemini Models'

// `agy -p=/usage`의 출력: 탭으로 나뉜 "그룹 / 한도 이름 / 남은 % / 리셋(ISO)" 줄들.
// 남은 %를 쓴 %로 바꾼다. Gemini 그룹의 5시간 한도를 우선하고, 없으면 주간 한도.
// 둘 다 있으면 주간 한도는 secondary로 함께 담는다.
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
  const week = rows.find(r => /weekly/i.test(r.name))
  const row = five ?? week
  if (!row) return undefined
  const toLimit = (r: typeof row): PercentLimit => ({
    percent: Math.min(100, Math.max(0, 100 - r.remaining)),
    ...(r.resetsAt !== undefined ? { resetsAt: r.resetsAt } : {}),
  })
  return {
    kind: 'percent',
    ...toLimit(row),
    ...(five && week ? { secondary: toLimit(week) } : {}),
    observedAt,
  }
}
