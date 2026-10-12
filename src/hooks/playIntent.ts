/**
 * 出牌交互意图解析（纯函数，无 React / 无副作用）。
 * 采用「策略模式」：把「点牌后该做什么」从 UI 组件里抽出来，使交互模型只有一套、
 * 可被单元测试穷举覆盖，并让组件退化为纯展示 + 转发。
 */
import { Card, cardId } from '../cards';

/** 点牌后的唯一意图三态 */
export type PlayClickIntent = 'play' | 'select' | 'deselect';

/**
 * 解析一次点击的意图。
 *
 * 交互模型（唯一一套，桌面鼠标与移动端触屏共用）：
 * - `confirmBeforePlay === true`：未选 → 选中；点同牌 → 出牌；点异牌 → 换选。
 * - `confirmBeforePlay === false`：未选或点异牌 → 直接出牌（单击即出）；点同牌 → 出牌。
 *
 * `'deselect'` 只在「需要二次确认」且 UI 显式要求取消时产生；本实现不通过点牌取消
 * （取消走再次点击已选牌之外的入口），因此快捷模式下不会返回 `'deselect'`。
 */
export function resolvePlayClickIntent(
  card: Card,
  selected: Card | null,
  confirmBeforePlay: boolean,
): PlayClickIntent {
  const isSameCard = selected !== null && cardId(selected) === cardId(card);
  // 老手快速模式：任何一次点击都直接出牌，不保留「只选不出」的中间态。
  if (!confirmBeforePlay) return 'play';
  // 新手确认模式：点同一张牌才算确认出牌，点别的牌只换选。
  return isSameCard ? 'play' : 'select';
}
