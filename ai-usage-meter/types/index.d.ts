// resetsAt, observedAt: epoch milliseconds. windowMs: 한도 창의 길이(모르면 없음, 페이스를 계산하지 않는다)
export type Reading =
  | { kind: 'percent'; percent: number; resetsAt?: number; windowMs?: number; observedAt: number }
  | { kind: 'count'; count: number; unit: string; observedAt: number }

// at: epoch milliseconds
export type Attempt = { at: number; isOk: boolean }

declare module 'claude-code' {
  interface PluginState {
    'ai-usage-meter': {
      readings: Record<string, Reading | null>
      // 소스별 마지막 조회 시도. 캐시와 실패 후 재시도 억제에 쓴다.
      attempts: Record<string, Attempt>
    }
  }
}
