import type { SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { claude, fable, parseFable, pick, withFable } from './providers/claude'
import { displayWidth } from './format'
import { bandText } from './shown'

// 픽스처는 직접 만든 가짜 값이다.
const NOW = Date.parse('2026-11-03T12:00:00Z')
const SEC = Math.floor(NOW / 1000)
const FIVE: SessionRateLimit = { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-11-03T14:30:00.000Z' }
const WEEK: SessionRateLimit = { kind: 'seven_day', percentUsed: 16, resetsAt: '2026-11-05T12:00:00.000Z' }

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, bodyColumns: 120, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const LIVE = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 31, windowDurationMins: 300, resetsAt: SEC + 7200 }] })
const AGY = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.75, reset_time: '2026-11-03T15:00:00Z' }] }] } } }) + '\n'

// get_usage에 대한 claude의 stream-json 출력. rateLimits가 null이면 구독이 아닌 계정이다.
const reply = (rateLimits: unknown, subtype = 'success') =>
  [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
    JSON.stringify({ type: 'control_response', response: { subtype, request_id: 'ai-usage-meter', response: { subscription_type: 'max', rate_limits: rateLimits } } }),
  ].join('\n') + '\n'
const FABLE_RESET = '2026-11-05T23:00:00.000000+00:00'
const SCOPED = (utilization: number | null = 42) => ({ five_hour: { utilization: 7 }, model_scoped: [{ display_name: 'Fable', utilization, resets_at: FABLE_RESET }] })

// usage: 세션을 시작할 때 엔진이 이미 알고 있는 한도. 없으면 session.usage를 답하지 않는다(실패해도 시작은 된다).
// claude: Fable 조회(claude -p)의 표준 출력. 없으면 claude가 없는 것처럼 실패한다.
function world(on: any, usage?: SessionRateLimit[], stored: Record<string, unknown> = {}, claudeOut?: string) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test' })
  const store: Record<string, unknown> = { ...stored }
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  if (usage) on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: usage } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.list', () => ({ value: [] }))
  const runs: any[] = []
  on('process.run', (_: unknown, e: any) => {
    if (e.argv[0] === 'claude') {
      runs.push(e)
      if (claudeOut === undefined) throw new Error('spawn claude ENOENT')
      return { value: { exitCode: 0, stdout: claudeOut, stderr: '' } }
    }
    if (e.argv[0] === 'node') return { value: { exitCode: 0, stdout: LIVE, stderr: '' } }
    if (e.argv[0] === 'agy') return { value: { exitCode: 0, stdout: AGY, stderr: '' } }
    throw new Error('unexpected ' + e.argv[0])
  })
  return { clock, store, runs }
}

async function start($: any, clock: { settle: () => Promise<void> }, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await clock.settle()
}

async function band($: any, surface: 'terminal' | 'desktop', props: Record<string, unknown> = {}) {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface })
  const text = await bandText(ui)
  const button = await ui.find({ type: 'Button', key: 'refresh' })
  await ui.unmount()
  return { text, button }
}

test('pick keeps both windows like Codex, marks a weekly-only reading, and ignores the rest', () => {
  expect(pick([WEEK, FIVE], NOW)).toEqual({
    kind: 'percent',
    percent: 7,
    resetsAt: Date.parse(FIVE.resetsAt!),
    secondary: { percent: 16, resetsAt: Date.parse(WEEK.resetsAt!) },
    observedAt: NOW,
  })
  expect(pick([FIVE], NOW)).toEqual({ kind: 'percent', percent: 7, resetsAt: Date.parse(FIVE.resetsAt!), observedAt: NOW })
  expect(pick([WEEK], NOW)).toEqual({ kind: 'percent', percent: 16, resetsAt: Date.parse(WEEK.resetsAt!), isWeekly: true, observedAt: NOW })
  expect(pick([{ kind: 'five_hour', percentUsed: 3 }], NOW)).toEqual({ kind: 'percent', percent: 3, observedAt: NOW })
  expect(pick([], NOW)).toBeUndefined()
  expect(pick([{ kind: 'spend_limit', percentUsed: 3 }], NOW)).toBeUndefined()
})

test('onMeasure keeps the last value when there is no figure', () => {
  expect(claude.onMeasure({ rateLimits: [] }, NOW)).toBeUndefined()
  expect(claude.onMeasure({ rateLimits: [FIVE] }, NOW)).toMatchObject({ percent: 7 })
})

