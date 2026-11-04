import { expect, mock, test } from 'claude-code/testing'

import { gemini } from './providers/gemini'
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
  props: { hasSurvey: false, isWorking: false, bodyColumns: 30, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

type Run = 'ok' | 'exit1' | 'throw' | 'garbage' | 'login' | 'argon'

function world(on: any, run: Run) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  const calls: string[][] = []
  const envs: (Record<string, string> | undefined)[] = []
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_: unknown, e: any) => {
    calls.push([...e.argv])
    envs.push(e.init?.env)
    if (e.argv[0] !== 'agy') return { value: { exitCode: 1, stdout: '', stderr: '' } }
    if (run === 'throw') throw new Error('spawn failed')
    if (run === 'exit1') return { value: { exitCode: 1, stdout: '', stderr: 'x' } }
    if (run === 'garbage') return { value: { exitCode: 0, stdout: 'no rows here', stderr: '' } }
    if (run === 'login') return { value: { exitCode: 0, stdout: 'Please sign in to continue\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: (run === 'argon' ? WITH_ARGON : SAMPLE) + '\n', stderr: '' } }
  })
  return { clock, calls, envs }
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

test('the reason agy failed comes with the failure, and a missing agy says so', async () => {
  const io = (run: () => Promise<unknown>) => ({ run, now: async () => NOW }) as any
  const failure = (run: () => Promise<unknown>) => gemini.read(io(run)).catch((e: any) => e)

  const missing = await failure(() => Promise.reject(new Error('spawn agy ENOENT')))
  expect([missing.message, missing.isMissing]).toEqual(['agy: spawn agy ENOENT', true])

  const late = await failure(() => Promise.reject(new Error('aborted: still running after 15000ms')))
  expect([late.message, late.isMissing]).toEqual(['agy: aborted: still running after 15000ms', false])

  const exited = await failure(async () => ({ exitCode: 3, stdout: '', stderr: ' no session\n' }))
  expect([exited.message, exited.isMissing]).toEqual(['agy exit 3: no session', false])

  const login = await failure(async () => ({ exitCode: 0, stdout: 'Please sign in\n', stderr: '' }))
  expect([login.message, login.isMissing]).toEqual(['agy: 한도 줄 없음: Please sign in', false])
})

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
  expect(parseUsage(weekly, NOW)).toEqual({ kind: 'percent', percent: 10, resetsAt: Date.parse('2026-11-10T00:00:00Z'), observedAt: NOW })
  expect(parseUsage(row('Claude and GPT models', 'Five Hour Limit Remaining', '10%', 'x'), NOW)).toBeUndefined()
  expect(parseUsage(row('Gemini Models', 'Five Hour Limit Remaining', '100%', 'bad'), NOW)).toEqual({ kind: 'percent', percent: 0, observedAt: NOW })
})

test('parseUsage: with both limits, the weekly one comes along as used percent', () => {
  const text = [
    row('Gemini Models', 'Weekly Limit Remaining', '90%', '2026-11-10T00:00:00Z'),
    row('Gemini Models', 'Five Hour Limit Remaining', '75%', '2026-11-04T13:00:00Z'),
  ].join('\n')
  expect(parseUsage(text, NOW)).toEqual({
    kind: 'percent',
    percent: 25,
    resetsAt: Date.parse('2026-11-04T13:00:00Z'),
    secondary: { percent: 10, resetsAt: Date.parse('2026-11-10T00:00:00Z') },
    observedAt: NOW,
  })
})

test('agy runs with its self-updater turned off', async ($, on) => {
  const { clock, calls, envs } = world(on, 'ok')
  await shown($, clock)
  const i = calls.findIndex(argv => argv[0] === 'agy')
  expect(i).toBeGreaterThanOrEqual(0)
  expect(envs[i]).toEqual({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true' })
})

// agy 1.4.12의 출력 모양. 값은 가짜다. Argon 줄만 이름에 "Remaining"이 없지만 값은 똑같이 남은 %다.
const WITH_ARGON = [
  row('Gemini Models', 'Weekly Limit Remaining', '90%', '2026-11-10T00:00:00Z'),
  row('Gemini Models', 'Five Hour Limit Remaining', '75%', '2026-11-04T13:00:00Z'),
  row('Claude and GPT models', 'Weekly Limit Remaining', '10%', '2026-11-10T00:00:00Z'),
  row('Claude and GPT models', 'Five Hour Limit Remaining', '10%', '2026-11-04T13:00:00Z'),
  row('Gemini 4 Argon', 'Gemini 4 Argon Weekly Limit', '97%', '2026-11-09T12:00:00Z'),
].join('\n')

test('parseUsage: the Argon weekly limit comes along as used percent', () => {
  expect(parseUsage(WITH_ARGON, NOW)).toEqual({
    kind: 'percent',
    percent: 25,
    resetsAt: Date.parse('2026-11-04T13:00:00Z'),
    secondary: { percent: 10, resetsAt: Date.parse('2026-11-10T00:00:00Z') },
    extra: { label: 'Argon', short: 'Ar', percent: 3, resetsAt: Date.parse('2026-11-09T12:00:00Z') },
    observedAt: NOW,
  })
})

test('parseUsage: the Argon group is found under another model version, and is optional', () => {
  const next = WITH_ARGON.replaceAll('Gemini 4 Argon', 'Gemini 5 Argon')
  expect((parseUsage(next, NOW) as any).extra.percent).toBe(3)
  expect(parseUsage(SAMPLE, NOW)).not.toHaveProperty('extra')
  expect(parseUsage(row('Gemini 4 Argon', 'Gemini 4 Argon Weekly Limit', '97%', 'x'), NOW)).toBeUndefined() // Argon만으로는 값이 아니다
})

test('one agy run reaches the band with the Argon limit', async ($, on) => {
  const { clock, calls } = world(on, 'argon')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 200 } })
  const text: string | undefined = (await ui.find({ type: 'Text', text: /Argon/ }))?.text
  await ui.unmount()
  expect(text).toContain('Argon ╸───────── 3%')
  expect(calls.filter(a => a[0] === 'agy').length).toBe(1)
})
