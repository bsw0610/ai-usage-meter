import { expect, mock, test } from 'claude-code/testing'

// 픽스처는 직접 만든 가짜 값이다. 다른 세션은 저장소에 직접 써서 흉내 낸다.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const MIN = 60_000
const SEC = Math.floor(NOW / 1000)

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 26, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const LIVE = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 31, windowDurationMins: 300, resetsAt: SEC + 86_400 }] })
const AGY = ['Gemini Models', 'Five Hour Limit Remaining', '75%', '2026-11-05T13:00:00Z'].join('\t') + '\n'

function world(on: any, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test' })
  const store: Record<string, unknown> = { ...stored }
  const mode = { codex: 'ok', agy: 'ok', live: LIVE }
  const calls = { node: 0, agy: 0, agyArgv: [] as string[] }
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const log = { text: '' }
  on('fs.list', (_: unknown, e: any) => ({
    value:
      log.text && e.path.endsWith('/2026/11/04')
        ? [{ name: 'rollout-a.jsonl', kind: 'file', size: 100, mtimeMs: NOW - 120 * MIN, isLink: false }]
        : [],
  }))
  on('fs.read', () => ({ value: log.text }))
  on('process.run', (_: unknown, e: any) => {
    if (e.argv[0] === 'node') {
      calls.node++
      return { value: { exitCode: mode.codex === 'ok' ? 0 : 1, stdout: mode.codex === 'ok' ? mode.live : '', stderr: '' } }
    }
    if (e.argv[0] === 'agy') {
      calls.agy++
      calls.agyArgv = [...e.argv]
      if (mode.agy !== 'ok') throw new Error('agy failed')
      return { value: { exitCode: 0, stdout: AGY, stderr: '' } }
    }
    throw new Error('unexpected ' + e.argv[0])
  })
  return { clock, calls, mode, store, log }
}

async function start($: any, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
}

async function line($: any) {
  const ui = await $.ui.mount(BAND)
  const text: string | undefined = (await ui.find({ type: 'Text', text: /Codex/ }))?.text
  await ui.unmount()
  return text
}

test('agy runs every fifteen minutes on success while Codex keeps three', async ($, on) => {
  const { clock, calls } = world(on)
  await start($, clock)
  expect(calls.agy).toBe(1)

  await clock.advance(14 * MIN + 30_000)
  expect(calls.agy).toBe(1)
  expect(calls.node).toBe(5)

  await clock.advance(MIN)
  expect(calls.agy).toBe(2)
})

test('a failed agy waits thirty minutes, and its print timeout is twelve seconds', async ($, on) => {
  const { clock, calls, mode } = world(on)
  mode.agy = 'fail'
  await start($, clock)
  expect(calls.agy).toBe(1)
  expect(calls.agyArgv).toEqual(['agy', '--print-timeout', '12s', '-p=/usage'])

  await clock.advance(29 * MIN + 30_000)
  expect(calls.agy).toBe(1)

  await clock.advance(MIN)
  expect(calls.agy).toBe(2)
})

test('a reload within the interval runs nothing again', async ($, on) => {
  const { clock, calls } = world(on)
  await start($, clock)
  await start($, clock)
  await start($, clock)
  expect(calls.agy).toBe(1)
  expect(calls.node).toBe(1)
})

test("another session's attempt and reading are taken up at the next tick", async ($, on) => {
  const { clock, calls, store } = world(on)
  await start($, clock)
  expect(calls.agy).toBe(1)

  // 다른 세션이 14분 뒤에 agy를 돌렸다.
  await clock.advance(14 * MIN)
  const at = NOW + 14 * MIN
  store['attempts-v3'] = { ...(store['attempts-v3'] as object), gemini: { at, isOk: true } }
  store['readings-v3'] = {
    ...(store['readings-v3'] as object),
    gemini: { kind: 'percent', percent: 40, resetsAt: at + 3_600_000, observedAt: at },
  }

  await clock.advance(MIN)
  expect(calls.agy).toBe(1)
  expect(await line($)).toBe('Codex 31% · Gemini(AG) 40%')
})

test('a store write never brings back an older value from this session', async ($, on) => {
  const { clock, store } = world(on)
  await start($, clock)

  const later = NOW + 10 * 60 * MIN
  store['readings-v3'] = {
    ...(store['readings-v3'] as object),
    gemini: { kind: 'percent', percent: 40, resetsAt: later + 3_600_000, observedAt: later },
  }
  await clock.advance(3 * MIN + 30_000) // Codex만 다시 조회하고 저장소에 쓴다

  expect((store['readings-v3'] as any).gemini.percent).toBe(40)
})

