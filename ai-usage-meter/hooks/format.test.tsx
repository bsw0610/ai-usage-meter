import { expect, mock, test } from 'claude-code/testing'

import { displayWidth, formatLine, lineFor } from './format'
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
  const full = 'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h)'
  const hours = 'Codex 18% 2h · Gemini(AG) 25% 3h'
  const plain = 'Codex 18% · Gemini(AG) 25%'
  const short = 'Cx 18% · AG 25%'
  expect(formatLine(entries, NOW)).toBe(full)
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
  expect(at(35 * 60_000)).toBe('A 1% (리셋 35m)')
  expect(at(10_000)).toBe('A 1% (리셋 1m)')
  expect(at(47 * HOUR)).toBe('A 1% (리셋 47h)')
  expect(at(5 * 24 * HOUR)).toBe('A 1% (리셋 5d)')
})

test('a passed reset shows 0% and no reset', () => {
  expect(formatLine([{ label: 'A', reading: percent(80, -HOUR) }], NOW)).toBe('A 0%')
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
    'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h) · Fake 50% (리셋 1h)',
  )
  expect(lineFor([...providers, fake], readings, NOW, 20)).toBe('Cx 18% · AG 25% · Fk 50%')
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
      expect((await ui.find({ type: 'Text', text: /Cx|Codex/ }))?.text).toBe(want)
      await ui.unmount()
    }
  }
}

test('the band sizes its line to bodyColumns, on both surfaces', async ($, on) => {
  await band($, on, [
    [80, 'Codex 18% (리셋 2h) · Gemini(AG) 25% (리셋 3h)'],
    [32, 'Codex 18% 2h · Gemini(AG) 25% 3h'],
    [26, 'Codex 18% · Gemini(AG) 25%'],
    [15, 'Cx 18% · AG 25%'],
    [10, 'Cx 18% · AG 25%'],
  ])
})
