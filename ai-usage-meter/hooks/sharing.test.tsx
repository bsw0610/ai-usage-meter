import { expect, mock, test } from 'claude-code/testing'

import { bandText } from './shown'

// 픽스처는 직접 만든 가짜 값이다. 다른 세션은 저장소에 직접 써서 흉내 낸다.
const NOW = Date.parse('2026-11-04T10:00:00Z')
const MIN = 60_000
const SEC = Math.floor(NOW / 1000)

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 12, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const LIVE = JSON.stringify({ limitId: 'codex', windows: [{ usedPercent: 31, windowDurationMins: 300, resetsAt: SEC + 86_400 }] })
const AGY = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.75, reset_time: '2026-11-05T13:00:00Z' }] }] } } }) + '\n'

function world(on: any, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test' })
  const store: Record<string, unknown> = { ...stored }
  // agyGate: 있으면 agy 조회가 그 약속이 풀릴 때까지 끝나지 않는다(조회 중의 화면을 보려고).
  const mode = { codex: 'ok', agy: 'ok', live: LIVE, codexExit: 1, codexStderr: '', agyGate: undefined as Promise<void> | undefined }
  const calls = { node: 0, agy: 0, agyArgv: [] as string[], attemptWhileRunning: undefined as any, renders: 0 }
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    calls.renders++
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
  on('process.run', async (_: unknown, e: any) => {
    if (e.argv[0] === 'node') {
      calls.node++
      calls.attemptWhileRunning = (store['attempts-v5'] as any)?.codex
      if (mode.codex === 'ok') return { value: { exitCode: 0, stdout: mode.live, stderr: '' } }
      return { value: { exitCode: mode.codexExit, stdout: '', stderr: mode.codexStderr } }
    }
    if (e.argv[0] === 'agy') {
      calls.agy++
      calls.agyArgv = [...e.argv]
      if (mode.agyGate) await mode.agyGate
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
  const text: string | undefined = await bandText(ui)
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
  expect(calls.agyArgv).toEqual(['agy', '--print-timeout', '12s', '--output-format', 'json', '-p=/usage'])

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
  store['attempts-v5'] = { ...(store['attempts-v5'] as object), gemini: { at, isOk: true } }
  store['readings-v5'] = {
    ...(store['readings-v5'] as object),
    gemini: { kind: 'percent', percent: 40, resetsAt: at + 3_600_000, observedAt: at },
  }

  await clock.advance(MIN)
  expect(calls.agy).toBe(1)
  expect(await line($)).toBe('Cx 31% │ AG 40%')
})

test('a store write never brings back an older value from this session', async ($, on) => {
  const { clock, store } = world(on)
  await start($, clock)

  const later = NOW + 10 * 60 * MIN
  store['readings-v5'] = {
    ...(store['readings-v5'] as object),
    gemini: { kind: 'percent', percent: 40, resetsAt: later + 3_600_000, observedAt: later },
  }
  await clock.advance(3 * MIN + 30_000) // Codex만 다시 조회하고 저장소에 쓴다

  expect((store['readings-v5'] as any).gemini.percent).toBe(40)
})

test('a failure keeps the last value through its lifetime, then a dash', async ($, on) => {
  const { clock, mode } = world(on)
  await start($, clock)
  expect(await line($)).toBe('Cx 31% │ AG 25%')

  mode.codex = 'fail'
  await clock.advance(5 * MIN)
  expect(await line($)).toBe('Cx 31% │ AG 25%') // 3분 조회는 실패, 값은 아직 유효

  await clock.advance(2 * MIN)
  expect(await line($)).toBe('Cx — │ AG 25%') // 수명(조회 간격의 2배) 초과
})

test('a stored value past its lifetime is not shown on a new start', async ($, on) => {
  const { clock } = world(on, {
    'attempts-v5': { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
    'readings-v5': {
      codex: { kind: 'percent', percent: 9, observedAt: NOW - 7 * MIN },
      gemini: { kind: 'percent', percent: 9, observedAt: NOW - 29 * MIN },
    },
  })
  await start($, clock)
  expect(await line($)).toBe('Cx — │ AG 9%')
})

test('an attempt stored as a bare number by an older version still counts', async ($, on) => {
  const { clock, calls } = world(on, { 'attempts-v5': { codex: NOW - MIN, gemini: NOW - MIN } })
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
  expect(await line($)).toBe('Cx 22% │ AG 25%')
})

test('values an older version keeps writing are not read back', async ($, on) => {
  // 이전 코드로 도는 세션이 쓴 값: 주간 한도가 없고, 조회 주기도 따로 돈다.
  const old = {
    readings: { codex: { kind: 'percent', percent: 99, resetsAt: NOW + 3_600_000, observedAt: NOW } },
    attempts: { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
    'readings-v3': { codex: { kind: 'percent', percent: 98, resetsAt: NOW + 3_600_000, observedAt: NOW } },
    'attempts-v3': { codex: { at: NOW, isOk: true }, gemini: { at: NOW, isOk: true } },
  }
  const { clock, calls, store } = world(on, old)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(calls.node).toBe(1) // 이전 버전의 조회 기록에 막히지 않는다
  expect((store['readings-v5'] as any).codex.percent).toBe(31)
  expect(store.readings).toEqual(old.readings) // 이전 버전의 값도 건드리지 않는다
  expect(store['readings-v3']).toEqual(old['readings-v3'])
})

async function wide($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 200 } })
  const text: string | undefined = await bandText(ui)
  await ui.unmount()
  return text
}

test('a failure leaves its reason in the store, and the band says it failed', async ($, on) => {
  const { clock, mode, store } = world(on)
  mode.codex = 'fail'
  mode.codexStderr = 'timeout\n'
  mode.agy = 'fail'
  await start($, clock)
  const attempts = store['attempts-v5'] as any
  expect(attempts.codex.isOk).toBe(false)
  expect(attempts.codex.isMissing).toBeUndefined()
  expect(attempts.codex.error).toContain('helper exit 1: timeout')
  expect(attempts.codex.error).toContain('log:')
  expect(attempts.gemini.error).toContain('agy: ')
  expect(await wide($)).toBe('Codex — failed │ Gemini(AG) — failed')
})

test('a program that is not there hides its row, and the row returns once it is installed', async ($, on) => {
  const { clock, mode, store } = world(on)
  mode.codex = 'fail'
  mode.codexExit = 2
  await start($, clock)
  expect((store['attempts-v5'] as any).codex.isMissing).toBe(true)
  expect(await wide($)).toContain('Gemini(AG)')
  expect(await wide($)).not.toContain('Codex')

  mode.codex = 'ok'
  await clock.advance(3 * MIN + 30_000)
  expect(await wide($)).toContain('Codex')
})

test('with none of the programs installed, the band says so', async ($, on) => {
  const gemini = { at: NOW, isOk: false, error: 'spawn agy ENOENT', isMissing: true }
  const { clock, mode } = world(on, { 'attempts-v5': { gemini } })
  mode.codex = 'fail'
  mode.codexExit = 2
  await start($, clock)
  expect(await wide($)).toBe('Codex — not installed │ Gemini(AG) — not installed')
})

test('a source can be turned off: nothing runs for it and it has no row', { options: { sources: 'codex' } }, async ($, on) => {
  const { clock, calls } = world(on)
  await start($, clock)
  expect(calls.agy).toBe(0)
  expect(calls.node).toBe(1)
  expect(await wide($)).toContain('Codex')
  expect(await wide($)).not.toContain('Gemini(AG)')
})

test('a sources value not on the list keeps every source', { options: { sources: 'nope' } }, async ($, on) => {
  const { clock, calls } = world(on)
  await start($, clock)
  expect(calls.agy).toBe(1)
  expect(await wide($)).toContain('Gemini(AG)')
})

test('a very long reason is cut before it is stored', async ($, on) => {
  const { clock, mode, store } = world(on)
  mode.codex = 'fail'
  mode.codexStderr = 'x'.repeat(1000)
  await start($, clock)
  expect((store['attempts-v5'] as any).codex.error.length).toBe(200)
})

test("another session's failure and its reason survive the store", async ($, on) => {
  const failed = { at: NOW, isOk: false, error: 'spawn agy ENOENT', isMissing: true }
  const { clock, store } = world(on, { 'attempts-v5': { gemini: failed } })
  await start($, clock)
  expect(await wide($)).not.toContain('Gemini(AG)')
  expect((store['attempts-v5'] as any).gemini).toEqual(failed)
})

test('a retry keeps the failure until its result, and success clears the reason', async ($, on) => {
  const { clock, mode, store, calls } = world(on)
  mode.codex = 'fail'
  mode.codexStderr = 'timeout'
  await start($, clock)

  mode.codex = 'ok'
  await clock.advance(3 * MIN)
  expect(calls.attemptWhileRunning.isOk).toBe(false)
  expect(calls.attemptWhileRunning.at).toBe(NOW + 3 * MIN)
  expect((store['attempts-v5'] as any).codex).toEqual({ at: NOW + 3 * MIN, isOk: true })
  expect(await wide($)).toContain('Codex ')
  expect(await wide($)).not.toContain('failed')
})

test('a value past its lifetime after a failure says failed, not old', async ($, on) => {
  const { clock, mode } = world(on)
  await start($, clock)
  mode.codex = 'fail'
  await clock.advance(7 * MIN)
  expect(await wide($)).toContain('Codex — failed')
})

// 새로고침 버튼의 글자. 데스크톱은 보이지 않는 전각 폭 공백이고, ↻는 그 아래 깐 그림이 그린다.
const REST_LABEL = { terminal: '↻', desktop: '\u2003' } as const

// 데스크톱 새로고침 버튼 자리: 첫째는 ↻ 그림을 한가운데에 까는 absolute Box, 둘째는 버튼과 빈 absolute Box를 담은 Box.
// 빈 absolute Box가 버튼을 담은 Box를 위치를 가진 상자로 만들어, 버튼이 그림 위에 그려지고 누름을 받는다.
async function refreshSpot(ui: any) {
  const isAbsolute = (node: any) => node?.type === 'Box' && node.props?.position === 'absolute'
  const boxes: any[] = await ui.findAll({ type: 'Box' })
  const spot = boxes.find(b => {
    const [picture, holder] = b.children as any[]
    return b.children.length === 2 && isAbsolute(picture) && picture.children?.[0]?.type === 'Svg' &&
      holder?.type === 'Box' && holder.children?.[0]?.type === 'Button' && holder.children?.[0]?.props?.key === 'refresh'
  })
  if (!spot) return undefined
  const [picture, holder] = spot.children as any[]
  return {
    picture: picture.props,
    svg: picture.children[0].props as { source: string; alt: string },
    button: holder.children[0].props,
    anchor: holder.children.slice(1).filter(isAbsolute).length,
  }
}

test('the refresh button looks up every source at once, on both surfaces', async ($, on) => {
  const { clock, calls } = world(on)
  await start($, clock)
  expect(calls.agy).toBe(1)
  expect(calls.node).toBe(1)

  for (const [i, surface] of (['terminal', 'desktop'] as const).entries()) {
    await clock.advance(MIN)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(REST_LABEL[surface])
    await ui.press({ key: 'refresh' })
    expect(calls.agy).toBe(2 + i)
    expect(calls.node).toBe(2 + i)
    // 조회가 끝나면 버튼은 다시 쉬는 모양이다.
    expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(REST_LABEL[surface])
    await ui.unmount()
  }

  // 버튼으로 조회한 뒤에는 그때부터 간격을 다시 센다.
  await clock.advance(2 * MIN + 30_000)
  expect(calls.node).toBe(3)
  expect(calls.agy).toBe(3)
})

test('the refresh button spins while a lookup runs and turns back into ↻ when it ends, on both surfaces', async ($, on) => {
  const { clock, calls, mode } = world(on)
  await start($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    let open = () => {}
    mode.agyGate = new Promise<void>(resolve => { open = resolve })
    const ui = await $.ui.mount({ ...BAND, surface })
    const label = async () => (await ui.find({ type: 'Button', key: 'refresh' }))?.props.label
    let spinning = ''
    const pressing = ui.press({ key: 'refresh' })
    await clock.settle()
    if (surface === 'terminal') {
      // 터미널은 글자를 바꿔 가며 돈다.
      expect(await label()).toBe('⠋')
      await clock.advance(80)
      expect(await label()).toBe('⠙')
      await clock.advance(80)
      expect(await label()).toBe('⠹')
    } else {
      // 데스크톱은 버튼(보이지 않는 글자)을 그대로 두고, 그 아래 깐 같은 ↻ 그림만 스스로 돈다. 버튼 크기도 그림 자리도 쉴 때와 같다.
      // 앱은 버튼의 label만 그리므로, 보이는 글자를 label에 두면 그림과 겹치고 버튼이 넓어진다.
      expect(await label()).toBe(REST_LABEL.desktop)
      const spot = await refreshSpot(ui)
      expect(spot?.picture).toMatchObject({ top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' })
      expect(spot?.svg.alt).toBe('Refreshing')
      expect(spot?.svg.source).toContain('<animateTransform')
      spinning = spot?.svg.source ?? ''
      expect(spot?.button).toMatchObject({ label: REST_LABEL.desktop, plain: true })
      expect(spot?.anchor).toBe(1)
    }

    open()
    await pressing
    expect(await label()).toBe(REST_LABEL[surface])
    // 끝나면 더 돌지 않는다.
    await clock.advance(1_000)
    expect(await label()).toBe(REST_LABEL[surface])
    if (surface === 'desktop') {
      // 쉴 때도 같은 자리에 같은 ↻ 그림을 깔되 돌지 않는다.
      const spot = await refreshSpot(ui)
      expect(spot?.svg.alt).toBe('Refresh')
      expect(spot?.svg.source).not.toContain('<animateTransform')
      // 도는 그림과 같은 그림이다(돌리는 줄만 빠진다). 그래서 멈출 때 모양이 바뀌지 않는다.
      expect(spot?.svg.source).toBe(spinning.replace(/<animateTransform[^>]*\/>/, ''))
      expect(spot?.anchor).toBe(1)
    }
    await ui.unmount()
  }
  expect(calls.agy).toBe(3)
})

test('with only the desktop drawing, the band is not redrawn while its picture spins', async ($, on) => {
  const { clock, calls, mode } = world(on)
  await start($, clock)
  let open = () => {}
  mode.agyGate = new Promise<void>(resolve => { open = resolve })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pressing = ui.press({ key: 'refresh' })
  await clock.settle()
  const before = calls.renders
  // 그림은 스스로 돈다. 다시 그리면 처음 각도로 돌아가 제자리에서 떨리므로, 조회가 끝날 때까지 다시 그리지 않는다.
  await clock.advance(1_000)
  expect(calls.renders).toBe(before)
  expect((await ui.findAll({ type: 'Svg' })).some(s => s.props.alt === 'Refreshing')).toBe(true)

  open()
  await pressing
  expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(REST_LABEL.desktop)
  expect((await ui.findAll({ type: 'Svg' })).some(s => s.props.alt === 'Refresh')).toBe(true)
  await ui.unmount()
})
