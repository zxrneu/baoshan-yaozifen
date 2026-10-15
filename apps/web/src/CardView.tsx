/** 纯展示组件：扑克牌单张（支持半遮叠牌、角标分牌与主牌视觉强化） */
import { Card as CardModel, SUIT_SYMBOL, cardPoints } from '@yaozifen/game-core/cards';
import styles from './CardView.module.css';
import { useContext } from 'react';
import { CardInspectionContext } from './components/cardInspection';
import { SUIT_PATH } from './suitShapes';

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
  const inspection = useContext(CardInspectionContext);
  const click = inspection && (inspection.inspectOnly || !onClick) ? () => inspection.inspect(card) : onClick;
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
      onClick={click}
      tabIndex={click ? undefined : -1}
      disabled={(disabled || playable === false) && !click}
      aria-disabled={!inspection?.inspectOnly && disabled || undefined}
      title={disabledReason}
      aria-label={`${card.rank}${SUIT_SYMBOL[card.suit]}${isTrump ? '，主牌' : ''}${isKitty ? '，摸入的底牌' : ''}${pts > 0 ? `，${pts}分` : ''}${disabledReason ? `，${disabledReason}` : ''}`}
      aria-pressed={!inspection?.inspectOnly && playable ? Boolean(selected) : undefined}
    >
      {/* 左上角标：半遮叠牌时清晰可见点数与花色 */}
      <span className={`${styles.corner} ${styles.top}`}>
        <span className={`${styles.rankText} ${card.rank === '10' ? styles.rankTen : ''}`}>{card.rank}</span>
        <i className={styles.suitIcon}>{SUIT_SYMBOL[card.suit]}</i>
      </span>

      {/* 中心大花色 */}
      <svg className={styles.pip} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={SUIT_PATH[card.suit]} fill="currentColor" />
      </svg>

      {/* 紧凑主牌角标，窄屏仍保留左上牌面点数。 */}
      {isTrump && <span className={styles.trumpFlag} aria-label="主牌">主</span>}

      {(pts > 0 || isKitty) && <span className={styles.markings} aria-hidden="true">
        {pts > 0 && <span className={styles.ptsBadge}>+{pts}</span>}
        {isKitty && <span className={styles.kittyFlag}>底</span>}
      </span>}

      {/* 右下角对称角标 */}
      <span className={`${styles.corner} ${styles.bottom}`}>
        <span className={`${styles.rankText} ${card.rank === '10' ? styles.rankTen : ''}`}>{card.rank}</span>
        <i className={styles.suitIcon}>{SUIT_SYMBOL[card.suit]}</i>
      </span>
    </button>
  );
}
