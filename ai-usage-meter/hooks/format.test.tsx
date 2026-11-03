import { expect, mock, test } from 'claude-code/testing'

import { barAlt, barSvg, displayWidth, formatLine, formatRows, lineFor, partsOf } from './format'
import { providers } from './providers'

// 픽스처는 직접 만든 가짜 값이다.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const HOUR = 3_600_000
const SEC = Math.floor(NOW / 1000)

const percent = (p: number, resetIn?: number) => ({
  kind: 'percent' as const,
  percent: p,
  observedAt: NOW,
  ...(resetIn === undefined ? {} : { resetsAt: NOW + resetIn }),
})
const entries = [
  { label: 'Codex', short: 'Cx', reading: percent(18, 2 * HOUR) },
  { label: 'Gemini(AG)', short: 'AG', reading: percent(25, 3 * HOUR) },
]

test('the line narrows step by step as the room shrinks', () => {
  const barFull = 'Codex ━━──────── 18% (리셋 2h) · Gemini(AG) ━━╸─────── 25% (리셋 3h)'
  const barHours = 'Codex ━━──────── 18% 2h · Gemini(AG) ━━╸─────── 25% 3h'
  const full = 'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h)'
  const hours = 'Codex 18% 2h · Gemini(AG) 25% 3h'
  const plain = 'Codex 18% · Gemini(AG) 25%'
  const short = 'Cx 18% · AG 25%'
  expect(formatLine(entries, NOW)).toBe(barFull)
  expect(formatLine(entries, NOW, displayWidth(barFull))).toBe(barFull)
  expect(formatLine(entries, NOW, displayWidth(barFull) - 1)).toBe(barHours)
  expect(formatLine(entries, NOW, displayWidth(barHours) - 1)).toBe(full)
  expect(formatLine(entries, NOW, displayWidth(full))).toBe(full)
  expect(formatLine(entries, NOW, displayWidth(full) - 1)).toBe(hours)
  expect(formatLine(entries, NOW, displayWidth(hours))).toBe(hours)
  expect(formatLine(entries, NOW, displayWidth(hours) - 1)).toBe(plain)
  expect(formatLine(entries, NOW, displayWidth(plain))).toBe(plain)
  expect(formatLine(entries, NOW, displayWidth(plain) - 1)).toBe(short)
  expect(formatLine(entries, NOW, 3)).toBe(short) // 더 줄일 수 없으면 Text가 끝을 자른다
})

test('Hangul counts as two cells, and the separators as one', () => {
  expect(displayWidth('리셋')).toBe(4)
  expect(displayWidth('a · —')).toBe(5)
  expect(displayWidth('(리셋 2h)')).toBe(9)
})

test('the reset reads in minutes, hours or days', () => {
  const at = (ms: number) => formatLine([{ label: 'A', reading: percent(1, ms) }], NOW)
  expect(at(35 * 60_000)).toBe('A ╸───────── 1% (리셋 35m)')
  expect(at(10_000)).toBe('A ╸───────── 1% (리셋 1m)')
  expect(at(47 * HOUR)).toBe('A ╸───────── 1% (리셋 1일 23시간)')
  expect(at(5 * 24 * HOUR)).toBe('A ╸───────── 1% (리셋 5일)')
})

test('with room, a time under a day reads to the minute; a narrow line keeps whole hours', () => {
  const MINUTE = 60_000
  const left = (ms: number, columns?: number) => one(percent(30, ms), columns)
  expect(left(2 * HOUR + 32 * MINUTE)).toBe('A ━━━─────── 30% (리셋 2h32m)')
  expect(left(2 * HOUR)).toBe('A ━━━─────── 30% (리셋 2h)')
  expect(left(59 * MINUTE)).toBe('A ━━━─────── 30% (리셋 59m)')
  expect(left(23 * HOUR + 59 * MINUTE)).toBe('A ━━━─────── 30% (리셋 23h59m)')
  expect(left(45 * HOUR)).toBe('A ━━━─────── 30% (리셋 1일 21시간)')
  expect(left(2 * HOUR + 32 * MINUTE, displayWidth('A ━━━─────── 30% 3h'))).toBe('A ━━━─────── 30% 3h')
})

