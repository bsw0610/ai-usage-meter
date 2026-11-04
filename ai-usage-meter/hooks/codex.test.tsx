import { expect, mock, test } from 'claude-code/testing'

import { parseRollout } from './providers/codex-parse'

// 픽스처는 모두 직접 만든 가짜 값이다.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const HOME = '/home/test'
const SEC = Math.floor(NOW / 1000)

const pad = (n: number) => String(n).padStart(2, '0')
const dayDir = (backDays: number) => {
  const d = new Date(NOW - backDays * 86_400_000)
  return `${HOME}/.codex/sessions/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

const win = (used: number, minutes: number, resetsInSec: number) => ({
  used_percent: used,
  window_minutes: minutes,
  resets_at: SEC + resetsInSec,
})
const tokenCount = (rl: unknown, at = '2026-11-04T09:59:00Z') =>
  JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } })
const limits = (primary: unknown, secondary: unknown, id = 'codex') => ({ limit_id: id, primary, secondary })

const LIVE = JSON.stringify({
  limitId: 'codex',
  windows: [
    { usedPercent: 31, windowDurationMins: 300, resetsAt: SEC + 7200 },
    { usedPercent: 44, windowDurationMins: 10080, resetsAt: SEC + 200000 },
  ],
})

type Setup = {
  live?: 'ok' | 'exit1' | 'throw' | 'garbage'
  files?: { name: string; size: number; dir?: number }[]
  texts?: Record<string, string>
  noFolders?: boolean
}

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 12, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

// 세션을 시작해 첫 조회를 돌리고, 밴드에 보이는 Codex 값을 돌려준다.
async function shown($: any, clock: { settle: () => Promise<void> }, surface: 'terminal' | 'desktop' = 'desktop') {
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface })
  const text: string | undefined = (await ui.find({ type: 'Text', text: /Cx/ }))?.text
  await ui.unmount()
  return text?.split(' │ ')[0]?.replace(/ +/g, ' ')
}

function world(on: any, s: Setup = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  mock.env(on, { HOME })
  const ran: string[][] = []
  on('process.run', (_: unknown, e: any) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'node') {
      if (s.live === 'throw') throw new Error('spawn failed')
      if (s.live === 'exit1') return { value: { exitCode: 1, stdout: '', stderr: '' } }
      if (s.live === 'garbage') return { value: { exitCode: 0, stdout: 'not json', stderr: '' } }
      if (s.live === 'ok') return { value: { exitCode: 0, stdout: LIVE + '\n', stderr: '' } }
      throw new Error('no live')
    }
    if (e.argv[0] === 'tail') {
      const t = s.texts?.[e.argv[3]]
      if (t === undefined) throw new Error('no such file')
      return { value: { exitCode: 0, stdout: t, stderr: '' } }
    }
    throw new Error('unexpected ' + e.argv[0])
  })
  on('fs.list', (_: unknown, e: any) => {
    if (s.noFolders) throw new Error('ENOENT')
    const out = (s.files ?? [])
      .filter(f => `${dayDir(f.dir ?? 0)}` === e.path)
      .map((f, i) => ({ name: f.name, kind: 'file', size: f.size, mtimeMs: NOW - i * 1000 - (f.dir ?? 0) * 86_400_000, isLink: false }))
    return { value: out }
  })
  on('fs.read', (_: unknown, e: any) => {
    const t = s.texts?.[e.path]
    if (t === undefined) throw new Error('over 4 MiB or missing')
    return { value: t }
  })
  return { ran, clock }
}

const pathOf = (name: string, dir = 0) => `${dayDir(dir)}/${name}`
const F = 'rollout-a.jsonl'
const one = (name: string, text: string) => ({ files: [{ name, size: 100 }], texts: { [pathOf(name)]: text } })

test('live helper wins over the log', async ($, on) => {
  const { ran, clock } = world(on, { live: 'ok', ...one(F, tokenCount(limits(win(5, 300, 100), null))) })
  expect(await shown($, clock)).toBe('Cx 31%')
  expect(ran.filter(a => a[0] === 'node').length).toBe(1)
  expect(ran.some(a => a[0] === 'tail')).toBe(false)
})

for (const live of ['exit1', 'throw', 'garbage'] as const) {
  test(`helper ${live}: the log is used`, async ($, on) => {
    const { clock } = world(on, { live, ...one(F, tokenCount(limits(win(18, 300, 3600), win(30, 10080, 90000)))) })
    expect(await shown($, clock)).toBe('Cx 18%')
  })
}

test('no log folder and no helper: a dash, on both surfaces', async ($, on) => {
  const { clock } = world(on, { noFolders: true })
  expect(await shown($, clock, 'terminal')).toBe('Cx —')
  expect(await shown($, clock, 'desktop')).toBe('Cx —')
})

test('a corrupt line is skipped and the last valid token_count is used', async ($, on) => {
  const text = [
    'partial line cut by tail "token_count',
    tokenCount(limits(win(10, 300, 100), null), '2026-11-04T09:00:00Z'),
    '{ not json token_count',
    tokenCount(limits(win(22, 300, 100), null), '2026-11-04T09:30:00Z'),
  ].join('\n')
  const { clock } = world(on, one(F, text))
  expect(await shown($, clock)).toBe('Cx 22%')
})

test('null rate_limits is unknown, never 0%', async ($, on) => {
  const text = tokenCount(limits(win(50, 300, 100), null)) + '\n' + tokenCount(null)
  const { clock } = world(on, one(F, text))
  expect(await shown($, clock)).toBe('Cx —')
})

test('windows are told apart by length, not by name; other limit ids are ignored', async ($, on) => {
  const text = [
    tokenCount(limits(win(60, 10080, 90000), win(12, 300, 1000))),
    tokenCount(limits(win(99, 300, 1000), null, 'codex_other')),
  ].join('\n')
  const { clock } = world(on, one(F, text))
  expect(await shown($, clock)).toBe('Cx 12%')
})

test('only a 7-day window falls back to it', async ($, on) => {
  const { clock } = world(on, one(F, tokenCount(limits(win(61, 10080, 90000), null))))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 12 } })
  expect((await ui.find({ type: 'Text', text: /Cx/ }))?.text).toBe('Cx Wk 61% │ AG —')
  await ui.unmount()
})

test('a window whose reset time has passed is shown as 0%', async ($, on) => {
  const { clock } = world(on, one(F, tokenCount(limits(win(80, 300, -60), null))))
  expect(await shown($, clock)).toBe('Cx 0%')
})

test('a file over 4 MiB is read through tail, and yesterday is checked too', async ($, on) => {
  const big = 'rollout-big.jsonl'
  const { ran, clock } = world(on, {
    files: [{ name: big, size: 5 * 1024 * 1024, dir: 1 }],
    texts: { [pathOf(big, 1)]: tokenCount(limits(win(33, 300, 500), null)) },
  })
  expect(await shown($, clock)).toBe('Cx 33%')
  expect(ran.find(a => a[0] === 'tail')?.slice(0, 3)).toEqual(['tail', '-c', '262144'])
})

test('the newest file without a token_count is passed over', async ($, on) => {
  const { clock } = world(on, {
    files: [{ name: 'rollout-new.jsonl', size: 50 }, { name: 'rollout-old.jsonl', size: 50 }],
    texts: {
      [pathOf('rollout-new.jsonl')]: JSON.stringify({ type: 'session_meta' }),
      [pathOf('rollout-old.jsonl')]: tokenCount(limits(win(7, 300, 100), null)),
    },
  })
  expect(await shown($, clock)).toBe('Cx 7%')
})

test('parseRollout: nothing found is undefined, not null', () => {
  expect(parseRollout('')).toBeUndefined()
  expect(parseRollout(JSON.stringify({ type: 'event_msg', payload: { type: 'other' } }))).toBeUndefined()
})

test('both windows are carried, and one alone stays the only limit', () => {
  const five = win(31, 300, 7200)
  const week = win(44, 10080, 200000)
  const both = parseRollout(tokenCount(limits(five, week)))
  expect(both).toMatchObject({ percent: 31, secondary: { percent: 44, resetsAt: (SEC + 200000) * 1000 } })
  const alone = parseRollout(tokenCount(limits(week, null)))
  expect(alone).toMatchObject({ percent: 44, isWeekly: true })
  expect(alone && 'secondary' in alone).toBe(false)
  expect(both && 'isWeekly' in both).toBe(false)
  expect(parseRollout(tokenCount(limits(five, null)))).not.toHaveProperty('isWeekly')
})
