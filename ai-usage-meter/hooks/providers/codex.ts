import type { ProcessRunResult } from 'claude-code'

import type { Reading } from '../../types/index'
import { parseLive, parseRollout } from './codex-parse'
import { OPENAI_LOGO } from './logos'
import { ReadFailure } from './types'
import type { Io, Provider } from './types'

const TAIL_BYTES = 262144
const MAX_FILES = 5
const LIVE_TIMEOUT_MS = 5000
const EXIT_NO_CODEX = 2 // scripts/codex-limits.mjs: codex 명령이 없다

// 1순위: codex app-server에 직접 묻는 헬퍼.
async function readLive(io: Io, now: number): Promise<Reading> {
  let r: ProcessRunResult
  try {
    r = await io.run(['node', `${io.root}/scripts/codex-limits.mjs`], { timeoutMs: LIVE_TIMEOUT_MS })
  } catch (e) {
    throw new ReadFailure(`helper: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (r.exitCode !== 0) throw new ReadFailure(`helper exit ${r.exitCode}: ${r.stderr.trim()}`, r.exitCode === EXIT_NO_CODEX)
  const reading = parseLive(r.stdout, now)
  if (!reading) throw new ReadFailure('helper: 출력 모양이 다름')
  return reading
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
  logo: OPENAI_LOGO,
  read: async io => {
    const now = await io.now()
    let live: ReadFailure
    try {
      return await readLive(io, now)
    } catch (e) {
      live = e as ReadFailure
    }
    const log = await readLog(io, now)
    if (log) return log
    throw new ReadFailure(`${live.message}; log: ${log === null ? 'rate_limits 없음' : 'token_count 없음'}`, live.isMissing)
  },
}
