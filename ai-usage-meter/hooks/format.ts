import type { Attempt, PercentLimit, Reading } from '../types/index'
import { DEFAULT_TTL_MS } from './providers/types'

// 값을 그릴 수 없는 이유. 없으면 아직 결과가 없다는 뜻이다.
type Trouble = 'failed' | 'missing' | 'stale'

type Entry = { label: string; short?: string; reading: Reading | null | undefined; trouble?: Trouble }

// 줄의 한 조각. color가 있으면 그 색으로, 없으면 흐리게 그린다.
export type Part = { text: string; color?: 'error' }

export type Bar = { percent: number }

// 한도 하나의 표시. Svg를 그리는 표면은 칸별로, 터미널은 한 줄로 합쳐 그린다.
export type Cell = { label: string; bar?: Bar; value: string; color?: Part['color'] }

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
const RED_FROM_PERCENT = 90
const TROUBLE_TEXT: Record<Trouble, string> = { failed: '실패', missing: '미설치', stale: '오래됨' }
const BAR_CELLS = 10

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

// isExact면 하루 안쪽은 분까지, 그 위는 일과 시간으로 쓴다. 좁은 줄에서는 한 단위로 반올림한다.
function until(ms: number, isExact = false): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (isExact && minutes < 24 * 60) return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`
  if (isExact) {
    const totalHours = Math.round(minutes / 60)
    return `${Math.floor(totalHours / 24)}일${totalHours % 24 ? ` ${totalHours % 24}시간` : ''}`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

function shortCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`
}

// 터미널에는 Svg가 없어 선 문자로 그린다. 반 칸(5%) 단위가 한계다.
// 조금이라도 썼으면 반 칸은 채우고, 다 쓰기 전에는 다 채우지 않는다.
function barText({ percent }: Bar): string {
  const halves = percent <= 0 ? 0 : percent >= 100 ? 2 * BAR_CELLS : Math.min(2 * BAR_CELLS - 1, Math.max(1, Math.round(percent / 5)))
  const whole = Math.floor(halves / 2)
  return Array.from({ length: BAR_CELLS }, (_, i) => (i < whole ? '━' : i === whole && halves % 2 ? '╸' : '─')).join('')
}

export const BAR_WIDTH_PX = 80
export const BAR_HEIGHT_PX = 12

// Svg는 이미지로 그려져 테마 색을 받지 못하므로, 밝은 화면과 어두운 화면 모두에서 보이는 중간 색을 쓴다.
const BAR_COLORS = { error: '#dc2626' }
const BAR_FILL = '#2c84db' // Claude 앱의 파란 강조색(--accent-100). 밝은 화면과 어두운 화면에서 값이 같다.
const BAR_TRACK = 'rgba(140,140,140,0.3)'
const BAR_INSET_PX = 2

// 값 그대로의 위치에 그리는 선.
export function barSvg({ percent }: Bar, color?: Part['color']): string {
  const mid = BAR_HEIGHT_PX / 2
  const at = (ratio: number) => (BAR_INSET_PX + Math.min(1, Math.max(0, ratio)) * (BAR_WIDTH_PX - 2 * BAR_INSET_PX)).toFixed(2)
  const line = (x1: string, x2: string, stroke: string) =>
    `<line x1="${x1}" y1="${mid}" x2="${x2}" y2="${mid}" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`
  const fill = percent > 0 ? line(at(0), at(percent / 100), color ? BAR_COLORS[color] : BAR_FILL) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH_PX}" height="${BAR_HEIGHT_PX}" viewBox="0 0 ${BAR_WIDTH_PX} ${BAR_HEIGHT_PX}">${line(at(0), at(1), BAR_TRACK)}${fill}</svg>`
}

export const barAlt = ({ percent }: Bar): string => `${Math.round(percent)}% 사용`

function limitCell(r: PercentLimit, now: number, step: Step): Omit<Cell, 'label'> {
  const left = r.resetsAt === undefined ? undefined : r.resetsAt - now
  // 리셋 시각이 지난 창은 새 창이 열린 것이므로 0%.
  if (left !== undefined && left <= 0) return { ...(step.hasBar ? { bar: { percent: 0 } } : {}), value: '0%' }

  const percent = `${Math.round(r.percent)}%`
  const tail =
    left === undefined ? undefined
    : step.detail === 'full' ? `(리셋 ${until(left, true)})`
    : step.detail === 'hours' ? until(left)
    : undefined
  return {
    ...(step.hasBar ? { bar: { percent: r.percent } } : {}),
    value: tail ? `${percent} ${tail}` : percent,
    ...(r.percent >= RED_FROM_PERCENT ? { color: 'error' as const } : {}),
  }
}

// 더 많이 쓴 한도가 더 급하다. 리셋이 지난 창은 새로 시작했으므로 0%로 친다.
function isMoreUrgent(a: PercentLimit, b: PercentLimit, now: number): boolean {
  const used = (r: PercentLimit) => (r.resetsAt !== undefined && r.resetsAt <= now ? 0 : r.percent)
  return used(a) > used(b)
}

