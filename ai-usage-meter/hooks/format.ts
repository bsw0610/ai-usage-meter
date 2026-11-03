import type { Reading } from '../types/index'
import { DEFAULT_TTL_MS } from './providers/types'

type Entry = { label: string; short?: string; reading: Reading | null | undefined }

// 넓은 순서. 앞에서부터 들어맞는 첫 단계를 쓰고, 어느 것도 안 맞으면 마지막 단계를 쓴다(끝은 Text가 자른다).
const STEPS = ['full', 'hours', 'plain', 'short'] as const
type Step = (typeof STEPS)[number]

const DASH = '—'

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

function value(r: Reading | null | undefined, now: number, step: Step): string {
  if (!r) return DASH
  if (r.kind === 'count') {
    const count = shortCount(r.count)
    return step === 'short' ? count : `${count} ${r.unit}`
  }
  // 리셋 시각이 지난 창은 새 창이 열린 것이므로 0%.
  const left = r.resetsAt === undefined ? undefined : r.resetsAt - now
  if (left !== undefined && left <= 0) return '0%'
  const percent = `${Math.round(r.percent)}%`
  if (left === undefined) return percent
  if (step === 'full') return `${percent} (리셋 ${until(left)})`
  return step === 'hours' ? `${percent} ${until(left)}` : percent
}

function render(entries: Entry[], now: number, step: Step): string {
  return entries
    .map(e => `${step === 'short' ? (e.short ?? e.label) : e.label} ${value(e.reading, now, step)}`)
    .join(' · ')
}

// 소스 이름을 모른 채 쌍들만 한 줄로 만든다. columns 칸에 들어가는 가장 자세한 단계를 고른다.
export function formatLine(entries: Entry[], now = 0, columns = Infinity): string {
  for (const step of STEPS) {
    const line = render(entries, now, step)
    if (displayWidth(line) <= columns) return line
  }
  return render(entries, now, 'short')
}

// 등록된 목록과 저장된 readings를 합쳐 한 줄로. 목록이 무엇이든 상관없다.
// 수명(기본은 조회 간격의 2배)이 지난 값은 없는 값으로 그린다.
export function lineFor(
  list: { id: string; label: string; short?: string; ttlMs?: number; maxAgeMs?: number }[],
  readings: Record<string, Reading | null>,
  now = 0,
  columns = Infinity,
): string {
  return formatLine(
    list.map(p => {
      const r = readings[p.id]
      const maxAge = p.maxAgeMs ?? 2 * (p.ttlMs ?? DEFAULT_TTL_MS)
      return { label: p.label, short: p.short, reading: r && now - r.observedAt <= maxAge ? r : null }
    }),
    now,
    columns,
  )
}
