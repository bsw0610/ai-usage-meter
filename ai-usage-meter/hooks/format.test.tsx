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
  expect(at(47 * HOUR)).toBe('A ╸───────── 1% (리셋 47h)')
  expect(at(5 * 24 * HOUR)).toBe('A ╸───────── 1% (리셋 5d)')
})

test('with room, a time under a day reads to the minute; a narrow line keeps whole hours', () => {
  const MINUTE = 60_000
  const left = (ms: number, columns?: number) => one(percent(30, ms), columns)
  expect(left(2 * HOUR + 32 * MINUTE)).toBe('A ━━━─────── 30% (리셋 2h32m)')
  expect(left(2 * HOUR)).toBe('A ━━━─────── 30% (리셋 2h)')
  expect(left(59 * MINUTE)).toBe('A ━━━─────── 30% (리셋 59m)')
  expect(left(23 * HOUR + 59 * MINUTE)).toBe('A ━━━─────── 30% (리셋 23h59m)')
  expect(left(45 * HOUR)).toBe('A ━━━─────── 30% (리셋 45h)')
  expect(left(2 * HOUR + 32 * MINUTE, displayWidth('A ━━━─────── 30% 3h'))).toBe('A ━━━─────── 30% 3h')

  const fast = windowed(60, 3 * HOUR + 30 * MINUTE) // 1시간 30분에 60%, 소진까지 1시간
  expect(one(fast)).toContain('약 1h 뒤 소진')
  const faster = windowed(55, 3 * HOUR + 30 * MINUTE) // 1시간 30분에 55%, 소진까지 약 1시간 14분
  expect(one(faster)).toContain('약 1h14m 뒤 소진')
})