test('with room, a day or more reads in days and hours; a narrow line stays short', () => {
  const left = (ms: number, columns?: number) => one(percent(30, ms), columns)
  expect(left(44 * HOUR)).toBe('A ━━━─────── 30% (리셋 1일 20시간)')
  expect(left(24 * HOUR)).toBe('A ━━━─────── 30% (리셋 1일)')
  expect(left(48 * HOUR)).toBe('A ━━━─────── 30% (리셋 2일)')
  expect(left(5 * 24 * HOUR + 3 * HOUR)).toBe('A ━━━─────── 30% (리셋 5일 3시간)')
  expect(left(44 * HOUR, displayWidth('A ━━━─────── 30% 44h'))).toBe('A ━━━─────── 30% 44h')
})

test('a passed reset shows 0% and no reset', () => {
  expect(formatLine([{ label: 'A', reading: percent(80, -HOUR) }], NOW)).toBe('A ────────── 0%')
  expect(formatLine([{ label: 'A', reading: percent(80, -HOUR) }], NOW)).toBe('A ────────── 0%')
})

test('counts read short, and only the narrowest step drops the unit', () => {
  const count = (n: number) => ({ label: 'Gemini', short: 'G', reading: { kind: 'count' as const, count: n, unit: 'req', observedAt: NOW } })
  expect(formatLine([count(12)], NOW)).toBe('Gemini 12 req')
  expect(formatLine([count(1234)], NOW)).toBe('Gemini 1.2k req')
  expect(formatLine([count(12_345)], NOW)).toBe('Gemini 12k req')
  expect(formatLine([count(1234)], NOW, 8)).toBe('G 1.2k')
})

test('a dash stays a dash at every width, and a missing short name falls back to the label', () => {
  const list = [{ label: 'Codex', short: 'Cx', reading: null }, { label: 'New', reading: null }]
  expect(formatLine(list, NOW)).toBe('Codex — · New —')
  expect(formatLine(list, NOW, 8)).toBe('Cx — · New —')
})

test('a fourth provider narrows with the others', () => {
  const fake = { id: 'fake', label: 'Fake', short: 'Fk' }
  const readings = {
    codex: percent(18, 2 * HOUR),
    gemini: percent(25, 3 * HOUR),
    fake: percent(50, HOUR),
  }
  expect(lineFor([...providers, fake], readings, NOW, 200)).toBe(
    'Codex ━━──────── 18% (리셋 2h) · Gemini(AG) ━━╸─────── 25% (리셋 3h) · Fake ━━━━━───── 50% (리셋 1h)',
  )
  expect(lineFor([...providers, fake], readings, NOW, 20)).toBe('Cx 18% · AG 25% · Fk 50%')
})

const one = (reading: any, columns?: number) => formatLine([{ label: 'A', short: 'a', reading }], NOW, columns)
const colorOf = (reading: any) => partsOf(formatRows([{ label: 'A', reading }], NOW)[0]!).find(p => p.color)?.color

test('the bar keeps ten cells', () => {
  expect(one(percent(10, 4 * HOUR))).toBe('A ━───────── 10% (리셋 4h)')
  expect(one(percent(100, 30 * 60_000))).toBe('A ━━━━━━━━━━ 100% (리셋 30m)')
  expect(one(percent(100, HOUR))).toBe('A ━━━━━━━━━━ 100% (리셋 1h)')
  expect(one(percent(99, HOUR))).toBe('A ━━━━━━━━━╸ 99% (리셋 1h)')
  expect(one(percent(0, HOUR))).toBe('A ────────── 0% (리셋 1h)')
})

test('the color turns red from 90%, not before', () => {
  expect(colorOf(percent(89, HOUR))).toBeUndefined()
  expect(colorOf(percent(89.9, HOUR))).toBeUndefined()
  expect(colorOf(percent(90, HOUR))).toBe('error')
  expect(colorOf(percent(99, HOUR))).toBe('error')
  expect(colorOf(percent(95, -HOUR))).toBeUndefined() // 리셋이 지난 창은 0%다
})

test('the line moves with the value, with no steps', () => {
  const x2 = (svg: string) => [...svg.matchAll(/x2="([\d.]+)"/g)].map(m => Number(m[1]))
  const fillEnd = (percent: number) => x2(barSvg({ percent }))[1]!
  expect((fillEnd(50) - fillEnd(49)).toFixed(2)).toBe('0.76')
  expect(fillEnd(50.5)).toBeGreaterThan(fillEnd(50))
  expect(fillEnd(100)).toBe(78)
  expect(x2(barSvg({ percent: 0 }))).toHaveLength(1) // 채운 선 없이 바탕 선만
  expect(barSvg({ percent: 50 })).not.toContain('<rect')
})

