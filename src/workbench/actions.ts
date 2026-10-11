import { AiAction } from '../ai/types';
import { cardLabel, SUIT_NAME } from '../cards';
export function actionLabel(action?: AiAction): string {
  if (!action) return '决策';
  switch (action.kind) {
    case 'bid': return action.bid === null ? '不叫' : '叫 ' + action.bid + ' 分';
    case 'trump': return '定主 ' + SUIT_NAME[action.trump];
    case 'bury': return '埋牌 ' + action.cards.map(cardLabel).join(' ');
    case 'play': return '出牌 ' + cardLabel(action.card);
  }
}
