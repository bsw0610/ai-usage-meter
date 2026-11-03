import type { Reading } from '../../types/index'
import { parseLive, parseRollout } from './codex-parse'
import type { Io, Provider } from './types'

const TAIL_BYTES = 262144
const MAX_FILES = 5
const LIVE_TIMEOUT_MS = 5000

// 1순위: codex app-server에 직접 묻는 헬퍼.
async function readLive(io: Io, now: number): Promise<Reading | undefined> {
  try {
    const r = await io.run(['node', `${io.root}/scripts/codex-limits.mjs`], { timeoutMs: LIVE_TIMEOUT_MS })
    return r.exitCode === 0 ? parseLive(r.stdout, now) : undefined
  } catch {
    return undefined
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

// 오늘과 어제의 rollout 파일, 최근 수정 순.
async function recentRollouts(io: Io, home: string, now: number): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number; mtimeMs: number }[] = []
  for (const back of [0, 1]) {
    const d = new Date(now - back * 86_400_000)
    const dir = `${home}/.codex/sessions/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
    try {
      for (const f of await io.list(dir)) {
        if (f.kind === 'file' && f.name.startsWith('rollout-') && f.name.endsWith('.jsonl')) {
          out.push({ path: `${dir}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs })
        }
      }
    } catch {
      // 폴더 없음
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function readText(io: Io, path: string, size: number): Promise<string | undefined> {
  try {
    if (size <= TAIL_BYTES) return (await io.read(path)) as string
    const r = await io.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

// 2순위: 최근 rollout 로그의 마지막 token_count.
async function readLog(io: Io, now: number): Promise<Reading | null | undefined> {
  const home = await io.home()
  if (!home) return undefined
  const files = await recentRollouts(io, home, now)
  for (const f of files.slice(0, MAX_FILES)) {
    const text = await readText(io, f.path, f.size)
    if (text === undefined) continue
    const r = parseRollout(text)
    if (r !== undefined) return r
  }
  return undefined
}

export const codex: Provider = {
  id: 'codex',
  label: 'Codex',
  short: 'Cx',
  read: async io => {
    const now = await io.now()
    return (await readLive(io, now)) ?? (await readLog(io, now)) ?? null
  },
}
