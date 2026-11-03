import { codex } from './codex'
import { gemini } from './gemini'
import type { Provider } from './types'

export type { Provider, Reading } from './types'

// provider 추가·제거는 파일 하나 + 이 목록 한 줄.
// claude.ts는 Claude 앱이 이미 사용량을 보여 주므로 목록에서 뺐다. 다시 쓰려면 import와 한 줄만 되돌리면 된다.
export const providers: Provider[] = [codex, gemini]
