import { BAR_HEIGHT_PX, BAR_WIDTH_PX } from './format'

// 테스트용: 그려진 밴드를 한 줄의 글자로 읽는다. 터미널은 Text 하나라 그대로,
// 데스크톱의 칸별 줄은 칸 사이를 한 칸 띄우고 로고는 이름(alt)으로 읽으며 막대(막대 크기의 그림)는 건너뛴다.
// 버튼(글자가 label에 있다)과 absolute Box(새로고침 버튼 아래 까는 ↻ 그림처럼 줄 위에 겹쳐 그리는 것)도 건너뛴다.
export function shownText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  // 그려진 트리(drawn)는 자식을 props가 아니라 노드에 둔다.
  const { type, props = {}, children } = node as { type: string; props?: Record<string, any>; children?: unknown }
  if (type === 'Box' && props.position === 'absolute') return ''
  const kids: unknown[] = [children ?? props.children ?? []].flat(Infinity)
  // 막대의 alt는 사용률이나 '다음 확인 대기' 같은 문구라, 글자가 아니라 크기로 가려낸다.
  if (type === 'Svg') return props.width === BAR_WIDTH_PX && props.height === BAR_HEIGHT_PX ? '' : (props.alt ?? '')
  if (type === 'Text') return kids.map(shownText).join('')
  return kids.map(shownText).filter(Boolean).join(props.flexDirection === 'column' ? '\n' : ' ')
}

export const bandText = async (ui: { drawn: () => Promise<unknown> }): Promise<string> => shownText(await ui.drawn())
