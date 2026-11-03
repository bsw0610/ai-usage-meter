// resetsAt: epoch milliseconds. windowMs: 한도 창의 길이(모르면 없음, 페이스를 계산하지 않는다)
// changedAt: percent가 마지막으로 바뀐 것을 본 시각(epoch milliseconds). 저장할 때 채운다.
export type PercentLimit = { percent: number; resetsAt?: number; windowMs?: number; changedAt?: number }

// observedAt: epoch milliseconds. secondary: 5시간 한도와 함께 오는 주간 한도
export type Reading =
  | (PercentLimit & { kind: 'percent'; observedAt: number; secondary?: PercentLimit })
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
