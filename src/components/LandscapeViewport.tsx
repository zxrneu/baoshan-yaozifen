/** 横屏视口：以单一职责封装方向提示，切换屏幕方向不重建对局。 */
import type { ReactNode } from 'react';
import styles from './LandscapeViewport.module.css';

export default function LandscapeViewport({ children }: { children: ReactNode }) {
  return <div className={styles.surface}>
    <div className={styles.orientationNotice} role="status"><strong>请横屏</strong><p>横屏后可完整查看手牌与操作按钮。</p></div>
    <div className={styles.viewport} aria-label="横屏游戏区域">{children}</div>
  </div>;
}
