import { expect, mock, test } from 'claude-code/testing'

// 픽스처는 직접 만든 가짜 값이다.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const MIN = 60_000
const SEC = Math.floor(NOW / 1000)

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 26, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const LIVE = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 31, windowDurationMins: 300, resetsAt: SEC + 7200 }] })
const AGY = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.75, reset_time: '2026-11-04T13:00:00Z' }] }] } } }) + '\n'

type Mode = { codex: 'ok' | 'fail'; agy: 'ok' | 'fail' }

function world(on: any, mode: Mode, stored?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, stored)
  mock.env(on, { HOME: '/home/test' })
  const calls = { node: 0, agy: 0 }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_: unknown, e: any) => {
    if (e.argv[0] === 'node') {
      calls.node++
      return { value: { exitCode: mode.codex === 'ok' ? 0 : 1, stdout: mode.codex === 'ok' ? LIVE : '', stderr: '' } }
    }
    if (e.argv[0] === 'agy') {
      calls.agy++
      if (mode.agy === 'fail') throw new Error('agy failed')
      return { value: { exitCode: 0, stdout: AGY, stderr: '' } }
    }
    throw new Error('unexpected ' + e.argv[0])
  })
  return { clock, calls }
}

async function start($: any, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
}

async function line($: any, surface: 'terminal' | 'desktop' = 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const text: string | undefined = (await ui.find({ type: 'Text', text: /Codex/ }))?.text
  await ui.unmount()
  return text
}

test('nothing is queried again within three minutes, then Codex is queried once more', async ($, on) => {
  const { clock, calls } = world(on, { codex: 'ok', agy: 'ok' })
  await start($, clock)
  expect(calls).toEqual({ node: 1, agy: 1 })

  await clock.advance(2 * MIN + 30_000)
  expect(calls).toEqual({ node: 1, agy: 1 })

  await clock.advance(MIN)
  expect(calls).toEqual({ node: 2, agy: 1 })
})

test('drawing the band never queries anything', async ($, on) => {
  const { clock, calls } = world(on, { codex: 'ok', agy: 'ok' })
  await start($, clock)
  const before = { ...calls }
  for (const surface of ['terminal', 'desktop'] as const) {
    for (let i = 0; i < 3; i++) await line($, surface)
  }
  expect(calls).toEqual(before)
  expect(await line($)).toBe('Codex 31% · Gemini(AG) 25%')
})

test('one source failing leaves the other intact, on both surfaces', async ($, on) => {
  const { clock } = world(on, { codex: 'ok', agy: 'fail' })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await line($, surface)).toBe('Codex 31% · Gemini(AG) —')
  }
})

test('the other way round: Codex failing leaves Gemini intact', async ($, on) => {
  const { clock } = world(on, { codex: 'fail', agy: 'ok' })
  await start($, clock)
  expect(await line($)).toBe('Codex — · Gemini(AG) 25%')
})

test('a failed Gemini is not retried for thirty minutes; Codex keeps its three', async ($, on) => {
  const { clock, calls } = world(on, { codex: 'ok', agy: 'fail' })
  await start($, clock)
  expect(calls).toEqual({ node: 1, agy: 1 })

  await clock.advance(10 * MIN)
  expect(calls.agy).toBe(1)
  expect(calls.node).toBe(4)

  await clock.advance(20 * MIN + 30_000)
  expect(calls.agy).toBe(2)
})

test('a recent attempt from an earlier session is respected on a new start', async ($, on) => {
  const { clock, calls } = world(on, { codex: 'ok', agy: 'ok' }, {
    'attempts-v4': { codex: NOW - MIN, gemini: NOW - MIN },
    'readings-v4': { codex: { kind: 'percent', percent: 9, observedAt: NOW - MIN }, gemini: null },
  })
  await start($, clock)
  expect(calls).toEqual({ node: 0, agy: 0 })
  expect(await line($)).toBe('Codex 9% · Gemini(AG) —')
})

test('after the three minutes of an old attempt the source is queried', async ($, on) => {
  const { clock, calls } = world(on, { codex: 'ok', agy: 'ok' }, { 'attempts-v4': { codex: NOW - 4 * MIN, gemini: NOW - 16 * MIN } })
  await start($, clock)
  expect(calls).toEqual({ node: 1, agy: 1 })
})