// 소스 하나의 칸들. 나란히 놓을 수 없으면 더 급한 한도 하나만 남긴다.
function cellsOf(e: Entry, now: number, step: Step, isStacked: boolean): Cell[] {
  const label = step.isShort ? (e.short ?? e.label) : e.label
  const r = e.reading
  if (!r) return [{ label, value: step.detail && e.trouble ? `${DASH} ${TROUBLE_TEXT[e.trouble]}` : DASH }]
  if (r.kind === 'count') {
    const count = shortCount(r.count)
    return [{ label, value: step.isShort ? count : `${count} ${r.unit}` }]
  }
  const primary = { label, ...limitCell(r, now, step) }
  if (!r.secondary) return [primary]
  const weekly = limitCell(r.secondary, now, step)
  const weeklyLabel = step.isShort ? '주' : '주간'
  if (isStacked) return [primary, { label: weeklyLabel, ...weekly }]
  return [isMoreUrgent(r.secondary, r, now) ? { label: `${label} ${weeklyLabel}`, ...weekly } : primary]
}

// 여러 줄일 때 위아래가 맞도록, 칸 번호별로 이름과 값의 폭을 잰다.
export type ColumnWidths = { label: number[]; value: number[] }

export function columnWidths(rows: Cell[][]): ColumnWidths {
  const widths: ColumnWidths = { label: [], value: [] }
  for (const cells of rows) {
    cells.forEach((c, j) => {
      widths.label[j] = Math.max(widths.label[j] ?? 0, displayWidth(c.label))
      widths.value[j] = Math.max(widths.value[j] ?? 0, displayWidth(c.value))
    })
  }
  return widths
}

const padTo = (text: string, width = 0) => text + ' '.repeat(Math.max(0, width - displayWidth(text)))

// 색이 없는 조각은 이어 붙여, 그릴 Text 수를 줄인다. 줄 끝의 값은 채우지 않는다.
export function partsOf(cells: Cell[], widths: ColumnWidths = columnWidths([cells])): Part[] {
  const parts: Part[] = []
  const add = (p: Part) => {
    const last = parts.at(-1)
    if (last && !last.color && !p.color) last.text += p.text
    else parts.push({ ...p })
  }
  cells.forEach((c, j) => {
    const value = j < cells.length - 1 ? padTo(c.value, widths.value[j]) : c.value
    add({ text: `${j ? ' · ' : ''}${padTo(c.label, widths.label[j])} ` })
    add({ text: c.bar ? `${barText(c.bar)} ${value}` : value, ...(c.color ? { color: c.color } : {}) })
  })
  return parts
}

const textOf = (parts: Part[]) => parts.map(p => p.text).join('')

function render(entries: Entry[], now: number, step: Step, isStacked: boolean): Cell[][] {
  const cells = entries.map(e => cellsOf(e, now, step, isStacked))
  return isStacked ? cells : [cells.flat()]
}

// 소스 이름을 모른 채 쌍들을 줄로 만든다. 주간 한도까지 온 소스가 있고 maxRows가 허락하면 소스마다 한 줄,
// 아니면 모두 한 줄이다. columns 칸에 들어가는 가장 자세한 단계를 고른다.
export function formatRows(entries: Entry[], now = 0, columns = Infinity, maxRows = Infinity): Cell[][] {
  const isStacked = entries.length <= maxRows && entries.some(e => e.reading?.kind === 'percent' && e.reading.secondary)
  for (const step of STEPS) {
    const rows = render(entries, now, step, isStacked)
    const widths = columnWidths(rows)
    if (rows.every(cells => displayWidth(textOf(partsOf(cells, widths))) <= columns)) return rows
  }
  return render(entries, now, STEPS[STEPS.length - 1]!, isStacked)
}

const lineOf = (rows: Cell[][]) => {
  const widths = columnWidths(rows)
  return rows.map(cells => textOf(partsOf(cells, widths))).join('\n')
}

export const formatLine = (entries: Entry[], now = 0, columns = Infinity, maxRows = Infinity) =>
  lineOf(formatRows(entries, now, columns, maxRows))

// 등록된 목록과 저장된 readings를 합쳐 줄로. 목록이 무엇이든 상관없다.
// 수명(기본은 조회 간격의 2배)이 지난 값은 없는 값으로 그린다.
export function rowsFor(
  list: { id: string; label: string; short?: string; ttlMs?: number; maxAgeMs?: number }[],
  readings: Record<string, Reading | null>,
  now = 0,
  columns = Infinity,
  maxRows = Infinity,
  attempts: Record<string, Attempt> = {},
): Cell[][] {
  return formatRows(
    list.map(p => {
      const r = readings[p.id]
      const maxAge = p.maxAgeMs ?? 2 * (p.ttlMs ?? DEFAULT_TTL_MS)
      if (r && now - r.observedAt <= maxAge) return { label: p.label, short: p.short, reading: r }
      const last = attempts[p.id]
      const trouble = last && !last.isOk ? (last.isMissing ? 'missing' : 'failed') : r ? 'stale' : undefined
      return { label: p.label, short: p.short, reading: null, ...(trouble ? { trouble } : {}) }
    }),
    now,
    columns,
    maxRows,
  )
}

export const lineFor = (...args: Parameters<typeof rowsFor>) => lineOf(rowsFor(...args))
