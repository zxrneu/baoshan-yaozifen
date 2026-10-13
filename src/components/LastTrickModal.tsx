/** 上一轮回看弹窗 */
import Modal from './Modal';
import { SEAT_NAMES, TrickCard } from '../engine';
import CardView from '../CardView';
import styles from './LastTrickModal.module.css';

interface Props {
  lastTrick: TrickCard[];
  lastWinner: number | null;
  lastPoints: number;
  onClose: () => void;
}

export default function LastTrickModal({ lastTrick, lastWinner, lastPoints, onClose }: Props) {
  return (
    <Modal label="上一轮出牌回顾" onClose={onClose} className={`modal-box ${styles.trickModal}`}>
        <div className="modal-header">
          <h2>👁️ 上一轮出牌回顾</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-body">
          {lastTrick.length === 0 ? (
            <p className={styles.emptyTip}>暂无上一轮记录（第 1 轮尚未结束）</p>
          ) : (
            <>
              <div className={styles.lastTrickSummary}>
                本轮赢家：
                <strong>{lastWinner !== null ? `${SEAT_NAMES[lastWinner]}家` : '无'}</strong>
                ，共收分 <strong>{lastPoints}</strong> 分
              </div>
              <div className={styles.lastTrickCards}>
                {lastTrick.map((item) => {
                  const isWinner = item.seat === lastWinner;
                  return (
                    <div key={item.seat} className={`${styles.lastTrickItem} ${isWinner ? styles.winnerCard : ''}`}>
                      <div className={styles.seatTag}>
                        {SEAT_NAMES[item.seat]}
                        {isWinner && <span className={styles.winBadge}>赢</span>}
                      </div>
                      <CardView card={item.card} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>返回牌局</button>
        </div>
    </Modal>
  );
}
