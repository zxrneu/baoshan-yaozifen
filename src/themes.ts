/** 皮肤只控制外观；切换不会触碰对局状态。 */
export const SKINS = [
  { id: 'classic', name: '经典棋牌', description: '青绿绒面 · 红木金边', mark: '♣' },
  { id: 'forest', name: '森林绿', description: '沉静深绿 · 简洁牌桌', mark: '♠' },
  { id: 'midnight', name: '午夜蓝', description: '深蓝绒面 · 银蓝边框', mark: '♦' },
] as const;

export type SkinId = typeof SKINS[number]['id'];
export const SKIN_STORAGE_KEY = 'baoshan-yaozifen.skin';

export function readSkin(): SkinId {
  try {
    const stored = window.localStorage.getItem(SKIN_STORAGE_KEY);
    return SKINS.find((skin) => skin.id === stored)?.id ?? 'classic';
  } catch {
    return 'classic';
  }
}
