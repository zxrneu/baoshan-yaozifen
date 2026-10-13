/** 查分器与 100 分分牌记牌器 */
import Modal from './Modal';
import { SUIT_SYMBOL, Suit, cardId } from '../cards';
import { GameState, SEAT_NAMES } from '../engine';
import styles from './PointsTrackerModal.module.css';

interface Props {
  game: GameState;
  humanSeat: number;
  onClose: () => void;
}

const POINT_RANKS = ['A', '10', '5'] as const;
const SUITS: Suit[] = ['S', 'H', 'C', 'D'];

export default function PointsTrackerModal({ game, humanSeat, onClose }: Props) {
  const declarerPts = game.declarerTrickPoints + game.buriedPoints;
  const defenderPts = game.defenderTrickPoints;
  const remainingPts = Math.max(0, 100 - declarerPts - defenderPts);

  // 获取手牌与桌面现存卡牌
  const humanHandIds = new Set((game.hands[humanSeat] ?? []).map(cardId));
  const currentTrickIds = new Set(game.trick.map((t) => cardId(t.card)));
  const allExistingIds = new Set(
    game.hands.flat().concat(game.kitty).concat(game.trick.map((t) => t.card)).map(cardId),
  );

  return (
    <Modal label="实时分牌与记账盘点" onClose={onClose} className={`modal-box ${styles.pointsModal}`}>
        <div className="modal-header">
          <h2>📊 实时分牌与记账盘点</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-body">
          <div className={styles.ptsOverviewGrid}>
            <div className={styles.ptsStatCard}>
              <span className={styles.lbl}>
                庄家方（{game.declarer !== null ? `${SEAT_NAMES[game.declarer]}家` : '待定'}）吃分
              </span>
              <span className={styles.val}>{declarerPts} 分</span>
              <span className={styles.sub}>
                {game.highestBid > 0 ? `叫分线 ${game.highestBid} 分（还差 ${Math.max(0, game.highestBid - declarerPts)} 分）` : '起叫 70 分'}
              </span>
            </div>
            <div className={`${styles.ptsStatCard} ${styles.blue}`}>
              <span className={styles.lbl}>闲家方吃分</span>
              <span className={styles.val}>{defenderPts} 分</span>
              <span className={styles.sub}>目标阻击庄家</span>
            </div>
            <div className={`${styles.ptsStatCard} ${styles.green}`}>
              <span className={styles.lbl}>剩余未吃分</span>
              <span className={styles.val}>{remainingPts} 分</span>
              <span className={styles.sub}>全副合计 100 分</span>
            </div>
          </div>

          <div className={styles.pointCardsSection}>
            <h3>🎴 12 张分牌去向明细（A=10分，10=10分，5=5分）</h3>
            <div className={styles.pointCardMatrix}>
              {POINT_RANKS.map((rank) => (
                <div key={rank} className={styles.rankRow}>
                  <div className={styles.rankBadge}>
                    {rank} <span>({rank === '5' ? '5分' : '10分'})</span>
                  </div>
                  <div className={styles.cardsRow}>
                    {SUITS.map((suit) => {
                      const cid = `${rank}${suit}`;
                      const isRed = suit === 'H' || suit === 'D';
                      const inHand = humanHandIds.has(cid);
                      const onTable = currentTrickIds.has(cid);
                      const isPlayed = !allExistingIds.has(cid);

                      let statusText = '未出';
                      let statusCls = '';
                      if (inHand) {
                        statusText = '手中';
                        statusCls = styles.inHand;
                      } else if (onTable) {
                        statusText = '桌上';
                        statusCls = styles.onTable;
                      } else if (isPlayed) {
                        statusText = '已吃';
                        statusCls = styles.played;
                      }

                      return (
                        <div
                          key={cid}
                          className={`${styles.trackerChip} ${isRed ? styles.red : ''} ${statusCls}`}
                          title={`${rank}${SUIT_SYMBOL[suit]} - ${statusText}`}
                        >
                          <span>{rank}</span>
                          <span>{SUIT_SYMBOL[suit]}</span>
                          <span className={styles.status}>{statusText}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.trackerLegend}>
              <span><span className={`${styles.dot} ${styles.inHand}`} /> 你手中</span>
              <span><span className={`${styles.dot} ${styles.onTable}`} /> 本轮桌面</span>
              <span><span className={`${styles.dot} ${styles.played}`} /> 历史已打出收走</span>
              <span><span className={`${styles.dot} ${styles.unplayed}`} /> 尚未打出</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>返回对局</button>
        </div>
    </Modal>
  );
}
