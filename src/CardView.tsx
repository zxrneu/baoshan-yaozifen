/** 纯展示组件：扑克牌单张（支持半遮叠牌、角标分牌与主牌视觉强化） */
import { Card as CardModel, SUIT_SYMBOL, cardPoints } from './cards';
import styles from './CardView.module.css';

interface Props {
  card: CardModel;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** 不能操作的原因，供悬停提示和读屏使用 */
  disabledReason?: string;
  playable?: boolean;
  /** 是否为主牌 */
  isTrump?: boolean;
  /** 是否为庄家本副摸入的底牌（仅在庄家自己的手牌中标识） */
  isKitty?: boolean;
  /** 尺寸变体：normal 标准 | small 历史记录 | mini 对家牌背 */
  size?: 'normal' | 'small' | 'mini';
  className?: string;
  onClick?: () => void;
}

const RED = new Set(['H', 'D']);

export default function CardView({
  card,
  faceDown,
  selected,
  disabled,
  disabledReason,
  playable,
  isTrump,
  isKitty,
  size = 'normal',
  className = '',
  onClick,
}: Props) {
  if (faceDown) {
    const faceDownCls = [
      styles.card,
      styles.faceDown,
      size !== 'normal' ? styles[size] : '',
      className,
    ].filter(Boolean).join(' ');

    return (
      <div className={faceDownCls} aria-label="暗牌">
        <div className={styles.faceDownInner} />
      </div>
    );
  }

  const cls = [
    styles.card,
    RED.has(card.suit) ? styles.red : styles.black,
    selected ? styles.selected : '',
    playable ? styles.playable : '',
    disabled ? styles.disabled : '',
    isTrump ? styles.isTrump : '',
    size !== 'normal' ? styles[size] : '',
    className,
  ].filter(Boolean).join(' ');

  const pts = cardPoints(card);

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      tabIndex={onClick ? undefined : -1}
      disabled={(disabled || playable === false) && !onClick}
      aria-disabled={disabled || undefined}
      title={disabledReason}
      aria-label={`${card.rank}${SUIT_SYMBOL[card.suit]}${isTrump ? '，主牌' : ''}${isKitty ? '，摸入的底牌' : ''}${pts > 0 ? `，${pts}分` : ''}${disabledReason ? `，${disabledReason}` : ''}`}
      aria-pressed={playable ? Boolean(selected) : undefined}
    >
      {/* 左上角标：半遮叠牌时清晰可见点数、花色与分值 */}
      <span className={`${styles.corner} ${styles.top}`}>
        <span className={styles.rankText}>{card.rank}</span>
        <i className={styles.suitIcon}>{SUIT_SYMBOL[card.suit]}</i>
        {pts > 0 && <span className={styles.ptsBadge}>+{pts}</span>}
      </span>

      {/* 中心大花色 */}
      <span className={styles.pip}>{SUIT_SYMBOL[card.suit]}</span>

      {/* 紧凑主牌角标，窄屏仍保留左上牌面点数。 */}
      {isTrump && <span className={styles.trumpFlag} aria-label="主牌">主</span>}

      {isKitty && <span className={styles.kittyFlag} aria-hidden="true">底</span>}

      {/* 右下角对称角标 */}
      <span className={`${styles.corner} ${styles.bottom}`}>
        <span className={styles.rankText}>{card.rank}</span>
        <i className={styles.suitIcon}>{SUIT_SYMBOL[card.suit]}</i>
      </span>
    </button>
  );
}
