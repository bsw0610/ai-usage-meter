import type { Attempt, PercentLimit, Reading } from '../types/index'
import { DEFAULT_TTL_MS } from './providers/types'

// 값을 그릴 수 없는 이유. 없으면 아직 결과가 없다는 뜻이다.
type Trouble = 'failed' | 'missing' | 'stale'

type Entry = { label: string; short?: string; logo?: string; reading: Reading | null | undefined; trouble?: Trouble }

// 한도의 경고 단계. 80%부터 주황, 다 쓰면 빨강.
type Level = 'warning' | 'error'

// 줄의 한 조각. 기본은 흐리게 그린다. isStrong은 사용률처럼 먼저 읽혀야 하는 값이다.
// color는 테마 키(warning·error)나 막대의 채운 색(BAR_FILL)이다.
export type Part = { text: string; color?: Level | typeof BAR_FILL; isStrong?: boolean }

// isPending: 리셋이 지나 지금 창의 값을 아직 모른다. 바탕만 그리고, 0%라고 읽히지 않게 한다.
export type Bar = { percent: number; isPending?: true }

// 한도 하나의 표시. Svg를 그리는 표면은 칸별로, 터미널은 한 줄로 합쳐 그린다.
// source: 소스 이름(줄의 첫 칸). logo: 이름 대신 그릴 수 있는 로고의 SVG 내용. label: 한도 이름. value: 사용률이나 줄표. reset: 리셋까지 남은 시간.
export type Cell = { source?: string; logo?: string; label: string; bar?: Bar; value: string; reset?: string; color?: Level }

// hasOneOther: 소스마다 줄을 둘 때, 첫 한도 말고는 가장 많이 쓴 한도 하나만 남긴다(가장 좁은 줄에서 끝 칸이 잘리지 않도록).
type Step = { hasBar?: boolean; detail?: 'exact' | 'hours'; isShort?: boolean; hasNoSlot?: boolean; hasOneOther?: boolean }

// 넓은 순서. 앞에서부터 들어맞는 첫 단계를 쓰고, 어느 것도 안 맞으면 마지막 단계를 쓴다(끝은 Text가 자른다).
// 막대는 모든 한도(Argon 포함)에 함께 그리고 함께 내려놓는다. 한 칸의 막대만 먼저 사라지지 않게 한다.
const STEPS: Step[] = [
  { hasBar: true, detail: 'exact' },
  { hasBar: true, detail: 'hours' },
  { detail: 'exact' },
  { detail: 'hours' },
  { detail: 'hours', isShort: true },
  { isShort: true },
  { isShort: true, hasOneOther: true },
]

const DASH = '—'
const ORANGE_FROM_PERCENT = 80
const RED_FROM_PERCENT = 100 // 다 썼을 때
const SEPARATOR = '│'
const FIVE_HOUR_NAME = '5h'
const PERCENT_SLOT = 4 // "100%"까지 자릿수가 바뀌어도 뒤의 값이 움직이지 않는다
const BAR_CELLS = 9 // 막대 길이. 0.15.2에서 사용자 요청으로 10칸에서 10% 줄였다(데스크톱 80px → 72px).

export type Lang = 'ko' | 'en' | 'ja'

export const DEFAULT_LANG: Lang = 'en'

// userConfig의 language 값. 엔진이 목록 밖의 값을 걸러 주므로, 타입을 좁히는 일만 한다.
export const isLang = (value: unknown): value is Lang => value === 'ko' || value === 'en' || value === 'ja'

type Strings = {
  trouble: Record<Trouble, string>
  days: (days: number, hours: number) => string
  weeklyShort: string
  used: (percent: number) => string
  refresh: string
  refreshing: string
  pending: string
}

const STRINGS: Record<Lang, Strings> = {
  ko: {
    trouble: { failed: '실패', missing: '미설치', stale: '오래됨' },
    days: (days, hours) => `${days}일${hours ? ` ${hours}시간` : ''}`,
    weeklyShort: '주',
    used: percent => `${percent}% 사용`,
    refresh: '새로 고침',
    refreshing: '새로 고치는 중',
    pending: '다음 확인 대기',
  },
  en: {
    trouble: { failed: 'failed', missing: 'not installed', stale: 'stale' },
    days: (days, hours) => `${days}d${hours ? ` ${hours}h` : ''}`,
    weeklyShort: 'Wk',
    used: percent => `${percent}% used`,
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    pending: 'waiting for the next check',
  },
  ja: {
    trouble: { failed: '失敗', missing: '未インストール', stale: '古い値' },
    days: (days, hours) => `${days}日${hours ? `${hours}時間` : ''}`,
    weeklyShort: '週',
    used: percent => `${percent}%使用`,
    refresh: '更新',
    refreshing: '更新中',
    pending: '次の確認待ち',
  },
}

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

