import type { Reading } from '../types/index'
import { DEFAULT_TTL_MS } from './providers/types'

type Entry = { label: string; short?: string; reading: Reading | null | undefined }

// 줄의 한 조각. color가 있으면 그 색으로, 없으면 흐리게 그린다.
export type Part = { text: string; color?: 'warning' | 'error' }

type Step = { hasBar?: boolean; detail?: 'full' | 'hours'; isShort?: boolean }

// 넓은 순서. 앞에서부터 들어맞는 첫 단계를 쓰고, 어느 것도 안 맞으면 마지막 단계를 쓴다(끝은 Text가 자른다).
const STEPS: Step[] = [
  { hasBar: true, detail: 'full' },
  { hasBar: true, detail: 'hours' },
  { detail: 'full' },
  { detail: 'hours' },
  {},
  { isShort: true },
]

const DASH = '—'
const BAR_CELLS = 10
// 이보다 적게 썼으면 표본이 작아 소진을 예측하지 않는다.
const MIN_PERCENT_TO_PROJECT = 20

// 터미널 칸 수. 한글·한자·전각은 2칸, 그 밖에는 1칸(·와 —도 1칸으로 본다).
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    width += isWide ? 2 : 1
  }
  return width
}

function until(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

function shortCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`
}

// 칸이 고정이라 소스끼리 줄이 맞는다. 조금이라도 썼으면 한 칸은 채우고, 다 쓰기 전에는 다 채우지 않는다.
// marker가 있으면 그 칸(창에서 지나간 시간의 위치)을 ┃로 바꾼다.
function bar(percent: number, marker: number | undefined): string {
  const filled = percent <= 0 ? 0 : percent >= 100 ? BAR_CELLS : Math.min(BAR_CELLS - 1, Math.max(1, Math.round(percent / 10)))
  const cells: string[] = Array.from({ length: BAR_CELLS }, (_, i) => (i < filled ? '█' : '░'))
  if (marker !== undefined) cells[Math.min(BAR_CELLS - 1, marker)] = '┃'
  return cells.join('')
}

// 관측 시점까지의 속도가 이어지면 리셋 전에 소진될 때, 지금부터 소진까지 남은 시간.
function msToExhaust(r: Extract<Reading, { kind: 'percent' }>, now: number): number | undefined {
  if (r.windowMs === undefined || r.resetsAt === undefined) return undefined
  if (r.percent < MIN_PERCENT_TO_PROJECT || r.percent >= 100) return undefined
  const elapsed = r.windowMs - (r.resetsAt - r.observedAt)
  if (elapsed <= 0) return undefined
  const fromStart = (elapsed * 100) / r.percent
  if (fromStart >= r.windowMs) return undefined
  const ms = r.resetsAt - r.windowMs + fromStart - now
  return ms > 0 ? ms : undefined // 예측한 시각이 이미 지났으면 값이 낡은 것이다
}

function value(r: Reading | null | undefined, now: number, step: Step): Part {
  if (!r) return { text: DASH }
  if (r.kind === 'count') {
    const count = shortCount(r.count)
    return { text: step.isShort ? count : `${count} ${r.unit}` }
  }
  const left = r.resetsAt === undefined ? undefined : r.resetsAt - now
  // 리셋 시각이 지난 창은 새 창이 열린 것이므로 0%.
  if (left !== undefined && left <= 0) return { text: step.hasBar ? `${bar(0, undefined)} 0%` : '0%' }

  const marker =
    r.windowMs !== undefined && left !== undefined && left <= r.windowMs
      ? Math.floor(((r.windowMs - left) * BAR_CELLS) / r.windowMs)
      : undefined
  const percent = `${Math.round(r.percent)}%`
  const head = step.hasBar ? `${bar(r.percent, marker)} ${percent}` : percent
  const exhaust = msToExhaust(r, now)
  const color = r.percent >= 100 ? 'error' : exhaust !== undefined ? 'warning' : undefined
  const tail =
    exhaust !== undefined
      ? step.detail === 'full' ? `약 ${until(exhaust)} 뒤 소진` : step.detail === 'hours' ? `소진 ${until(exhaust)}` : undefined
      : left === undefined ? undefined
      : step.detail === 'full' ? `(리셋 ${until(left)})` : step.detail === 'hours' ? until(left) : undefined
  return { text: tail ? `${head} ${tail}` : head, ...(color ? { color } : {}) }
}

const textOf = (parts: Part[]) => parts.map(p => p.text).join('')

// 색이 없는 조각은 이어 붙여, 그릴 Text 수를 줄인다.
function render(entries: Entry[], now: number, step: Step): Part[] {
  const parts: Part[] = []
  const add = (p: Part) => {
    const last = parts.at(-1)
    if (last && !last.color && !p.color) last.text += p.text
    else parts.push({ ...p })
  }
  entries.forEach((e, i) => {
    add({ text: `${i ? ' · ' : ''}${step.isShort ? (e.short ?? e.label) : e.label} ` })
    add(value(e.reading, now, step))
  })
  return parts
}

// 소스 이름을 모른 채 쌍들만 한 줄로 만든다. columns 칸에 들어가는 가장 자세한 단계를 고른다.
export function formatParts(entries: Entry[], now = 0, columns = Infinity): Part[] {
  for (const step of STEPS) {
    const parts = render(entries, now, step)
    if (displayWidth(textOf(parts)) <= columns) return parts
  }
  return render(entries, now, STEPS[STEPS.length - 1]!)
}

export const formatLine = (entries: Entry[], now = 0, columns = Infinity) => textOf(formatParts(entries, now, columns))

// 등록된 목록과 저장된 readings를 합쳐 한 줄로. 목록이 무엇이든 상관없다.
// 수명(기본은 조회 간격의 2배)이 지난 값은 없는 값으로 그린다.
export function partsFor(
  list: { id: string; label: string; short?: string; ttlMs?: number; maxAgeMs?: number }[],
  readings: Record<string, Reading | null>,
  now = 0,
  columns = Infinity,
): Part[] {
  return formatParts(
    list.map(p => {
      const r = readings[p.id]
      const maxAge = p.maxAgeMs ?? 2 * (p.ttlMs ?? DEFAULT_TTL_MS)
      return { label: p.label, short: p.short, reading: r && now - r.observedAt <= maxAge ? r : null }
    }),
    now,
    columns,
  )
}

export const lineFor = (...args: Parameters<typeof partsFor>) => textOf(partsFor(...args))
