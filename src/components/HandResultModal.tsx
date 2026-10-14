/** 副结算与大局终局战报弹窗 */
import Modal from './Modal';
import { SUIT_SYMBOL, SUIT_NAME, Card as CardModel } from '../cards';
import { SEAT_NAMES, SIDE_NAMES, HandResult } from '../engine';
import CardView from '../CardView';
import styles from './HandResultModal.module.css';
import HandReplayButton, { type HandReplayProps } from './HandReplayButton';

interface Props extends HandReplayProps {
  result: HandResult;
  kitty: CardModel[];
  scores: [number, number];
  targetWins: number;
  matchEnded: boolean;
  humanSeat: number;
  goNextHand: () => void;
  restart: () => void;
  onClose: () => void;
  onExitPractice?: () => void;
}

export default function HandResultModal({
  result,
  kitty,
  scores,
  targetWins,
  matchEnded,
  humanSeat,
  goNextHand,
  restart,
  onClose,
  saveState,
  onReplay,
  onExitPractice,
}: Props) {
  const isHumanSideWin = result.winnerSide === humanSeat % 2;
  const declarerName = SEAT_NAMES[result.declarer];
  const trumpName = `${SUIT_SYMBOL[result.trump]} ${SUIT_NAME[result.trump]}`;

  return (
    <Modal label={onExitPractice ? '单副练习结算' : matchEnded ? "本场结算" : "本副结算"} onClose={onClose} className={`modal-box ${styles.resultModal} ${matchEnded && !onExitPractice ? styles.matchEnded : ''}`}>
        <div className="modal-header">
          <h2>
            {onExitPractice ? '本副练习结束' : matchEnded
              ? isHumanSideWin ? '🏆 恭喜！你方荣获整场胜利！' : '⚔️ 本场比赛结束'
              : result.success ? '🎉 庄家方成局！' : '🛡️ 闲家方破局防守成功！'}
          </h2>
        </div>
        <div className="modal-body">
          <div className={`${styles.resultHeadline} ${result.success ? styles.success : styles.fail}`}>
            <span className={styles.bigTitle}>
              {SIDE_NAMES[result.winnerSide]} 胜出本副！
            </span>
            <span className={styles.subTitle}>
              庄家：{declarerName} · 叫分：{result.bid} 分 · 主牌：{trumpName}
            </span>
            {result.earlyFinish && (
              <span className={styles.earlyBadge}>⚡ 提前锁定胜负（提前结算）</span>
            )}
          </div>

          <div className={styles.resultStatsTable}>
            <div className={styles.statRow}>
              <span className={styles.label}>庄方总吃分：</span>
              <span className={`${styles.val} ${styles.highlight}`}>
                {result.declarerPoints} 分（出牌得分 {result.declarerPoints - result.buriedPoints} + 底牌分 {result.buriedPoints}）
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.label}>叫分线目标：</span>
              <span className={styles.val}>{result.bid} 分</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.label}>闲方总吃分：</span>
              <span className={styles.val}>{result.defenderPoints} 分</span>
            </div>
            {result.earlyFinish && result.unplayedPoints !== undefined && result.unplayedPoints > 0 && (
              <div className={styles.statRow}>
                <span className={styles.label}>未打出分：</span>
                <span className={styles.val}>{result.unplayedPoints} 分（胜负锁定，剩余牌保留）</span>
              </div>
            )}
            <div className={styles.statRow}>
              <span className={styles.label}>最终结果：</span>
              <span className={`${styles.val} ${styles.tag} ${result.success ? styles.tagWin : styles.tagLoss}`}>
                {result.success
                  ? `成局（超 ${result.declarerPoints - result.bid} 分）`
                  : `不成（差 ${result.bid - result.declarerPoints} 分）`}
              </span>
            </div>
          </div>

          {kitty.length > 0 && (
            <div className={styles.kittyRevealBox}>
              <div className={styles.kittyTitle}>🎴 最终底牌揭晓（{result.buriedPoints} 分归庄家方）：</div>
              <div className={styles.kittyCards}>
                {kitty.map((c, i) => (
                  <CardView key={i} card={c} />
                ))}
              </div>
            </div>
          )}

          {!onExitPractice && <div className={styles.matchScoreProgress}>
            <div className={styles.scoreTitle}>
              当前总场分（先胜 {targetWins} 副夺冠）：
            </div>
            <div className={styles.scoreBars}>
              <div className={`${styles.scoreBarItem} ${humanSeat % 2 === 0 ? styles.isMe : ''}`}>
                <span className={styles.team}>东西方{humanSeat % 2 === 0 ? '（你）' : ''}</span>
                <span className={styles.scoreNumber}>{scores[0]}</span>
              </div>
              <div className={styles.scoreVs}>VS</div>
              <div className={`${styles.scoreBarItem} ${humanSeat % 2 === 1 ? styles.isMe : ''}`}>
                <span className={styles.team}>南北方{humanSeat % 2 === 1 ? '（你）' : ''}</span>
                <span className={styles.scoreNumber}>{scores[1]}</span>
              </div>
            </div>
          </div>}
        </div>

        <div className="modal-footer">
          <HandReplayButton saveState={saveState} onReplay={onReplay}/>
          <button type="button" className="ghost-btn" onClick={onClose}>回看牌桌</button>
          {onExitPractice ? <button type="button" className="primary-btn" onClick={onExitPractice}>返回标准对局</button> : matchEnded ? (
            <button type="button" className="primary-btn" onClick={restart}>
              🏆 开启新一场对局
            </button>
          ) : (
            <>
              <button type="button" className="primary-btn" onClick={goNextHand}>
                下一副牌 ➔
              </button>
              <button type="button" className="pass-btn" onClick={restart}>
                重新开局
              </button>
            </>
          )}
        </div>
    </Modal>
  );
}
