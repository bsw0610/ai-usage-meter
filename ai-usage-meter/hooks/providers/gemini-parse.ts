import type { PercentLimit, Reading } from '../../types/index'

const GROUP = 'Gemini Models'
// 그룹 이름에 모델 버전이 들어 있다("Gemini 4 Argon"). 버전이 올라도 찾도록 Argon만 본다.
const ARGON_GROUP = /\bargon\b/i

type Bucket = { group: string; window: string; limit: PercentLimit }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// 앞뒤에 로그 줄이 섞일 수 있어 줄마다 본다. 성공한 usage 응답만 값으로 친다.
function usageGroups(stdout: string): unknown[] | undefined {
  for (const line of stdout.split('\n')) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    let reply: unknown
    try {
      reply = JSON.parse(text)
    } catch {
      continue
    }
    if (!isRecord(reply) || reply.status !== 'SUCCESS' || !isRecord(reply.command) || reply.command.name !== 'usage') continue
    const data = reply.command.data
    if (isRecord(data) && Array.isArray(data.groups)) return data.groups
  }
  return undefined
}

// disabled는 사용량을 재지 않는 한도라, 0%로 그리면 없는 여유를 있는 것처럼 보이게 한다.
function bucketsOf(group: unknown): Bucket[] {
  if (!isRecord(group) || typeof group.name !== 'string' || !Array.isArray(group.buckets)) return []
  const out: Bucket[] = []
  for (const b of group.buckets) {
    if (!isRecord(b) || b.disabled === true || typeof b.window !== 'string') continue
    const left = b.remaining_fraction
    if (typeof left !== 'number' || !Number.isFinite(left)) continue
    const at = typeof b.reset_time === 'string' ? Date.parse(b.reset_time) : NaN
    out.push({
      group: group.name,
      window: b.window,
      limit: {
        percent: Math.min(100, Math.max(0, Math.round((1 - left) * 100))),
        ...(Number.isFinite(at) ? { resetsAt: at } : {}),
      },
    })
  }
  return out
}

// `agy -p=/usage --output-format json`의 출력. 텍스트 출력은 값이 반올림되고 disabled가 빠진다.
// Gemini 그룹의 5시간 한도를 우선하고, 없으면 주간 한도. 둘 다 있으면 주간 한도는 secondary로 함께 담는다.
// Argon의 주간 한도는 따로 잡혀 extra로 담는다.
export function parseUsage(stdout: string, observedAt: number): Reading | undefined {
  const buckets = (usageGroups(stdout) ?? []).flatMap(bucketsOf)
  const gemini = buckets.filter(b => b.group === GROUP)
  const five = gemini.find(b => b.window === '5h')?.limit
  const week = gemini.find(b => b.window === 'weekly')?.limit
  const argon = buckets.find(b => ARGON_GROUP.test(b.group) && b.window === 'weekly')?.limit
  const main = five ?? week
  if (!main) return undefined
  return {
    kind: 'percent',
    ...main,
    ...(five && week ? { secondary: week } : {}),
    ...(argon ? { extra: { label: 'Argon', short: 'Ar', ...argon } } : {}),
    observedAt,
  }
}