test('the terminal shows Claude on the top row with the refresh button; the desktop does not', async ($, on) => {
  const { clock } = world(on)
  await start($, clock)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [FIVE, WEEK], changed: ['rateLimits'] })

  const terminal = await band($, 'terminal')
  const rows = terminal.text.split('\n')
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatch(/^Claude\s+5h ╸─+\s+7% 2h30m │ Wk ━╸─+\s+16% 2d$/)
  expect(rows[1]).toMatch(/^Codex\s+5h .* 31% 2h$/)
  expect(rows[2]).toMatch(/^Gemini\(AG\)\s+5h .* 25% 3h$/)
  expect(terminal.button?.props.label).toBe('↻')

  const desktop = await band($, 'desktop')
  expect(desktop.text).not.toContain('Claude')
  // 남은 두 소스는 5시간 한도뿐이라 한 줄에 놓인다.
  expect(desktop.text).toMatch(/^Codex .* │ Gemini\(AG\) /)
})

test('with no Claude figure yet, the terminal has no Claude row', async ($, on) => {
  const { clock } = world(on)
  await start($, clock)
  // 구독이 아니면 한도가 오지 않는다.
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })
  const { text } = await band($, 'terminal')
  expect(text).not.toContain('Claude')
  expect(text.split('\n')[0]).toMatch(/^Codex/)
})

test('a figure the engine already has at session start is shown at once and shared through the store', async ($, on) => {
  const { clock, store } = world(on, [WEEK])
  await start($, clock)
  const { text } = await band($, 'terminal')
  // 주간 한도 하나뿐이라 줄을 나누지 않는다. 한 줄에서도 맨 앞이다.
  expect(text).toMatch(/^Claude Wk .* 16% 2d │ Codex /)
  expect((store['readings-v5'] as any)?.claude).toMatchObject({ percent: 16, isWeekly: true })
})

test('a Claude value another session stored shows on the terminal, and is not looked up', async ($, on) => {
  const stored = { 'readings-v5': { claude: { kind: 'percent', percent: 42, resetsAt: NOW + 3_600_000, observedAt: NOW - 86_400_000 } } }
  const { clock, store } = world(on, undefined, stored)
  await start($, clock)
  const { text } = await band($, 'terminal')
  // 하루 전 값이어도, 값이 움직일 때만 오므로 그대로 믿는다.
  expect(text).toMatch(/^Claude 5h .* 42% 1h │ Codex /)
  expect((store['attempts-v5'] as any)?.claude).toBeUndefined()
})

test('turning the other sources off leaves Claude on the terminal', { options: { sources: 'codex' } }, async ($, on) => {
  const { clock } = world(on, [FIVE, WEEK])
  await start($, clock)
  const { text } = await band($, 'terminal')
  const rows = text.split('\n')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatch(/^Claude/)
  expect(rows[1]).toMatch(/^Codex/)
})

test('a terminal with room for only two rows puts all three sources on one line, Claude first', async ($, on) => {
  const { clock } = world(on, [FIVE, WEEK])
  await start($, clock)
  const { text } = await band($, 'terminal', { maxRows: 2, scroll: { offset: 0, bodyRows: 2 } })
  expect(text.split('\n')).toHaveLength(1)
  expect(text).toMatch(/^Claude .* │ Codex .* │ Gemini\(AG\) /)
})

test('parseFable takes only the Fable weekly window and says why when there is none', () => {
  expect(parseFable(reply(SCOPED()), NOW)).toEqual({ kind: 'percent', percent: 42, resetsAt: Date.parse(FABLE_RESET), isWeekly: true, observedAt: NOW })
  const other = { model_scoped: [{ display_name: 'Opus', utilization: 9, resets_at: null }, { display_name: 'Fable', utilization: 3, resets_at: null }] }
  expect(parseFable(reply(other), NOW)).toEqual({ kind: 'percent', percent: 3, isWeekly: true, observedAt: NOW })
  expect(parseFable(reply(SCOPED(null)), NOW)).toBe('no Fable window')
  expect(parseFable(reply({ model_scoped: [] }), NOW)).toBe('no Fable window')
  expect(parseFable(reply({}), NOW)).toBe('no Fable window')
  expect(parseFable(reply(null), NOW)).toBe('no plan limits')
  expect(parseFable(reply(null, 'error'), NOW)).toMatch(/^get_usage: /)
  expect(parseFable('not json\n', NOW)).toBe('no get_usage reply')
})

test('withFable adds the cell while the value is fresh and leaves the row alone otherwise', () => {
  const row = pick([FIVE, WEEK], NOW)!
  const f = { kind: 'percent' as const, percent: 42, resetsAt: NOW + 1000, isWeekly: true, observedAt: NOW }
  expect(withFable(row, f, NOW)).toMatchObject({ extra: { label: 'Fable', short: 'Fa', percent: 42, resetsAt: NOW + 1000 } })
  expect(withFable(row, f, NOW + 2 * fable.ttlMs! + 1)).toEqual(row)
  expect(withFable(row, null, NOW)).toEqual(row)
})

