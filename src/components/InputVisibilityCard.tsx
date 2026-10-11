import { InputVisibility } from '../ai/decisionObservation';
import { SEAT_NAMES } from '../engine';
import styles from './DecisionLogModal.module.css';

/** 显示决策入口的实际观察摘要，不以透视状态推断引擎视野。 */
export default function InputVisibilityCard({ visibility }: { visibility?: InputVisibility }) {
  return <div className={styles.snapshotBox} style={{ gridColumn: '1 / -1' }}>
    <span className={styles.snapshotLabel}>AI 决策入口视野</span>
    {visibility ? <div className={styles.snapshotValue} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
      <div>本家手牌：{visibility.ownHandCount} 张 · 对手暗牌：{visibility.hiddenHandCount} 张未提供</div>
      {visibility.revealedHand && <div>
        {SEAT_NAMES[visibility.revealedHand.seat]}家明手：{visibility.revealedHand.count} 张（100 分扣底后按规则公开）
      </div>}
      <div>底牌：{visibility.kitty === 'in-hand' ? '已拿入本家手牌'
        : visibility.kitty === 'known-buried' ? `本家已知已扣底牌（${visibility.kittySize} 张）`
        : `未知（${visibility.kittySize} 张未提供）`}</div>
      <div>上帝视角翻牌不会扩大此视野；模型请求可使用其中的部分信息。</div>
    </div> : <div className={styles.snapshotValue}>旧记录未保存输入视野摘要</div>}
  </div>;
}
