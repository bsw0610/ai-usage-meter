import { codex } from './codex'
import { gemini } from './gemini'
import type { Provider } from './types'

export type { Provider, Reading } from './types'

// provider 추가·제거는 파일 하나 + 이 목록 한 줄.
// claude.ts는 Claude 앱이 이미 사용량을 보여 주므로 목록에서 뺐다. 다시 쓰려면 import와 한 줄만 되돌리면 된다.
export const providers: Provider[] = [codex, gemini]

// userConfig의 sources 값. provider id면 그 소스만 쓰고, all이나 목록 밖의 값이면 모두 쓴다.
export const activeProviders = (sources: unknown): Provider[] => {
  const only = providers.filter(p => p.id === sources)
  return only.length ? only : providers
}