// exact가 있으면 하루 안쪽은 분까지, 그 위는 그 언어의 일과 시간으로 쓴다. 좁은 줄에서는 한 단위로 반올림한다.
function until(ms: number, exact?: Strings): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (exact && minutes < 24 * 60) return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`
  if (exact) {
    const totalHours = Math.round(minutes / 60)
    return exact.days(Math.floor(totalHours / 24), totalHours % 24)
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

function shortCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`
}

// 터미널에는 Svg가 없어 선 문자로 그린다. 반 칸(9칸이면 약 5.6%) 단위가 한계다.
// 조금이라도 썼으면 반 칸은 채우고, 다 쓰기 전에는 다 채우지 않는다.
// 데스크톱처럼 채운 부분과 바탕을 다른 색으로 칠하도록 둘을 나눠 돌려준다.
function barText({ percent }: Bar): { used: string; left: string } {
  const halves =
    percent <= 0 ? 0
    : percent >= 100 ? 2 * BAR_CELLS
    : Math.min(2 * BAR_CELLS - 1, Math.max(1, Math.round((percent / 100) * 2 * BAR_CELLS)))
  const whole = Math.floor(halves / 2)
  const used = '━'.repeat(whole) + (halves % 2 ? '╸' : '')
  return { used, left: '─'.repeat(BAR_CELLS - whole - (halves % 2)) }
}

export const BAR_WIDTH_PX = 8 * BAR_CELLS // 한 칸 8px
export const BAR_HEIGHT_PX = 12

// Svg는 이미지로 그려져 테마 색을 받지 못하므로, 밝은 화면과 어두운 화면 모두에서 보이는 중간 색을 쓴다.
const BAR_COLORS = { warning: '#d97706', error: '#dc2626' }
const BAR_FILL = '#2c84db' // Claude 앱의 파란 강조색(--accent-100). 밝은 화면과 어두운 화면에서 값이 같다.
const BAR_TRACK = 'rgba(140,140,140,0.3)'
const BAR_INSET_PX = 2

// 값 그대로의 위치에 그리는 선.
export function barSvg({ percent }: Bar, color?: Level): string {
  const mid = BAR_HEIGHT_PX / 2
  const at = (ratio: number) => (BAR_INSET_PX + Math.min(1, Math.max(0, ratio)) * (BAR_WIDTH_PX - 2 * BAR_INSET_PX)).toFixed(2)
  const line = (x1: string, x2: string, stroke: string) =>
    `<line x1="${x1}" y1="${mid}" x2="${x2}" y2="${mid}" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`
  const fill = percent > 0 ? line(at(0), at(percent / 100), color ? BAR_COLORS[color] : BAR_FILL) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH_PX}" height="${BAR_HEIGHT_PX}" viewBox="0 0 ${BAR_WIDTH_PX} ${BAR_HEIGHT_PX}">${line(at(0), at(1), BAR_TRACK)}${fill}</svg>`
}

export const LOGO_PX = 16

// 데스크톱이 이름 대신 그리는 로고가 차지하는 칸 수. 막대가 한 칸을 8px로 그리므로, 16px 로고는 2칸이다.
const LOGO_CELLS = Math.ceil(LOGO_PX / (BAR_WIDTH_PX / BAR_CELLS))

// 로고 내용(24×24)을 그림으로. 색은 로고가 정한다.
export const logoSvg = (content: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_PX}" height="${LOGO_PX}" viewBox="0 0 24 24">${content}</svg>`

export const barAlt = ({ percent, isPending }: Bar, lang: Lang = DEFAULT_LANG): string =>
  isPending ? STRINGS[lang].pending : STRINGS[lang].used(Math.round(percent))

