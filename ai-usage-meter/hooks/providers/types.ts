import type { FsEntry, ProcessRunInit, ProcessRunResult, SessionRateLimit } from 'claude-code'

import type { Reading } from '../../types/index'

export type { Reading }

export const DEFAULT_TTL_MS = 3 * 60_000

// read가 실패를 알리는 방법. 이유는 조회 기록에 남는다.
export class ReadFailure extends Error {
  readonly isMissing: boolean
  constructor(message: string, isMissing = false) {
    super(message)
    this.isMissing = isMissing
  }
}

// provider가 쓰는 바깥 세계. `$`는 정적 검사 때문에 인자로 넘길 수 없어서,
// 호출 지점에서 `$.noun.event(...)`로 풀어 쓴 함수만 넘긴다(readings.ts의 makeIo).
export type Io = {
  now: () => Promise<number>
  home: () => Promise<string | undefined>
  root: string
  list: (path: string) => Promise<FsEntry[]>
  read: (path: string) => Promise<string>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  rateLimits: () => Promise<SessionRateLimit[]>
}

export type Provider = {
  id: string
  label: string
  short: string
  // 막대를 그리는 데스크톱 줄에서 이름 대신 그릴 로고의 SVG 내용(24×24).
  logo?: string
  // 실패하면 ReadFailure를 던진다. null은 이유 없이 값을 모른다는 뜻이다.
  read: (io: Io) => Promise<Reading | null>
  // 조회 간격(기본 3분)과 실패한 뒤 다시 시도하기까지의 간격(기본은 조회 간격과 같음).
  ttlMs?: number
  retryMs?: number
  // 값을 믿는 기간(기본은 조회 간격의 2배). 지나면 "—"로 그린다.
  maxAgeMs?: number
  // session.measure마다 호출. undefined면 "새 정보 없음"(이전 값 유지), null이면 "알 수 없음".
  onMeasure?: (m: { rateLimits: SessionRateLimit[] }, now: number) => Reading | null | undefined
}