test('the used line is blue, and red once the limit is used up', () => {
  expect(barSvg({ percent: 50 })).toContain('stroke="#2c84db"')
  expect(barSvg({ percent: 0 })).not.toContain('#2c84db')
  expect(barSvg({ percent: 100 }, 'error')).toContain('stroke="#dc2626"')
  expect(barSvg({ percent: 100 }, 'error')).not.toContain('#2c84db')
})

test('the bar is only the used line, and says what it shows', () => {
  expect(barSvg({ percent: 50 })).not.toContain('y1="1"')
  expect(barAlt({ percent: 51.4 })).toBe('51% 사용')
})

test('a window used up shows the reset in the error color', () => {
  expect(one(percent(100, 4 * HOUR))).toBe('A ━━━━━━━━━━ 100% (리셋 4h)')
  expect(colorOf(percent(100, HOUR))).toBe('error')
})

test('a reading stored with the window fields of an older version draws with no marker or warning', () => {
  const list = [{ id: 'old', label: 'Old' }]
  const stored: any = { old: { kind: 'percent', percent: 51, resetsAt: NOW + 4 * HOUR, windowMs: 5 * HOUR, changedAt: NOW, observedAt: NOW } }
  expect(lineFor(list, stored, NOW)).toBe('Old ━━━━━───── 51% (리셋 4h)')
})

test('only the limit used up is colored, and the line stays whole, on both surfaces', async ($, on) => {
  mock.clock(on, { now: NOW })
  const value = { codex: percent(100, 4 * HOUR), gemini: percent(10, 4 * HOUR) }
  on('state.get', () => ({ value: { value, version: 0 } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ai-usage-meter',
      component: 'AbovePrompt',
      requestId: 'band',
      surface,
      props: { hasSurvey: false, isWorking: false, bodyColumns: 100, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    })
    const colored = (await ui.findAll({ type: 'Text' })).filter(t => t.props.color)
    if (surface === 'terminal') {
      expect(colored.map(t => [t.text, t.props.color])).toEqual([['━━━━━━━━━━ 100% (리셋 4h)', 'error']])
      expect((await ui.find({ type: 'Text', text: /Gemini/ }))?.text).toBe('Codex ━━━━━━━━━━ 100% (리셋 4h) · Gemini(AG) ━───────── 10% (리셋 4h)')
    } else {
      expect(colored.map(t => [t.text, t.props.color])).toEqual([['100% (리셋 4h)', 'error']])
      const [hot, cold] = await ui.findAll({ type: 'Svg' })
      expect(hot?.props.source).toContain('#dc2626')
      expect(cold?.props.source).not.toContain('#dc2626')
    }
    await ui.unmount()
  }
})

const both = (five: number, fiveLeft: number, week: number, weekLeft: number) => ({
  ...percent(five, fiveLeft),
  secondary: { percent: week, resetsAt: NOW + weekLeft },
})
const DAY = 24 * HOUR

test('each source gets its own row with both limits, and the columns line up', () => {
  const list = [
    { label: 'Codex', short: 'Cx', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) },
    { label: 'Gemini(AG)', short: 'AG', reading: both(25, 3 * HOUR, 10, 5 * DAY) },
  ]
  expect(formatLine(list, NOW).split('\n')).toEqual([
    'Codex      ━━━━━━━━── 82% (리셋 3h7m) · 주간 ━━━━╸───── 46% (리셋 1일 21시간)',
    'Gemini(AG) ━━╸─────── 25% (리셋 3h)   · 주간 ━───────── 10% (리셋 5일)',
  ])
  const narrow = formatLine(list, NOW, 50).split('\n')
  expect(narrow).toEqual(['Codex      82% 3h · 주간 46% 45h', 'Gemini(AG) 25% 3h · 주간 10% 5d'])
  expect(formatLine(list, NOW, 10).split('\n')).toEqual(['Cx 82% · 주 46%', 'AG 25% · 주 10%'])
})

