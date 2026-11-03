import type { EngineInterface } from 'claude-code'

import type { Attempt, Reading } from '../types/index'
import { DEFAULT_TTL_MS, ReadFailure } from './providers/types'
import type { Io, Provider } from './providers/types'

type Readings = Record<string, Reading | null>
type Attempts = Record<string, Attempt>

const ref = { plugin: 'ai-usage-meter', key: 'readings' } as const
const attemptsRef = { plugin: 'ai-usage-meter', key: 'attempts' } as const
// 저장소는 열린 세션끼리 공유한다. 이전 코드로 도는 세션은 새 필드를 모른 채 값을 덮어쓰므로,
// Reading의 모양이 바뀌면 키의 버전을 올려 서로 섞이지 않게 한다.
const STORE_KEY = 'readings-v3'
const ATTEMPTS_KEY = 'attempts-v3'
const MAX_ERROR_CHARS = 200

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// 소스별로 더 최근에 관측한 값을 쓴다. 값이 있으면 null에 밀리지 않고, 같으면 a가 이긴다.
function mergeReadings(a: Readings, b: Readings): Readings {
  const out = { ...a }
  for (const [id, r] of Object.entries(b)) {
    const cur = out[id]
    if (!cur || (r && r.observedAt > cur.observedAt)) out[id] = r
  }
  return out
}

function mergeAttempts(a: Attempts, b: Attempts): Attempts {
  const out = { ...a }
  for (const [id, t] of Object.entries(b)) {
    const cur = out[id]
    if (!cur || t.at > cur.at) out[id] = t
  }
  return out
}

async function storedReadings($: EngineInterface): Promise<Readings> {
  const saved = await $.store.get(STORE_KEY)
  return isRecord(saved) ? (saved as Readings) : {}
}

// 이전 버전은 시도 시각을 숫자로 저장했다.
async function storedAttempts($: EngineInterface): Promise<Attempts> {
  const saved = await $.store.get(ATTEMPTS_KEY)
  const out: Attempts = {}
  if (!isRecord(saved)) return out
  for (const [id, v] of Object.entries(saved)) {
    if (typeof v === 'number') out[id] = { at: v, isOk: true }
    else if (isRecord(v) && typeof v.at === 'number') {
      out[id] = {
        at: v.at,
        isOk: v.isOk !== false,
        ...(typeof v.error === 'string' ? { error: v.error } : {}),
        ...(v.isMissing === true ? { isMissing: true } : {}),
      }
    }
  }
  return out
}

// 저장소의 값을 세션으로 가져온다. 세션 시작과 매 조회 전에 불러,
// 새 세션의 첫 조회 전에도 값이 보이고 함께 열린 세션의 조회와 결과를 이어받는다.
export async function pullFromStore($: EngineInterface): Promise<void> {
  const readings = await storedReadings($)
  for (let i = 0; i < 5; i++) {
    const { value = {}, version } = await $.state.get(ref)
    const next = mergeReadings(value, readings)
    if (JSON.stringify(next) === JSON.stringify(value)) break
    if ((await $.state.set(ref, next, { ifVersion: version })).isSet) break
  }
  const attempts = await storedAttempts($)
  for (let i = 0; i < 5; i++) {
    const { value = {}, version } = await $.state.get(attemptsRef)
    const next = mergeAttempts(value, attempts)
    if (JSON.stringify(next) === JSON.stringify(value)) break
    if ((await $.state.set(attemptsRef, next, { ifVersion: version })).isSet) break
  }
}

// 한 소스의 값을 바꾼다. 같은 값이면 쓰지 않아 다시 그리지 않는다.
// 두 소스가 동시에 끝나도 서로의 값을 덮지 않도록 버전을 확인하고, 어긋나면 다시 읽어 쓴다.
export async function put($: EngineInterface, id: string, reading: Reading | null): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const { value = {}, version } = await $.state.get(ref)
    const prev = value[id]
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(reading)) return
    const next = { ...value, [id]: reading }
    const { isSet } = await $.state.set(ref, next, { ifVersion: version })
    if (isSet) {
      await $.store.set(STORE_KEY, mergeReadings(next, await storedReadings($)))
      return
    }
  }
}

function makeIo($: EngineInterface): Io {
  return {
    now: () => $.clock.now(),
    home: () => $.env.get('HOME'),
    root: $.plugin.root,
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
    run: (argv, init) => $.process.run(argv, init),
    rateLimits: async () => (await $.session.usage()).rateLimits,
  }
}

async function markAttempts($: EngineInterface, updates: Attempts): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const { value = {}, version } = await $.state.get(attemptsRef)
    const next = { ...value, ...updates }
    const { isSet } = await $.state.set(attemptsRef, next, { ifVersion: version })
    if (isSet) {
      await $.store.set(ATTEMPTS_KEY, mergeAttempts(next, await storedAttempts($)))
      return
    }
  }
}

// 조회할 때가 된 소스만 조회한다. 소스별 ttl 안이면 건너뛰고, 직전 조회가 실패였으면
// retryMs가 지나야 다시 시도한다. 실패해도 직전 값은 지우지 않으며, 수명이 지나면 format이 "—"로 그린다.
// 한 소스의 실패는 다른 소스에 번지지 않는다.
export async function refreshDue($: EngineInterface, list: Provider[]): Promise<void> {
  await pullFromStore($)
  const io = makeIo($)
  const now = await $.clock.now()
  const { value: attempts = {} } = await $.state.get(attemptsRef)

  const due = list.filter(p => {
    const last = attempts[p.id]
    if (!last) return true
    const ttl = p.ttlMs ?? DEFAULT_TTL_MS
    return now - last.at >= (last.isOk ? ttl : (p.retryMs ?? ttl))
  })
  if (due.length === 0) return

  // 조회 전에 기록해 겹치는 조회를 막는다. 직전 실패는 결과가 나올 때까지 그대로 둔다.
  await markAttempts($, Object.fromEntries(due.map(p => [p.id, { isOk: true, ...attempts[p.id], at: now }])))
  await Promise.all(
    due.map(async p => {
      try {
        const reading = await p.read(io)
        if (!reading) throw new ReadFailure('값 없음')
        // observedAt은 읽어 온 시각이다. 오래된 로그의 값도 지금 읽었으면 수명이 새로 시작한다.
        await put($, p.id, { ...reading, observedAt: now })
        await markAttempts($, { [p.id]: { at: now, isOk: true } })
      } catch (e) {
        const error = (e instanceof Error ? e.message : String(e)).slice(0, MAX_ERROR_CHARS)
        await markAttempts($, { [p.id]: { at: now, isOk: false, error, ...(e instanceof ReadFailure && e.isMissing ? { isMissing: true } : {}) } })
      }
    }),
  )
}
