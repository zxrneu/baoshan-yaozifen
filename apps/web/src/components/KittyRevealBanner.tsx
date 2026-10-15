/** 庄家拿底翻牌展示横幅/浮层 */
import Modal from './Modal';
import { Card as CardModel, cardPoints } from '@yaozifen/game-core/cards';
import CardView from '../CardView';
import styles from './KittyRevealBanner.module.css';

interface Props {
  kittyCards: CardModel[];
  onDismiss: () => void;
}

export default function KittyRevealBanner({ kittyCards, onDismiss }: Props) {
  const pts = kittyCards.reduce((sum, c) => sum + cardPoints(c), 0);

  return (
    <Modal label="庄家摸底揭晓" onClose={onDismiss} backdropClassName={styles.kittyModalOverlay} className={styles.kittyRevealDialog}>
        <div className={styles.revealTitle}>
          <span>🎴 庄家摸底揭晓</span>
          {pts > 0 && <span className={styles.ptsBonus}>含分牌 {pts} 分！</span>}
        </div>
        <p className={styles.revealDesc}>以下 4 张底牌已并入你的手牌，请选择 4 张非分牌扣回底牌：</p>
        <div className={styles.revealCards}>
          {kittyCards.map((c, i) => (
            <div key={i} className={styles.revealCardItem}>
              <CardView card={c} />
            </div>
          ))}
        </div>
        <button type="button" className="confirm-btn" onClick={onDismiss}>
          知道了，开始扣底
        </button>
    </Modal>
  );
}