test('a source with one limit or none keeps its row, and nothing stacks without a weekly limit', () => {
  const stacked = formatLine([
    { label: 'Codex', reading: both(10, 4 * HOUR, 46, 45 * HOUR) },
    { label: 'Gemini(AG)', reading: null },
  ], NOW)
  expect(stacked.split('\n')[1]).toBe('Gemini(AG) —')
  expect(formatLine([{ label: 'A', reading: percent(1) }, { label: 'B', reading: null }], NOW)).toBe('A ╸───────── 1% · B —')
})

test('with room for one row, each source shows its more urgent limit', () => {
  const line = (reading: any) => formatLine([{ label: 'A', reading }, { label: 'B', reading: null }], NOW, Infinity, 1)
  expect(line(both(82, 3.116 * HOUR, 46, 45 * HOUR))).toContain('A ━━━━━━━━── 82%') // 5시간 쪽이 더 많이 썼다
  expect(line(both(10, 4 * HOUR, 95, 4 * DAY))).toContain('A 주간') // 주간 쪽이 더 많이 썼다
  expect(line(both(100, 4 * HOUR, 95, 4 * DAY))).toContain('A ━━━━━━━━━━ 100%') // 다 쓴 쪽이 먼저다
  expect(line(both(10, 4 * HOUR, 100, 4 * DAY))).toContain('A 주간') // 주간을 다 쓰면 5시간 여유는 소용없다
  expect(line(both(10, 4 * HOUR, 95, -HOUR))).not.toContain('주간') // 리셋이 지난 주간 창은 0%다
})

test('each limit is colored on its own', () => {
  expect(formatRows([{ label: 'A', reading: both(10, 4 * HOUR, 100, 4 * DAY) }], NOW)[0]!.map(c => c.color)).toEqual([undefined, 'error'])
  expect(formatRows([{ label: 'A', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) }], NOW)[0]!.map(c => c.color)).toEqual([undefined, undefined])
})

test('a dash says why at the widths that have room', () => {
  const list = [{ id: 'a', label: 'Alpha', short: 'A' }]
  const old = { a: { kind: 'percent' as const, percent: 9, observedAt: NOW - HOUR } }
  const failed = { a: { at: NOW, isOk: false } }
  const missing = { a: { at: NOW, isOk: false, isMissing: true } }
  const ok = { a: { at: NOW, isOk: true } }
  const at = (readings: any, attempts?: any, columns = Infinity) => lineFor(list, readings, NOW, columns, Infinity, attempts)

  expect(at({})).toBe('Alpha —') // 아직 결과가 없다
  expect(at({}, ok)).toBe('Alpha —') // 첫 조회 중
  expect(at({}, failed)).toBe('Alpha — 실패')
  expect(at({}, missing)).toBe('Alpha — 미설치')
  expect(at(old, ok)).toBe('Alpha — 오래됨')
  expect(at(old)).toBe('Alpha — 오래됨')
  expect(at(old, failed)).toBe('Alpha — 실패')

  // 유효한 값은 조회가 실패해도 그대로 그린다.
  expect(at({ a: percent(9) }, failed)).toContain('9%')

  // 칸이 모자라면 줄표만 남긴다.
  expect(at({}, failed, displayWidth('Alpha —'))).toBe('Alpha —')
  expect(at({}, failed, displayWidth('A —'))).toBe('A —')
})

test('a stored reading with no weekly limit still draws on one line', () => {
  const stored = { codex: { kind: 'percent' as const, percent: 60, resetsAt: NOW + HOUR, observedAt: NOW } }
  expect(lineFor(providers, stored, NOW)).toBe('Codex ━━━━━━──── 60% (리셋 1h) · Gemini(AG) —')
})

