import { useLayoutEffect, useState } from 'react';
import { readSkin, SKIN_STORAGE_KEY } from '../themes';

export function useSkin() {
  const [skin, setSkin] = useState(readSkin);

  useLayoutEffect(() => {
    document.documentElement.dataset.skin = skin;
    try {
      window.localStorage.setItem(SKIN_STORAGE_KEY, skin);
    } catch {
      // 隐私模式或存储被禁用时，仍可在本次使用中切换皮肤。
    }
  }, [skin]);

  return { skin, setSkin };
}
