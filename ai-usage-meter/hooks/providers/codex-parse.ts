import type { PercentLimit, Reading } from '../../types/index'

const FIVE_HOURS = 300
const SEVEN_DAYS = 10080

export type Window = { usedPercent: number; minutes: number; resetsAtSec: number | undefined }

const toLimit = (w: Window): PercentLimit => ({
  percent: w.usedPercent,
  ...(typeof w.resetsAtSec === 'number' ? { resetsAt: w.resetsAtSec * 1000 } : {}),
})

// 5시간 창 우선, 없으면 7일 창이고 isWeekly로 밝힌다. 둘 다 있으면 7일 창은 secondary로 함께 담는다.
// 창 이름(primary/secondary)이 아니라 길이로 구분한다.
export function fromWindows(windows: Window[], observedAt: number): Reading | undefined {
  const five = windows.find(x => x.minutes === FIVE_HOURS)
  const week = windows.find(x => x.minutes === SEVEN_DAYS)
  const w = five ?? week
  if (!w) return undefined
  return { kind: 'percent', ...toLimit(w), ...(five && week ? { secondary: toLimit(week) } : {}), ...(five ? {} : { isWeekly: true }), observedAt }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

// 헬퍼가 출력한 JSON 한 줄. 모양이 다르면 undefined.
export function parseLive(stdout: string, now: number): Reading | undefined {
  try {
    const o: unknown = JSON.parse(stdout.trim())
    if (!isObj(o) || o.limitId !== 'codex' || !Array.isArray(o.windows)) return undefined
    const windows: Window[] = []
    for (const w of o.windows) {
      if (isObj(w) && typeof w.usedPercent === 'number' && typeof w.windowDurationMins === 'number') {
        windows.push({
          usedPercent: w.usedPercent,
          minutes: w.windowDurationMins,
          resetsAtSec: typeof w.resetsAt === 'number' ? w.resetsAt : undefined,
        })
      }
    }
    return fromWindows(windows, now)
  } catch {
    return undefined
  }
}

// rollout JSONL(일부일 수 있음)에서 마지막 codex token_count를 읽는다.
//  - undefined: codex token_count가 없음(다른 파일을 더 볼 수 있다)
//  - null: 마지막 token_count의 rate_limits가 null이거나 5h/7d 창이 없음 → 알 수 없음
export function parseRollout(text: string): Reading | null | undefined {
  let last: { rl: unknown; at: number } | undefined
  for (const line of text.split('\n')) {
    if (!line.includes('token_count')) continue
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue // 잘린 첫 줄이나 손상된 줄
    }
    if (!isObj(o) || o.type !== 'event_msg' || !isObj(o.payload) || o.payload.type !== 'token_count') continue
    const rl = o.payload.rate_limits
    if (isObj(rl) && rl.limit_id !== 'codex') continue
    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    last = { rl, at: Number.isFinite(at) ? at : 0 }
  }
  if (!last) return undefined
  if (!isObj(last.rl)) return null

  const windows: Window[] = []
  for (const key of ['primary', 'secondary']) {
    const w = last.rl[key]
    if (isObj(w) && typeof w.used_percent === 'number' && typeof w.window_minutes === 'number') {
      windows.push({
        usedPercent: w.used_percent,
        minutes: w.window_minutes,
        resetsAtSec: typeof w.resets_at === 'number' ? w.resets_at : undefined,
      })
    }
  }
  return fromWindows(windows, last.at) ?? null
}