test('a failure keeps the last value through its lifetime, then a dash', async ($, on) => {
  const { clock, mode } = world(on)
  await start($, clock)
  expect(await line($)).toBe('Codex 31% · Gemini(AG) 25%')

  mode.codex = 'fail'
  await clock.advance(5 * MIN)
  expect(await line($)).toBe('Codex 31% · Gemini(AG) 25%') // 3분 조회는 실패, 값은 아직 유효

  await clock.advance(2 * MIN)
  expect(await line($)).toBe('Codex — · Gemini(AG) 25%') // 수명(조회 간격의 2배) 초과
})

test('a stored value past its lifetime is not shown on a new start', async ($, on) => {
  const { clock } = world(on, {
    'attempts-v3': { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
    'readings-v3': {
      codex: { kind: 'percent', percent: 9, observedAt: NOW - 7 * MIN },
      gemini: { kind: 'percent', percent: 9, observedAt: NOW - 29 * MIN },
    },
  })
  await start($, clock)
  expect(await line($)).toBe('Codex — · Gemini(AG) 9%')
})

test('an attempt stored as a bare number by an older version still counts', async ($, on) => {
  const { clock, calls } = world(on, { 'attempts-v3': { codex: NOW - MIN, gemini: NOW - MIN } })
  await start($, clock)
  expect(calls.node).toBe(0)
  expect(calls.agy).toBe(0)
})

test('an old value read from the log just now is shown, not treated as expired', async ($, on) => {
  const { clock, mode, log } = world(on)
  mode.codex = 'fail'
  log.text =
    JSON.stringify({
      timestamp: new Date(NOW - 120 * MIN).toISOString(),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: { limit_id: 'codex', primary: { used_percent: 22, window_minutes: 300, resets_at: SEC + 3600 } },
      },
    }) + '\n'
  await start($, clock)
  expect(await line($)).toBe('Codex 22% · Gemini(AG) 25%')
})

test('values an older version keeps writing are not read back', async ($, on) => {
  // 이전 코드로 도는 세션이 쓴 값: 주간 한도가 없고, 조회 주기도 따로 돈다.
  const old = {
    readings: { codex: { kind: 'percent', percent: 99, resetsAt: NOW + 3_600_000, observedAt: NOW } },
    attempts: { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
    'readings-v2': { codex: { kind: 'percent', percent: 98, resetsAt: NOW + 3_600_000, observedAt: NOW } },
    'attempts-v2': { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
  }
  const { clock, calls, store } = world(on, old)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(calls.node).toBe(1) // 이전 버전의 조회 기록에 막히지 않는다
  expect((store['readings-v3'] as any).codex.percent).toBe(31)
  expect(store.readings).toEqual(old.readings) // 이전 버전의 값도 건드리지 않는다
  expect(store['readings-v2']).toEqual(old['readings-v2'])
})

const limits = (five: number, week: number) =>
  JSON.stringify({
    limitId: 'codex',
    windows: [
      { usedPercent: five, windowDurationMins: 300, resetsAt: SEC + 10_800 },
      { usedPercent: week, windowDurationMins: 10_080, resetsAt: SEC + 86_400 },
    ],
  })

test('each limit remembers when its value last moved, across polls', async ($, on) => {
  const { clock, mode, store } = world(on)
  mode.live = limits(80, 40)
  await start($, clock)
  const codex = () => (store['readings-v3'] as any).codex
  expect([codex().changedAt, codex().secondary.changedAt]).toEqual([NOW, NOW])

  await clock.advance(3 * MIN)
  expect(codex().observedAt).toBe(NOW + 3 * MIN)
  expect([codex().changedAt, codex().secondary.changedAt]).toEqual([NOW, NOW])

  mode.live = limits(81, 40)
  await clock.advance(3 * MIN)
  expect([codex().changedAt, codex().secondary.changedAt]).toEqual([NOW + 6 * MIN, NOW])
})

test('when the value stands still the warning goes, and it returns once the value moves', async ($, on) => {
  const { clock, mode } = world(on)
  const wide = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 200 } })
    const text: string | undefined = (await ui.find({ type: 'Text', text: /Codex/ }))?.text
    await ui.unmount()
    return text
  }
  mode.live = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 80, windowDurationMins: 300, resetsAt: SEC + 10_800 }] })
  await start($, clock)
  expect(await wide()).toContain('뒤 소진')

  await clock.advance(20 * MIN)
  expect(await wide()).toContain('80% (리셋 3h)')

  mode.live = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 85, windowDurationMins: 300, resetsAt: SEC + 10_800 }] })
  await clock.advance(3 * MIN)
  expect(await wide()).toContain('85% 약')
})