test('the band draws one row per source, on both surfaces', async ($, on) => {
  mock.clock(on, { now: NOW })
  const value = { codex: both(82, 3.116 * HOUR, 46, 45 * HOUR), gemini: both(25, 3 * HOUR, 10, 5 * DAY) }
  on('state.get', () => ({ value: { value, version: 0 } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const props = { hasSurvey: false, isWorking: false, bodyColumns: 100, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} }
  const mount = (surface: 'terminal' | 'desktop', maxRows: number) =>
    $.ui.mount({ plugin: 'ai-usage-meter', component: 'AbovePrompt', requestId: 'band', surface, props: { ...props, maxRows } })

  const terminal = await mount('terminal', 5)
  expect((await terminal.find({ type: 'Text', text: /^Codex/ }))?.text).toBe('Codex      ━━━━━━━━── 82% (리셋 3h7m) · 주간 ━━━━╸───── 46% (리셋 1일 21시간)')
  expect((await terminal.find({ type: 'Text', text: /^Gemini/ }))?.text).toBe('Gemini(AG) ━━╸─────── 25% (리셋 3h)   · 주간 ━───────── 10% (리셋 5일)')
  await terminal.unmount()

  const desktop = await mount('desktop', 5)
  expect((await desktop.findAll({ type: 'Svg' })).map((b: any) => b.props.alt)).toEqual([
    '82% 사용',
    '46% 사용',
    '25% 사용',
    '10% 사용',
  ])
  await desktop.unmount()

  const oneRow = await mount('desktop', 1)
  expect(await oneRow.findAll({ type: 'Svg' })).toHaveLength(2)
  await oneRow.unmount()
})

test('each language has its own words for the reset, the days, the weekly limit and the bar', () => {
  const list = [{ label: 'Codex', short: 'Cx', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) }]
  const line = (lang: 'en' | 'ja', columns = Infinity) => formatLine(list, NOW, columns, Infinity, lang)

  expect(line('en')).toBe('Codex ━━━━━━━━── 82% (resets 3h7m) · Weekly ━━━━╸───── 46% (resets 1d 21h)')
  expect(line('en', 40)).toBe('Codex 82% 3h · Weekly 46% 45h')
  expect(line('en', 10)).toBe('Cx 82% · Wk 46%')
  expect(barAlt({ percent: 51.4 }, 'en')).toBe('51% used')

  expect(line('ja')).toBe('Codex ━━━━━━━━── 82% (リセット 3h7m) · 週間 ━━━━╸───── 46% (リセット 1日21時間)')
  expect(line('ja', 40)).toBe('Codex 82% 3h · 週間 46% 45h')
  expect(line('ja', 10)).toBe('Cx 82% · 週 46%')
  expect(barAlt({ percent: 51.4 }, 'ja')).toBe('51%使用')

  const whole = (lang: 'en' | 'ja', ms: number) => formatLine([{ label: 'A', reading: percent(1, ms) }], NOW, Infinity, Infinity, lang)
  expect(whole('en', 48 * HOUR)).toBe('A ╸───────── 1% (resets 2d)')
  expect(whole('ja', 48 * HOUR)).toBe('A ╸───────── 1% (リセット 2日)')
})

test('each language says why a value is missing', () => {
  const list = [{ id: 'a', label: 'Alpha', short: 'A' }]
  const old = { a: { kind: 'percent' as const, percent: 9, observedAt: NOW - HOUR } }
  const failed = { a: { at: NOW, isOk: false } }
  const missing = { a: { at: NOW, isOk: false, isMissing: true } }
  const at = (lang: 'en' | 'ja', readings: any, attempts?: any) => lineFor(list, readings, NOW, Infinity, Infinity, attempts, lang)

  expect(at('en', {}, failed)).toBe('Alpha — failed')
  expect(at('en', {}, missing)).toBe('Alpha — not installed')
  expect(at('en', old)).toBe('Alpha — stale')
  expect(at('ja', {}, failed)).toBe('Alpha — 失敗')
  expect(at('ja', {}, missing)).toBe('Alpha — 未インストール')
  expect(at('ja', old)).toBe('Alpha — 古い値')
})

test('kana counts as two cells, so a narrow Japanese line shrinks in time', () => {
  expect(displayWidth('リセット')).toBe(8)
  expect(displayWidth('未インストール')).toBe(14)
})

test('at the width of a real window, every language keeps both limits with their reset', () => {
  const list = [
    { label: 'Codex', short: 'Cx', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) },
    { label: 'Gemini(AG)', short: 'AG', reading: both(25, 3 * HOUR, 10, 5 * DAY) },
  ]
  const rows = (lang: 'ko' | 'en' | 'ja') => formatLine(list, NOW, 85, Infinity, lang).split('\n')
  expect(rows('ko')[0]).toBe('Codex      ━━━━━━━━── 82% (리셋 3h7m) · 주간 ━━━━╸───── 46% (리셋 1일 21시간)')
  expect(rows('en')[0]).toBe('Codex      ━━━━━━━━── 82% (resets 3h7m) · Weekly ━━━━╸───── 46% (resets 1d 21h)')
  expect(rows('ja')[0]).toBe('Codex      ━━━━━━━━── 82% (リセット 3h7m) · 週間 ━━━━╸───── 46% (リセット 1日21時間)')
})

