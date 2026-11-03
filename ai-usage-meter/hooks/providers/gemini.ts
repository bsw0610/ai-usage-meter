import type { ProcessRunResult } from 'claude-code'

import { parseUsage } from './gemini-parse'
import { ReadFailure } from './types'
import type { Provider } from './types'

// agy는 느리고(약 8초) 실행마다 파일이 생기며, 로그인 흐름이나 자체 업데이트가 따라올 수 있다.
// 그래서 조회 간격을 길게 잡고 실패하면 더 오래 기다린다. 값은 Antigravity의 한도라 표기를 구분한다.
const AGY_ARGV = ['agy', '--print-timeout', '12s', '-p=/usage']
const TIMEOUT_MS = 15000

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini(AG)',
  short: 'AG',
  ttlMs: 15 * 60_000,
  retryMs: 30 * 60_000,
  read: async io => {
    let r: ProcessRunResult
    try {
      r = await io.run(AGY_ARGV, { timeoutMs: TIMEOUT_MS })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new ReadFailure(`agy: ${message}`, message.includes('ENOENT'))
    }
    if (r.exitCode !== 0) throw new ReadFailure(`agy exit ${r.exitCode}: ${r.stderr.trim()}`)
    const reading = parseUsage(r.stdout, await io.now())
    if (!reading) throw new ReadFailure(`agy: 한도 줄 없음: ${r.stdout.trim()}`)
    return reading
  },
}
