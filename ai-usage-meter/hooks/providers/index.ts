import { codex } from './codex'
import { gemini } from './gemini'
import type { Provider } from './types'

export type { Provider, Reading } from './types'

// provider 추가·제거는 파일 하나 + 이 목록 한 줄.
// Claude(claude.ts)는 조회하지 않고 엔진이 알려 주는 값만 받으므로 이 목록에 없다.
export const providers: Provider[] = [codex, gemini]

// userConfig의 sources 값. provider id면 그 소스만 쓰고, all이나 목록 밖의 값이면 모두 쓴다.
export const activeProviders = (sources: unknown): Provider[] => {
  const only = providers.filter(p => p.id === sources)
  return only.length ? only : providers
}
