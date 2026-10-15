/**
 * 玩家级出牌交互偏好。
 * 采用「单一职责 + 依赖倒置」：交互策略由偏好数据决定，UI 不硬编码行为分支。
 * - confirmBeforePlay=true（默认，新手防误触）：点牌选中 → 再点同一张牌出牌。
 * - confirmBeforePlay=false（老手快速模式）：点合法牌即出，无需任何按钮或键盘。
 */
import { useCallback, useState } from 'react';

export const PLAY_PREF_STORAGE_KEY = 'baoshan_play_confirm';

export interface PlayPreferences {
  /** 出牌前是否需要二次确认（点同牌再点一次才出牌） */
  confirmBeforePlay: boolean;
}

export const DEFAULT_PLAY_PREFERENCES: PlayPreferences = { confirmBeforePlay: true };

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // 隐私模式下访问 localStorage 本身可能抛错，此时退化为仅本次会话生效。
    return null;
  }
}

/** 读取交互偏好；任何缺失或非法值都回退默认（默认开启二次确认）。 */
export function readPlayPreferences(): PlayPreferences {
  const store = storage();
  if (!store) return { ...DEFAULT_PLAY_PREFERENCES };
  try {
    const raw = store.getItem(PLAY_PREF_STORAGE_KEY);
    if (raw === 'true') return { confirmBeforePlay: true };
    if (raw === 'false') return { confirmBeforePlay: false };
  } catch {
    // 读取失败时保持默认，不阻断对局。
  }
  return { ...DEFAULT_PLAY_PREFERENCES };
}

/** 写入交互偏好；写入失败静默忽略（不影响本次会话内的切换）。 */
export function writePlayPreferences(prefs: PlayPreferences): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PLAY_PREF_STORAGE_KEY, String(prefs.confirmBeforePlay));
  } catch {
    // 存储不可用或已满：仅本次会话生效。
  }
}

export function usePlayPreferences() {
  const [prefs, setPrefs] = useState<PlayPreferences>(readPlayPreferences);
  const setConfirmBeforePlay = useCallback((confirmBeforePlay: boolean) => {
    const next = { confirmBeforePlay };
    setPrefs(next);
    writePlayPreferences(next);
  }, []);
  return { prefs, setConfirmBeforePlay };
}
