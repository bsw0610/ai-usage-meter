import type { ProcessRunResult } from 'claude-code'

import { parseUsage } from './gemini-parse'
import { GEMINI_LOGO } from './logos'
import { ReadFailure } from './types'
import type { Provider } from './types'

// agy는 느리고(약 8초) 실행마다 파일이 생기며, 로그인 흐름이 따라올 수 있다.
// 그래서 조회 간격을 길게 잡고 실패하면 더 오래 기다린다. 값은 Antigravity의 한도라 표기를 구분한다.
const AGY_ARGV = ['agy', '--print-timeout', '12s', '--output-format', 'json', '-p=/usage']
const TIMEOUT_MS = 15000
// 조회에 자체 업데이터가 따라 뜨지 않게 한다. agy 1.4.2부터 값은 1이 아니라 true여야 한다.
const AGY_ENV = { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini(AG)',
  short: 'AG',
  logo: GEMINI_LOGO,
  ttlMs: 15 * 60_000,
  retryMs: 30 * 60_000,
  read: async io => {
    let r: ProcessRunResult
    try {
      r = await io.run(AGY_ARGV, { timeoutMs: TIMEOUT_MS, env: AGY_ENV })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new ReadFailure(`agy: ${message}`, message.includes('ENOENT'))
    }
    if (r.exitCode !== 0) throw new ReadFailure(`agy exit ${r.exitCode}: ${r.stderr.trim()}`)
    const reading = parseUsage(r.stdout, await io.now())
    if (!reading) throw new ReadFailure(`agy: no limit line: ${r.stdout.trim()}`)
    return reading
  },
}
