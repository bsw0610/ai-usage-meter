import type { ProcessRunResult, SessionRateLimit } from 'claude-code'

import type { PercentLimit, Reading } from '../../types/index'
import { ReadFailure } from './types'
import type { Provider } from './types'

const toLimit = (w: SessionRateLimit): PercentLimit => {
  const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return { percent: w.percentUsed, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) }
}

// 5시간 창 우선, 없으면 주간 창이고 isWeekly로 밝힌다. 둘 다 있으면 주간 창은 secondary로 함께 담는다(Codex와 같은 모양).
// 둘 다 없으면(구독이 아니거나 아직 응답이 없음) undefined. 게이트웨이의 spend_limit은 쓰지 않는다.
export function pick(limits: SessionRateLimit[], now: number): Reading | undefined {
  const valid = (kind: string) => limits.find(l => l.kind === kind && typeof l.percentUsed === 'number')
  const five = valid('five_hour')
  const week = valid('seven_day')
  const w = five ?? week
  if (!w) return undefined
  return { kind: 'percent', ...toLimit(w), ...(five && week ? { secondary: toLimit(week) } : {}), ...(five ? {} : { isWeekly: true }), observedAt: now }
}

// Claude 자신의 사용량. 조회하지 않고, 엔진이 알려 주는 값(session.measure)만 받는다.
// 그래서 조회 목록(providers)에 넣지 않는다. 넣으면 응답 전의 빈 값이 실패로 그려진다.
// 데스크톱 앱은 이미 Claude 사용량을 보여 주므로 터미널에서만 그린다(register.tsx).
export const claude = {
  id: 'claude',
  label: 'Claude',
  short: 'Cl',
  maxAgeMs: Infinity, // 값이 움직일 때만 오므로 오래돼도 유효하다. 리셋이 지난 창은 format이 "—"로 그린다.
  onMeasure: (m: { rateLimits: SessionRateLimit[] }, now: number) => pick(m.rateLimits, now),
}

// 모델별 주간 한도(Fable). 엔진의 mod API(session.usage·session.measure)에는 5시간·주간만 있어,
// /usage와 같은 값을 주는 SDK 제어 요청 get_usage를 짧게 띄운 claude에 묻는다(모델 호출 없음, 약 1~2초).
// 이 요청은 문서에 없는 것으로 Claude Code 2.1.325의 실행 파일에서 찾았다. 업데이트로 바뀌면 Fable 칸만 빠진다.
// 훅(이 mod 포함)과 MCP 서버를 띄우지 않고, 세션 기록을 남기지 않는다.
const REQUEST_ID = 'ai-usage-meter'
const CLAUDE_ARGV = [
  'claude', '-p',
  '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--no-session-persistence', '--strict-mcp-config',
  '--settings', '{"disableAllHooks":true}',
]
const REQUEST = JSON.stringify({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'get_usage' } }) + '\n'
const TIMEOUT_MS = 20_000
const FABLE = { label: 'Fable', short: 'Fa' } as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// get_usage 응답에서 이름이 Fable인 모델별 주간 한도만 꺼낸다. 이름·사용률·리셋 시각 말고는 버린다.
// 없거나 모양이 다르면 이유를 문자열로 돌려준다.
export function parseFable(stdout: string, observedAt: number): Reading | string {
  for (const line of stdout.split('\n')) {
    let m: unknown
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(m) || m.type !== 'control_response' || !isRecord(m.response) || m.response.request_id !== REQUEST_ID) continue
    if (m.response.subtype !== 'success') return `get_usage: ${String(m.response.error ?? m.response.subtype)}`
    const limits = isRecord(m.response.response) ? m.response.response.rate_limits : undefined
    if (!isRecord(limits)) return 'no plan limits'
    const scoped = Array.isArray(limits.model_scoped) ? limits.model_scoped : []
    const w = scoped.find(s => isRecord(s) && s.display_name === FABLE.label && typeof s.utilization === 'number')
    if (!isRecord(w)) return 'no Fable window'
    const resetsAt = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN
    return { kind: 'percent', percent: Math.max(0, w.utilization as number), ...(Number.isFinite(resetsAt) ? { resetsAt } : {}), isWeekly: true, observedAt }
  }
  return 'no get_usage reply'
}

// 터미널 세션만 조회한다(register.tsx). Fable 칸은 Claude 줄에만 붙기 때문이다.
export const fable: Provider = {
  id: 'fable',
  label: FABLE.label,
  short: FABLE.short,
  ttlMs: 5 * 60_000,
  retryMs: 15 * 60_000,
  read: async io => {
    // 세션 폴더의 프로젝트 설정을 읽지 않도록 홈 폴더에서 띄운다.
    const home = await io.home()
    let r: ProcessRunResult
    try {
      r = await io.run(CLAUDE_ARGV, { stdin: REQUEST, timeoutMs: TIMEOUT_MS, ...(home ? { cwd: home } : {}) })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new ReadFailure(`claude: ${message}`, message.includes('ENOENT'))
    }
    if (r.exitCode !== 0) throw new ReadFailure(`claude exit ${r.exitCode}: ${r.stderr.trim()}`)
    const reading = parseFable(r.stdout, await io.now())
    if (typeof reading === 'string') throw new ReadFailure(reading)
    return reading
  },
}

// Claude 줄에 Fable 칸을 붙인다(Gemini 줄의 Argon처럼). Fable 값이 없거나 수명(조회 간격의 2배)이 지났으면 칸 없이 둔다.
export function withFable(r: Reading, f: Reading | null | undefined, now: number): Reading {
  if (r.kind !== 'percent' || !f || f.kind !== 'percent') return r
  if (now - f.observedAt > 2 * (fable.ttlMs ?? 0)) return r
  return { ...r, extra: { label: FABLE.label, short: FABLE.short, percent: f.percent, ...(f.resetsAt !== undefined ? { resetsAt: f.resetsAt } : {}) } }
}