test('a passed reset shows 0% and no reset', () => {
  expect(formatLine([{ label: 'A', reading: percent(80, -HOUR) }], NOW)).toBe('A ────────── 0%')
  expect(formatLine([{ label: 'A', reading: { ...percent(80, -HOUR), windowMs: 5 * HOUR } }], NOW)).toBe('A ────────── 0%')
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

const windowed = (p: number, resetIn: number, windowMs = 5 * HOUR, observedAt = NOW) => ({
  ...percent(p, resetIn),
  windowMs,
  observedAt,
})
const one = (reading: any, columns?: number) => formatLine([{ label: 'A', short: 'a', reading }], NOW, columns)
const colorOf = (reading: any) => partsOf(formatRows([{ label: 'A', reading }], NOW)[0]!).find(p => p.color)?.color

test('the bar marks the time gone by, and keeps ten cells', () => {
  expect(one(windowed(10, 4 * HOUR))).toBe('A ━─┃─────── 10% (리셋 4h)')
  expect(one(windowed(100, 30 * 60_000))).toBe('A ━━━━━━━━━┃ 100% (리셋 30m)')
  expect(one(percent(100, HOUR))).toBe('A ━━━━━━━━━━ 100% (리셋 1h)')
  expect(one(percent(99, HOUR))).toBe('A ━━━━━━━━━╸ 99% (리셋 1h)')
  expect(one(percent(0, HOUR))).toBe('A ────────── 0% (리셋 1h)')
})

test('faster than the window lasts: says when it runs out, in the warning color', () => {
  const fast = windowed(51, 4 * HOUR) // 5시간 창에서 1시간에 51%
  expect(one(fast)).toBe('A ━━┃━━───── 51% 약 58m 뒤 소진')
  expect(colorOf(fast)).toBe('warning')
  expect(one(fast, displayWidth('A ━━┃━━───── 51% 소진 58m'))).toBe('A ━━┃━━───── 51% 소진 58m')
  expect(one(fast, displayWidth('A 51% 약 58m 뒤 소진'))).toBe('A 51% 약 58m 뒤 소진')
  expect(one(fast, displayWidth('A 51%'))).toBe('A 51%')
  expect(one(fast, 1)).toBe('a 51%')
})

test('slower than the window lasts: shows the reset, with no color', () => {
  const slow = windowed(30, 2 * HOUR) // 3시간에 30%
  expect(one(slow)).toBe('A ━━━───┃─── 30% (리셋 2h)')
  expect(colorOf(slow)).toBeUndefined()
})

test('a value that stopped moving gets no projection, after a fifteenth of its window', () => {
  const still = (r: any, ago: number) => ({ ...r, changedAt: NOW - ago })
  const fast = windowed(51, 4 * HOUR)
  expect(one(still(fast, 19 * 60_000))).toContain('뒤 소진')
  expect(colorOf(still(fast, 19 * 60_000))).toBe('warning')
  expect(one(still(fast, 20 * 60_000))).toBe('A ━━┃━━───── 51% (리셋 4h)')
  expect(colorOf(still(fast, 20 * 60_000))).toBeUndefined()

  // 주간 값은 천천히 움직이므로 같은 비율이면 훨씬 오래 기다린다.
  const week = windowed(60, 3 * DAY, 7 * DAY)
  expect(colorOf(still(week, 11 * HOUR))).toBe('warning')
  expect(colorOf(still(week, 12 * HOUR))).toBeUndefined()

  // 다 쓴 한도는 멈춰 있어도 다 쓴 것이다.
  expect(colorOf(still(windowed(100, 4 * HOUR), 3 * HOUR))).toBe('error')
})

test('with room for one row, a limit standing still is not the urgent one', () => {
  const reading = { ...both(82, 3.116 * HOUR, 60, 3 * DAY), changedAt: NOW - HOUR }
  const line = formatLine([{ label: 'A', reading }, { label: 'B', reading: null }], NOW, Infinity, 1)
  expect(line).toContain('A 주간')
})

test('the rate comes from when the value was read, not from now', () => {
  // 30분 전에 읽은 값: 그때 5시간 창에서 1시간에 51%. 소진은 그로부터 약 58분 뒤라 지금부터 약 28분 뒤.
  const old = windowed(51, 3.5 * HOUR, 5 * HOUR, NOW - HOUR / 2)
  expect(one(old)).toContain('약 28m 뒤 소진')
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

test('the time tick moves with the clock, and the bar says what it shows', () => {
  const tick = (elapsedMs: number) => barSvg({ percent: 0, elapsedMs, windowMs: 5 * HOUR }).match(/x1="([\d.]+)" y1="1"/)?.[1]
  expect(tick(0)).toBe('2.00')
  expect(tick(5 * HOUR)).toBe('78.00')
  expect(Number(tick(HOUR + 60_000))).toBeGreaterThan(Number(tick(HOUR)))
  expect(barSvg({ percent: 50 })).not.toContain('y1="1"')
  expect(barAlt({ percent: 51.4, elapsedMs: HOUR, windowMs: 5 * HOUR })).toBe('51% 사용, 창의 20% 지남')
  expect(barAlt({ percent: 51.4 })).toBe('51% 사용')
})

test('a projection already past is dropped, since the value is stale', () => {
  // 40분 전에 읽은 값: 그때 기준 약 20분 뒤 소진이었으니 예측 시각이 지났다.
  const stale = windowed(80, 3.33 * HOUR, 5 * HOUR, NOW - (2 * HOUR) / 3)
  expect(one(stale)).toContain('(리셋 3h20m)')
  expect(colorOf(stale)).toBeUndefined()
})

test('the marker lands on the same cell for every tenth of the window', () => {
  for (let tenth = 0; tenth < 10; tenth++) {
    const cells = one(windowed(1, (5 * HOUR * (10 - tenth)) / 10)).split(' ')[1]!
    expect(cells.indexOf('┃')).toBe(tenth)
  }
})

test('no projection without enough to go on', () => {
  expect(colorOf(windowed(19, 4.9 * HOUR))).toBeUndefined() // 쓴 양이 적다
  expect(colorOf(windowed(0, 4.9 * HOUR))).toBeUndefined()
  expect(colorOf(percent(90, HOUR))).toBeUndefined() // 창 길이를 모른다
  expect(colorOf({ kind: 'percent', percent: 90, windowMs: 5 * HOUR, observedAt: NOW })).toBeUndefined() // 리셋 시각을 모른다
  expect(colorOf(windowed(90, 6 * HOUR))).toBeUndefined() // 창보다 리셋이 멀다
  expect(one(windowed(90, 6 * HOUR))).toBe('A ━━━━━━━━━─ 90% (리셋 6h)')
})

test('a window used up shows the reset in the error color', () => {
  const spent = windowed(100, 4 * HOUR)
  expect(one(spent)).toBe('A ━━┃━━━━━━━ 100% (리셋 4h)')
  expect(colorOf(spent)).toBe('error')
  expect(colorOf(percent(100, HOUR))).toBe('error')
})

test('a reading stored before windows existed still draws, as a bar with no marker', () => {
  const list = [{ id: 'old', label: 'Old' }]
  const stored = { old: { kind: 'percent' as const, percent: 60, resetsAt: NOW + HOUR, observedAt: NOW } }
  expect(lineFor(list, stored, NOW)).toBe('Old ━━━━━━──── 60% (리셋 1h)')
})

test('only the source running out is colored, and the line stays whole, on both surfaces', async ($, on) => {
  mock.clock(on, { now: NOW })
  const value = { codex: windowed(51, 4 * HOUR), gemini: windowed(10, 4 * HOUR) }
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
      expect(colored.map(t => [t.text, t.props.color])).toEqual([['━━┃━━───── 51% 약 58m 뒤 소진', 'warning']])
      expect((await ui.find({ type: 'Text', text: /Gemini/ }))?.text).toBe('Codex ━━┃━━───── 51% 약 58m 뒤 소진 · Gemini(AG) ━─┃─────── 10% (리셋 4h)')
    } else {
      expect(colored.map(t => [t.text, t.props.color])).toEqual([['51% 약 58m 뒤 소진', 'warning']])
      const [hot, cold] = await ui.findAll({ type: 'Svg' })
      expect(hot?.props.source).toContain('#d97706')
      expect(cold?.props.source).not.toContain('#d97706')
    }
    await ui.unmount()
  }
})

// 방금 조회한 값과 같은 모양: 5시간 창은 빠르고 주간 창은 여유 있다.
const both = (five: number, fiveLeft: number, week: number, weekLeft: number) => ({
  ...windowed(five, fiveLeft),
  secondary: { percent: week, resetsAt: NOW + weekLeft, windowMs: 7 * 24 * HOUR },
})
const DAY = 24 * HOUR

test('each source gets its own row with both limits, and the columns line up', () => {
  const list = [
    { label: 'Codex', short: 'Cx', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) },
    { label: 'Gemini(AG)', short: 'AG', reading: both(25, 3 * HOUR, 10, 5 * DAY) },
  ]
  expect(formatLine(list, NOW).split('\n')).toEqual([
    'Codex      ━━━┃━━━━── 82% 약 25m 뒤 소진 · 주간 ━━━━╸──┃── 46% (리셋 45h)',
    'Gemini(AG) ━━╸─┃───── 25% (리셋 3h)      · 주간 ━─┃─────── 10% (리셋 5d)',
  ])
  const narrow = formatLine(list, NOW, 50).split('\n')
  expect(narrow).toEqual(['Codex      82% 소진 25m · 주간 46% 45h', 'Gemini(AG) 25% 3h       · 주간 10% 5d'])
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
  expect(line(both(82, 3.116 * HOUR, 46, 45 * HOUR))).toContain('A ━━━┃━━━━── 82% 약 25m 뒤 소진') // 5시간 쪽이 빠르다
  expect(line(both(10, 4 * HOUR, 95, 4 * DAY))).toContain('A 주간') // 주간 쪽이 더 많이 썼다
  expect(line(both(100, 4 * HOUR, 95, 4 * DAY))).toContain('A ━━┃━━━━━━━ 100%') // 다 쓴 쪽이 먼저다
  expect(line(both(10, 4 * HOUR, 100, 4 * DAY))).toContain('A 주간') // 주간을 다 쓰면 5시간 여유는 소용없다
  expect(line(both(10, 4 * HOUR, 95, -HOUR))).not.toContain('주간') // 리셋이 지난 주간 창은 0%다
})

test('each limit is colored on its own', () => {
  expect(formatRows([{ label: 'A', reading: both(10, 4 * HOUR, 100, 4 * DAY) }], NOW)[0]!.map(c => c.color)).toEqual([undefined, 'error'])
  expect(formatRows([{ label: 'A', reading: both(82, 3.116 * HOUR, 46, 45 * HOUR) }], NOW)[0]!.map(c => c.color)).toEqual(['warning', undefined])
})

test('a stored reading with no weekly limit still draws on one line', () => {
  const stored = { codex: { kind: 'percent' as const, percent: 60, resetsAt: NOW + HOUR, windowMs: 5 * HOUR, observedAt: NOW } }
  expect(lineFor(providers, stored, NOW)).toBe('Codex ━━━━━━──┃─ 60% (리셋 1h) · Gemini(AG) —')
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
  expect((await terminal.find({ type: 'Text', text: /^Codex/ }))?.text).toBe('Codex      ━━━┃━━━━── 82% 약 25m 뒤 소진 · 주간 ━━━━╸──┃── 46% (리셋 45h)')
  expect((await terminal.find({ type: 'Text', text: /^Gemini/ }))?.text).toBe('Gemini(AG) ━━╸─┃───── 25% (리셋 3h)      · 주간 ━─┃─────── 10% (리셋 5d)')
  await terminal.unmount()

  const desktop = await mount('desktop', 5)
  expect((await desktop.findAll({ type: 'Svg' })).map((b: any) => b.props.alt)).toEqual([
    '82% 사용, 창의 38% 지남',
    '46% 사용, 창의 73% 지남',
    '25% 사용, 창의 40% 지남',
    '10% 사용, 창의 29% 지남',
  ])
  await desktop.unmount()

  const oneRow = await mount('desktop', 1)
  expect(await oneRow.findAll({ type: 'Svg' })).toHaveLength(2)
  await oneRow.unmount()
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
        expect(bars.map((b: any) => b.props.alt)).toEqual(['18% 사용, 창의 60% 지남', '25% 사용, 창의 40% 지남'])
        expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join(' ')).toBe(want.replace(/ [━╸─┃]+/g, ''))
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
    [80, 'Codex ━━────┃─── 18% (리셋 2h) · Gemini(AG) ━━╸─┃───── 25% (리셋 3h)'],
    [60, 'Codex ━━────┃─── 18% 2h · Gemini(AG) ━━╸─┃───── 25% 3h'],
    [50, 'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h)'],
    [32, 'Codex 18% 2h · Gemini(AG) 25% 3h'],
    [26, 'Codex 18% · Gemini(AG) 25%'],
    [15, 'Cx 18% · AG 25%'],
    [10, 'Cx 18% · AG 25%'],
  ])
})
