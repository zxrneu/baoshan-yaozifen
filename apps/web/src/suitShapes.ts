/** 花色矢量遵循单一职责：统一牌面与主牌徽章的对称图形，避免字体偏移。 */
import type { Suit } from '@yaozifen/game-core/cards';
export const SUIT_PATH: Record<Suit, string> = {
  S: 'M12 2C9 6 3 9 3 13a5 5 0 0 0 8 4c0 3-2 4-2 4h6s-2-1-2-4a5 5 0 0 0 8-4c0-4-6-7-9-11Z',
  H: 'M12 21 3 12C-3 5 7-2 12 6 17-2 27 5 21 12Z',
  C: 'M10 11a5 5 0 1 1 4 0 5 5 0 1 1-1 7c0 2 2 3 2 3H9s2-1 2-3a5 5 0 1 1-1-7Z',
  D: 'm12 2 9 10-9 10-9-10Z',
};