for (const [language, row, alt] of [
  ['en', 'Codex      ━━━━━━━━── 82% (resets 3h7m) · Weekly ━━━━╸───── 46% (resets 1d 21h)', '82% used'],
  ['ja', 'Codex      ━━━━━━━━── 82% (リセット 3h7m) · 週間 ━━━━╸───── 46% (リセット 1日21時間)', '82%使用'],
] as const) {
  test(`the language option reaches the band, on both surfaces: ${language}`, { options: { language } }, async ($, on) => {
    mock.clock(on, { now: NOW })
    const value = { codex: both(82, 3.116 * HOUR, 46, 45 * HOUR), gemini: both(25, 3 * HOUR, 10, 5 * DAY) }
    on('state.get', () => ({ value: { value, version: 0 } }))
    on('ui.render', () => ({ type: 'engine', ref: 0 }))
    const mount = (surface: 'terminal' | 'desktop') =>
      $.ui.mount({
        plugin: 'ai-usage-meter',
        component: 'AbovePrompt',
        requestId: 'band',
        surface,
        props: { hasSurvey: false, isWorking: false, bodyColumns: 100, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
      })

    const terminal = await mount('terminal')
    expect((await terminal.find({ type: 'Text', text: /^Codex/ }))?.text).toBe(row)
    await terminal.unmount()

    const desktop = await mount('desktop')
    expect((await desktop.findAll({ type: 'Svg' }))[0]?.props.alt).toBe(alt)
    await desktop.unmount()
  })
}

test('with no language chosen, or one not on the list, the band stays in Korean', { options: { language: 'fr' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('state.get', () => ({ value: { value: { codex: percent(50, HOUR) }, version: 0 } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const ui = await $.ui.mount({
    plugin: 'ai-usage-meter',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, bodyColumns: 100, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /^Codex/ }))?.text).toContain('(리셋 1h)')
  await ui.unmount()
})

const LIVE = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 18, windowDurationMins: 300, resetsAt: SEC + 7200 }] })
const AGY = ['Gemini Models', 'Five Hour Limit Remaining', '75%', new Date(NOW + 3 * HOUR).toISOString()].join('\t') + '\n'

async function band($: any, on: any, cases: [number, string][]) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_: unknown, e: any) => ({
    value: { exitCode: 0, stdout: e.argv[0] === 'node' ? LIVE : AGY, stderr: '' },
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [bodyColumns, want] of cases) {
      const ui = await $.ui.mount({
        plugin: 'ai-usage-meter',
        component: 'AbovePrompt',
        requestId: 'band',
        surface,
        props: { hasSurvey: false, isWorking: false, bodyColumns, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
      })
      if (surface === 'desktop' && want.includes('━')) {
        // 막대가 있는 단계는 Svg로 그린다.
        const bars = await ui.findAll({ type: 'Svg' })
        expect(bars.map((b: any) => b.props.alt)).toEqual(['18% 사용', '25% 사용'])
        expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join(' ')).toBe(want.replace(/ [━╸─]+/g, ''))
      } else {
        expect((await ui.find({ type: 'Text', text: /Cx|Codex/ }))?.text).toBe(want)
        expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
      }
      await ui.unmount()
    }
  }
}

test('the band sizes its line to bodyColumns, on both surfaces', async ($, on) => {
  await band($, on, [
    [80, 'Codex ━━──────── 18% (리셋 2h) · Gemini(AG) ━━╸─────── 25% (리셋 3h)'],
    [60, 'Codex ━━──────── 18% 2h · Gemini(AG) ━━╸─────── 25% 3h'],
    [50, 'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h)'],
    [32, 'Codex 18% 2h · Gemini(AG) 25% 3h'],
    [26, 'Codex 18% · Gemini(AG) 25%'],
    [15, 'Cx 18% · AG 25%'],
    [10, 'Cx 18% · AG 25%'],
  ])
})