test('a terminal session asks a hook-free, MCP-free claude for Fable and shows it on the Claude row', async ($, on) => {
  const { clock, runs, store } = world(on, [FIVE, WEEK], {}, reply(SCOPED()))
  await start($, clock)
  expect(runs).toHaveLength(1)
  expect(runs[0].argv).toEqual(expect.arrayContaining(['claude', '-p', '--no-session-persistence', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}']))
  expect(JSON.parse(runs[0].init.stdin)).toEqual({ type: 'control_request', request_id: 'ai-usage-meter', request: { subtype: 'get_usage' } })
  expect(runs[0].init.cwd).toBe('/home/test')
  expect((store['readings-v5'] as any)?.fable).toMatchObject({ percent: 42 })

  const { text } = await band($, 'terminal')
  expect(text.split('\n')[0]).toMatch(/^Claude\s+5h .* 7% 2h30m │ Wk .* 16% 2d │ Fa \S+ 42% 2d 11h$/)
  // 데스크톱은 Claude 줄이 없으니 Fable도 없다.
  expect((await band($, 'desktop')).text).not.toContain('Fa ')
})

test('a desktop session never starts claude', async ($, on) => {
  const { clock, runs } = world(on, [FIVE, WEEK], {}, reply(SCOPED()))
  await start($, clock, 'desktop')
  await band($, 'desktop')
  await clock.advance(30 * 60_000)
  expect(runs).toHaveLength(0)
})

test('without claude on PATH, the Claude row stays and only the Fable cell is missing', async ($, on) => {
  const { clock, runs, store } = world(on, [FIVE, WEEK])
  await start($, clock)
  expect(runs).toHaveLength(1)
  // 테스트의 process.run은 ENOENT를 흉내 낼 수 없어(던지면 메시지가 바뀐다) 실패만 본다.
  expect((store['attempts-v5'] as any)?.fable).toMatchObject({ isOk: false })
  const { text } = await band($, 'terminal')
  expect(text.split('\n')[0]).toMatch(/^Claude\s+5h .* 16% 2d$/)
})

test('a stale Fable value drops its cell, not the row', async ($, on) => {
  const old = { kind: 'percent', percent: 42, resetsAt: NOW + 86_400_000, isWeekly: true, observedAt: NOW - 11 * 60_000 }
  const { clock } = world(on, [FIVE, WEEK], { 'readings-v5': { fable: old }, 'attempts-v5': { fable: { at: NOW - 60_000, isOk: false } } })
  await start($, clock)
  const { text } = await band($, 'terminal')
  expect(text.split('\n')[0]).toMatch(/^Claude .* 16% 2d$/)
})

test('with the Fable cell and the refresh button, no row runs past the band at any width', async ($, on) => {
  const { clock } = world(on, [FIVE, WEEK], {}, reply(SCOPED()))
  await start($, clock)
  const seen = new Set<string>()
  for (let cols = 50; cols <= 140; cols++) {
    const { text } = await band($, 'terminal', { bodyColumns: cols })
    const rows = text.split('\n')
    expect(rows[0]).toMatch(/ Fa /)
    // 첫 줄은 버튼(↻)과 사이 한 칸을 비워 둔다.
    const widest = Math.max(displayWidth(rows[0]!) + 2, ...rows.slice(1).map(displayWidth))
    expect(widest <= cols ? cols : `${widest} columns at ${cols}`).toBe(cols)
    seen.add(rows[0]!.includes('━') || rows[0]!.includes('─') ? 'bars' : 'no bars')
  }
  // 넓으면 막대가 있고, 좁아지면 모든 줄의 막대가 함께 빠진다.
  expect([...seen].sort()).toEqual(['bars', 'no bars'])
})

test('on the terminal, the Claude name is drawn in Claude Code orange and only the name', async ($, on) => {
  const { clock } = world(on, [FIVE, WEEK])
  await start($, clock)
  for (const bodyColumns of [120, 30]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    const texts: any[] = await ui.findAll({ type: 'Text' })
    const colored = texts.filter(t => t.props?.color === 'claude').map(t => t.text)
    // 좁으면 짧은 이름(Cl)도 같은 색이다. 칸을 맞추는 빈칸과 Codex·Gemini 이름은 칠하지 않는다.
    expect(colored).toEqual([bodyColumns === 120 ? 'Claude' : 'Cl'])
    expect((await bandText(ui)).split('\n')[0]).toMatch(bodyColumns === 120 ? /^Claude     5h / : /^Cl /)
    await ui.unmount()
  }
})
