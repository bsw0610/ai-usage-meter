import { expect, mock, test } from 'claude-code/testing'

import { bandText } from './shown'

import { formatLine, lineFor } from './format'
import { providers } from './providers'

const BAND = {
  plugin: 'ai-usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 26, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

test('the band shows a dash for every provider, on both surfaces', async ($, on) => {
  mock.clock(on)
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await bandText(ui)).toBe('Codex — │ Gemini(AG) —')
    await ui.unmount()
  }
})

test('a fourth provider appears with no other file changed', () => {
  const fake = { id: 'fake', label: 'Fake', short: 'Fk' }
  expect(lineFor([...providers, fake], {})).toBe('Codex — │ Gemini(AG) — │ Fake —')
  expect(lineFor([...providers, fake], { fake: { kind: 'count', count: 3, unit: 'req', observedAt: 1 } })).toContain('Fake 3 req')
})

test('the band yields to a survey and keeps what other mods drew', async ($, on) => {
  mock.clock(on)
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other mod</Text>
  })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /other mod/ })).toBeTruthy()
  expect(await bandText(ui)).not.toContain('Codex')
  await ui.unmount()

  const ui2 = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui2.find({ type: 'Text', text: /other mod/ })).toBeTruthy()
  expect(await bandText(ui2)).toContain('Codex')
  await ui2.unmount()
})

test('formatLine shows percent and count readings', () => {
  const now = 1
  expect(
    formatLine([
      { label: 'A', reading: { kind: 'percent', percent: 41.6, observedAt: now } },
      { label: 'B', reading: { kind: 'count', count: 12, unit: 'req', observedAt: now } },
      { label: 'C', reading: null },
    ]),
  ).toBe('A 5h ━━━╸─────  42% │ B 12 req │ C —')
})

test('with nothing beneath but the engine, the band is drawn without its node, on both surfaces', async ($, on) => {
  mock.clock(on)
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await bandText(ui)).toBe('Codex — │ Gemini(AG) —')
    await ui.unmount()
  }
})
