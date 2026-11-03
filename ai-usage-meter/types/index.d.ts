// resetsAt, observedAt: epoch milliseconds
export type Reading =
  | { kind: 'percent'; percent: number; resetsAt?: number; observedAt: number }
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