export const SPIN_ICON_PX = 14
const SPIN_ICON_COLOR = 'rgba(140,140,140,0.95)' // 밝은 화면과 어두운 화면 모두에서 흐린 글자처럼 보이는 색
const SPIN_TURN_S = 1 // 한 바퀴에 걸리는 시간

// 데스크톱 새로고침 버튼의 ↻ 그림. 쉴 때와 도는 때가 같은 그림이라, 돌기 시작하고 멈출 때 모양도 자리도 바뀌지 않는다.
// 조회하는 동안에는 SVG가 스스로(SMIL) 끊김 없이 돌므로 다시 그리지 않아도 된다.
// 그림(img)으로 그려도 Chromium에서는 돈다(브라우저 패널에서 확인). 돌 때 화살촉이 잘리지 않게 둘레에 여백을 둔다.
export function refreshSvg(isSpinning: boolean): string {
  const turn = isSpinning
    ? `<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="${SPIN_TURN_S}s" repeatCount="indefinite"/>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPIN_ICON_PX}" height="${SPIN_ICON_PX}" viewBox="-1.5 -1.5 27 27"` +
    ` fill="none" stroke="${SPIN_ICON_COLOR}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
    `<g><path d="M19.36 16.25A8.5 8.5 0 1 1 18 6l2.5 2.5"/><path d="M20.5 3.5v5h-5"/>${turn}</g></svg>`
  )
}

export const refreshAlt = (isSpinning: boolean, lang: Lang = DEFAULT_LANG): string =>
  isSpinning ? STRINGS[lang].refreshing : STRINGS[lang].refresh

function limitCell(r: PercentLimit, now: number, step: Step, text: Strings): Omit<Cell, 'label' | 'source'> {
  const slot = (value: string) => (step.isShort || step.hasNoSlot ? value : value.padStart(PERCENT_SLOT))
  const left = r.resetsAt === undefined ? undefined : r.resetsAt - now
  // 리셋 시각이 지난 값은 끝난 창의 것이다. 새 창의 사용량은 다음 조회가 알려 줄 때까지 모르므로, 0%라고 단정하지 않고 줄표로 그린다.
  // 막대는 바탕만 남긴다. 빼면 데스크톱에서 뒤의 칸이 밀리고, 모든 칸에 막대가 있거나 없어야 한다.
  if (left !== undefined && left <= 0) return { ...(step.hasBar ? { bar: { percent: 0, isPending: true as const } } : {}), value: slot(DASH) }

  const shown = Math.round(r.percent)
  const color = shown >= RED_FROM_PERCENT ? ('error' as const) : shown >= ORANGE_FROM_PERCENT ? ('warning' as const) : undefined
  const time =
    left === undefined ? undefined
    : step.detail === 'exact' ? until(left, text)
    : step.detail === 'hours' ? until(left)
    : undefined
  return {
    ...(step.hasBar ? { bar: { percent: r.percent } } : {}),
    value: slot(`${shown}%`),
    ...(time ? { reset: time } : {}),
    ...(color ? { color } : {}),
  }
}

// 더 많이 쓴 한도가 더 급하다. 리셋이 지난 창은 값을 모르므로 급하지 않은 것(0%)으로 친다.
function isMoreUrgent(a: PercentLimit, b: PercentLimit, now: number): boolean {
  const used = (r: PercentLimit) => (r.resetsAt !== undefined && r.resetsAt <= now ? 0 : r.percent)
  return used(a) > used(b)
}

// 소스 하나의 칸들. 나란히 놓을 수 없으면 더 급한 한도 하나만 남긴다.
function cellsOf(e: Entry, now: number, step: Step, isStacked: boolean, text: Strings): Cell[] {
  const source = step.isShort ? (e.short ?? e.label) : e.label
  const named = { source, ...(e.logo ? { logo: e.logo } : {}) }
  const r = e.reading
  if (!r) return [{ ...named, label: '', value: step.detail && e.trouble ? `${DASH} ${text.trouble[e.trouble]}` : DASH }]
  if (r.kind === 'count') {
    const count = shortCount(r.count)
    return [{ ...named, label: '', value: step.isShort ? count : `${count} ${r.unit}` }]
  }
  // 가장 좁을 때는 첫 칸이 5시간 한도라는 것을 이름 없이 둔다.
  const firstName = r.isWeekly ? text.weeklyShort : step.isShort ? '' : FIVE_HOUR_NAME
  const primary = { ...named, label: firstName, ...limitCell(r, now, step, text) }
  // 따로 잡히는 한도는 슬롯 없이 그린다. 막대는 다른 한도와 같은 단계를 따른다.
  const others: { name: string; limit: PercentLimit; step: Step }[] = [
    ...(r.secondary ? [{ name: text.weeklyShort, limit: r.secondary, step }] : []),
    ...(r.extra ? [{ name: r.extra.short, limit: r.extra, step: { ...step, hasNoSlot: true } }] : []),
  ]
  const cellOf = (o: (typeof others)[number]): Cell => ({ label: o.name, ...limitCell(o.limit, now, o.step, text) })
  if (isStacked && !step.hasOneOther) return [primary, ...others.map(cellOf)]
  if (isStacked) {
    // 더 많이 쓴 쪽을 남긴다. 같으면 앞의 것(주간)이다.
    let most: (typeof others)[number] | undefined
    for (const o of others) if (!most || isMoreUrgent(o.limit, most.limit, now)) most = o
    return most ? [primary, cellOf(most)] : [primary]
  }
  let urgent: (typeof others)[number] | undefined
  for (const o of others) if (isMoreUrgent(o.limit, urgent?.limit ?? r, now)) urgent = o
  if (!urgent) return [primary]
  return [{ ...named, label: urgent.limit === r.extra ? r.extra.label : urgent.name, ...limitCell(urgent.limit, now, urgent.step, text) }]
}

// 여러 줄일 때 위아래가 맞도록, 칸 번호별로 조각의 폭을 잰다.
export type ColumnWidths = { source: number[]; label: number[]; value: number[]; reset: number[] }

export function columnWidths(rows: Cell[][]): ColumnWidths {
  const widths: ColumnWidths = { source: [], label: [], value: [], reset: [] }
  const grow = (column: number[], j: number, text = '') => {
    column[j] = Math.max(column[j] ?? 0, displayWidth(text))
  }
  for (const cells of rows) {
    cells.forEach((c, j) => {
      grow(widths.source, j, c.source)
      grow(widths.label, j, c.label)
      grow(widths.value, j, c.value)
      grow(widths.reset, j, c.reset)
    })
  }
  return widths
}

const padTo = (text: string, width = 0) => text + ' '.repeat(Math.max(0, width - displayWidth(text)))

// 흐린 조각은 이어 붙여, 그릴 Text 수를 줄인다. 줄 끝의 값은 채우지 않는다.
export function partsOf(cells: Cell[], widths: ColumnWidths = columnWidths([cells])): Part[] {
  const parts: Part[] = []
  const add = (p: Part) => {
    const last = parts.at(-1)
    if (last && !last.color && !p.color && !last.isStrong && !p.isStrong) last.text += p.text
    else parts.push({ ...p })
  }
  const named = (text: string, width = 0) => (width ? `${padTo(text, width)} ` : '')
  cells.forEach((c, j) => {
    const isLast = j === cells.length - 1
    const resetWidth = widths.reset[j] ?? 0
    add({ text: `${j ? ` ${SEPARATOR} ` : ''}${named(c.source ?? '', widths.source[j])}${named(c.label, widths.label[j])}` })
    // 막대는 데스크톱과 같이 채운 부분만 파랑(경고면 그 색)으로, 바탕은 흐리게 그린다.
    if (c.bar) {
      const { used, left } = barText(c.bar)
      if (used) add({ text: used, color: c.color ?? BAR_FILL })
      add({ text: `${left} ` })
    }
    add({ text: isLast && !c.reset ? c.value : padTo(c.value, widths.value[j]), isStrong: true, ...(c.color ? { color: c.color } : {}) })
    // 리셋은 한도 색을 따르지 않고 늘 흐리게 그린다.
    if (c.reset) add({ text: ` ${isLast ? c.reset : padTo(c.reset, resetWidth)}` })
    else if (!isLast && resetWidth) add({ text: ' '.repeat(resetWidth + 1) })
  })
  return parts
}

const textOf = (parts: Part[]) => parts.map(p => p.text).join('')

function render(entries: Entry[], now: number, step: Step, isStacked: boolean, text: Strings): Cell[][] {
  const cells = entries.map(e => cellsOf(e, now, step, isStacked, text))
  return isStacked ? cells : [cells.flat()]
}

// 그려질 폭을 재기 위한 사본. 로고를 그리는 표면에서는 로고가 있는 칸의 이름을 로고 폭의 빈칸으로 바꿔 잰다.
const LOGO_STAND_IN = ' '.repeat(LOGO_CELLS)
const asMeasured = (rows: Cell[][], hasLogos: boolean): Cell[][] =>
  hasLogos ? rows.map(cells => cells.map(c => (c.logo ? { ...c, source: LOGO_STAND_IN } : c))) : rows

// 소스 이름을 모른 채 쌍들을 줄로 만든다. 주간 등 한도가 더 온 소스가 있고 maxRows가 허락하면 소스마다 한 줄,
// 아니면 모두 한 줄이다. columns 칸에 들어가는 가장 자세한 단계를 고른다.
// hasLogos: 이름 대신 로고를 그리는 표면(데스크톱). 폭을 잴 때만 쓰고, 돌려주는 칸은 그대로다.
// firstRowTail: 첫 줄 끝에 붙는 것(새로고침 버튼)의 칸 수. 첫 줄만 그만큼 좁게 재므로, 더 긴 아래 줄은 폭을 다 쓴다.
export function formatRows(
  entries: Entry[],
  now = 0,
  columns = Infinity,
  maxRows = Infinity,
  lang: Lang = DEFAULT_LANG,
  hasLogos = false,
  firstRowTail = 0,
): Cell[][] {
  const text = STRINGS[lang]
  const isStacked = entries.length <= maxRows && entries.some(e => e.reading?.kind === 'percent' && (e.reading.secondary || e.reading.extra))
  for (const step of STEPS) {
    const rows = render(entries, now, step, isStacked, text)
    const measured = asMeasured(rows, hasLogos)
    const widths = columnWidths(measured)
    if (measured.every((cells, i) => displayWidth(textOf(partsOf(cells, widths))) + (i === 0 ? firstRowTail : 0) <= columns)) return rows
  }
  return render(entries, now, STEPS[STEPS.length - 1]!, isStacked, text)
}

const lineOf = (rows: Cell[][]) => {
  const widths = columnWidths(rows)
  return rows.map(cells => textOf(partsOf(cells, widths))).join('\n')
}

export const formatLine = (entries: Entry[], now = 0, columns = Infinity, maxRows = Infinity, lang: Lang = DEFAULT_LANG) =>
  lineOf(formatRows(entries, now, columns, maxRows, lang))

// 등록된 목록과 저장된 readings를 합쳐 줄로. 목록이 무엇이든 상관없다.
// 수명(기본은 조회 간격의 2배)이 지난 값은 없는 값으로 그린다.
// 설치되지 않은 소스는 줄을 차지하지 않는다. 모두 설치되지 않았으면 밴드가 비지 않도록 그 사실을 그린다.
export function rowsFor(
  list: { id: string; label: string; short?: string; logo?: string; ttlMs?: number; maxAgeMs?: number }[],
  readings: Record<string, Reading | null>,
  now = 0,
  columns = Infinity,
  maxRows = Infinity,
  attempts: Record<string, Attempt> = {},
  lang: Lang = DEFAULT_LANG,
  hasLogos = false,
  firstRowTail = 0,
): Cell[][] {
  const entries: Entry[] = list.map(p => {
    const r = readings[p.id]
    const maxAge = p.maxAgeMs ?? 2 * (p.ttlMs ?? DEFAULT_TTL_MS)
    const named = { label: p.label, short: p.short, ...(p.logo ? { logo: p.logo } : {}) }
    if (r && now - r.observedAt <= maxAge) return { ...named, reading: r }
    const last = attempts[p.id]
    const trouble: Trouble | undefined = last && !last.isOk ? (last.isMissing ? 'missing' : 'failed') : r ? 'stale' : undefined
    return { ...named, reading: null, ...(trouble ? { trouble } : {}) }
  })
  const installed = entries.filter(e => e.trouble !== 'missing')
  return formatRows(installed.length ? installed : entries, now, columns, maxRows, lang, hasLogos, firstRowTail)
}

export const lineFor = (...args: Parameters<typeof rowsFor>) => lineOf(rowsFor(...args))
