import { expect, mock, test } from 'claude-code/testing'

import { parseUsage } from './providers/gemini-parse'

// 픽스처는 직접 만든 가짜 값이다. 탭 구분.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const row = (...c: string[]) => c.join('\t')
const SAMPLE = [
  row('Gemini Models', 'Weekly Limit Remaining', '90%', '2026-11-10T00:00:00Z'),
  row('Gemini Models', 'Five Hour Limit Remaining', '75%', '2026-11-04T13:00:00Z'),
  row('Claude and GPT models', 'Five Hour Limit Remaining', '10%', '2026-11-04T13:00:00Z'),
].join('\n')

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 26, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

type Run = 'ok' | 'exit1' | 'throw' | 'garbage' | 'login'

function world(on: any, run: Run) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  const calls: string[][] = []
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_: unknown, e: any) => {
    calls.push([...e.argv])
    if (e.argv[0] !== 'agy') return { value: { exitCode: 1, stdout: '', stderr: '' } }
    if (run === 'throw') throw new Error('spawn failed')
    if (run === 'exit1') return { value: { exitCode: 1, stdout: '', stderr: 'x' } }
    if (run === 'garbage') return { value: { exitCode: 0, stdout: 'no rows here', stderr: '' } }
    if (run === 'login') return { value: { exitCode: 0, stdout: 'Please sign in to continue\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: SAMPLE + '\n', stderr: '' } }
  })
  return { clock, calls }
}

async function shown($: any, clock: { settle: () => Promise<void> }, surface: 'terminal' | 'desktop' = 'desktop') {
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface })
  const text: string | undefined = (await ui.find({ type: 'Text', text: /Gemini/ }))?.text
  await ui.unmount()
  return text?.split(' · ').find(x => x.startsWith('Gemini'))
}

test('the Gemini five-hour window is shown as used percent, on both surfaces', async ($, on) => {
  const { clock, calls } = world(on, 'ok')
  expect(await shown($, clock, 'terminal')).toBe('Gemini(AG) 25%')
  expect(calls.find(a => a[0] === 'agy')).toEqual(['agy', '--print-timeout', '12s', '-p=/usage'])
})

for (const run of ['exit1', 'throw', 'garbage', 'login'] as const) {
  test(`agy ${run}: a dash, and the other source is unaffected`, async ($, on) => {
    const { clock } = world(on, run)
    expect(await shown($, clock)).toBe('Gemini(AG) —')
  })
}

test('a failing agy does not blank Codex', async ($, on) => {
  const { clock } = world(on, 'throw')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const text = (await ui.find({ type: 'Text', text: /Codex/ }))?.text
  await ui.unmount()
  expect(text).toBe('Codex — · Gemini(AG) —')
})

test('parseUsage: weekly is the fallback, remaining becomes used, other groups are ignored', () => {
  const weekly = row('Gemini Models', 'Weekly Limit Remaining', '90%', '2026-11-10T00:00:00Z')
  expect(parseUsage(weekly, NOW)).toEqual({ kind: 'percent', percent: 10, windowMs: 7 * 86_400_000, resetsAt: Date.parse('2026-11-10T00:00:00Z'), observedAt: NOW })
  expect(parseUsage(row('Claude and GPT models', 'Five Hour Limit Remaining', '10%', 'x'), NOW)).toBeUndefined()
  expect(parseUsage(row('Gemini Models', 'Five Hour Limit Remaining', '100%', 'bad'), NOW)).toEqual({ kind: 'percent', percent: 0, windowMs: 5 * 3_600_000, observedAt: NOW })
})

test('parseUsage: with both limits, the weekly one comes along as used percent', () => {
  const text = [
    row('Gemini Models', 'Weekly Limit Remaining', '90%', '2026-11-10T00:00:00Z'),
    row('Gemini Models', 'Five Hour Limit Remaining', '75%', '2026-11-04T13:00:00Z'),
  ].join('\n')
  expect(parseUsage(text, NOW)).toEqual({
    kind: 'percent',
    percent: 25,
    windowMs: 5 * 3_600_000,
    resetsAt: Date.parse('2026-11-04T13:00:00Z'),
    secondary: { percent: 10, windowMs: 7 * 86_400_000, resetsAt: Date.parse('2026-11-10T00:00:00Z') },
    observedAt: NOW,
  })
})
