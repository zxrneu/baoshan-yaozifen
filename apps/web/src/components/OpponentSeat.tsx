/** 对手座位视图遵循单一职责：展示公开信息，并为授权透视提供键盘可达入口。 */
import { useEffect, useState } from 'react';
import { SEAT_NAMES } from '@yaozifen/game-core';
import type { Card, Suit } from '@yaozifen/game-core/cards';
import CardView from '../CardView';
import RevealedHand from './RevealedHand';
import { thinkingService, ThinkingState } from '@yaozifen/ai-core/engines/thinkingService';
import styles from './OpponentSeat.module.css';

interface Props {
  seat: number;
  displaySeat?: number;
  cardCount: number;
  isTurn: boolean;
  isDeclarer: boolean;
  isPartner: boolean;
  hasDeclarer: boolean;
  isTeammate: boolean;
  isRevealed?: boolean;
  isPeeked?: boolean;
  revealedCards?: readonly Card[];
  trump?: Suit | null;
  points?: number;
  biddingNote?: number | null; // 最近一次叫分情况
  isBiddingPhase?: boolean;
  onTogglePeek?: () => void;
  engineLabel?: string;
  onChangeEngine?: () => void;
}

const SEAT_POS = ['right', 'bottom', 'left', 'top'] as const;

const SEAT_AVATARS: Record<number, { emoji: string; title: string }> = {
  0: { emoji: '🤠', title: '东家' },
  1: { emoji: '👑', title: '南家（你）' },
  2: { emoji: '🎩', title: '西家' },
  3: { emoji: '👲', title: '北家' },
};

export default function OpponentSeat({
  seat,
  displaySeat = seat,
  cardCount,
  isTurn,
  isDeclarer,
  isPartner,
  hasDeclarer,
  isTeammate,
  isRevealed,
  isPeeked,
  revealedCards,
  trump,
  points,
  biddingNote,
  isBiddingPhase,
  onTogglePeek,
  engineLabel,
  onChangeEngine,
}: Props) {
  const avatar = SEAT_AVATARS[seat] ?? { emoji: '🧑', title: SEAT_NAMES[seat] };
  const isAlarm = cardCount > 0 && cardCount <= 3;
  const posClass = styles[SEAT_POS[displaySeat]] ?? '';

  const [thinkingState, setThinkingState] = useState<ThinkingState>(() =>
    thinkingService.getState(),
  );

  useEffect(() => {
    return thinkingService.subscribe((s) => {
      setThinkingState(s);
    });
  }, []);

  const isThinkingForMe = thinkingState.seat === seat && thinkingState.phase !== 'idle';
  const showCards = Boolean((isRevealed || isPeeked) && revealedCards);
  const AvatarTag = onTogglePeek ? 'button' : 'div';

  return (
    <div
      className={`${styles.seat} ${posClass} ${isTurn ? styles.turn : ''} ${
        showCards ? styles.withRevealedHand : ''
      }`}
    >
      {/* 玩家头顶流式思考气泡 */}
      {isThinkingForMe && (
        <div
          className={`${styles.thoughtStreamBubble} ${
            thinkingState.phase === 'decided' ? styles.decided : ''
          }`}
        >
          <div className={styles.thoughtHeader}>
            <span className={styles.pulseDot} />
            <span>{thinkingState.phase === 'decided' ? '💡 决策结论' : '🧠 深度思考中...'}</span>
          </div>
          <div className={styles.thoughtText}>
            {thinkingState.phase === 'decided'
              ? thinkingState.conclusion || thinkingState.text
              : thinkingState.text}
          </div>
        </div>
      )}
      <div className={styles.seatHeaderDock}>
        <div className={styles.seatHeader}>
          {/* 叫分阶段的最近行动 */}
          {isBiddingPhase && isTurn && biddingNote === undefined && (
            <div className={`${styles.seatBubble} ${styles.thinking}`}>
              <span>🤔 思考中…</span>
              <span className={styles.bubbleArrow} />
            </div>
          )}
          {biddingNote !== undefined && (
            <div className={`${styles.seatBubble} ${biddingNote === null ? styles.pass : styles.bid}`}>
              <span>{biddingNote === null ? '不叫' : `叫 ${biddingNote} 分`}</span>
              <span className={styles.bubbleArrow} />
            </div>
          )}

          {/* 头像展示区 */}
          <div className={styles.seatAvatarWrap}>
            <AvatarTag
              type={onTogglePeek ? 'button' : undefined}
              aria-label={onTogglePeek ? `${showCards ? '隐藏' : '查看'}${SEAT_NAMES[seat]}家手牌` : undefined}
              aria-expanded={onTogglePeek ? showCards : undefined}
              className={`${styles.avatarFrame} ${isTurn ? styles.glowing : ''} ${
                onTogglePeek ? styles.avatarClickable : ''
              }`}
              onClick={onTogglePeek}
              title={onTogglePeek ? '点击翻看/隐藏该玩家手牌 (开发模式)' : undefined}
            >
              <span className={styles.avatarIcon}>{avatar.emoji}</span>
            </AvatarTag>

            <div className={styles.seatInfoBox}>
              <div className={styles.seatName}>
                <span>{SEAT_NAMES[seat]}</span>
                {isDeclarer && <span className={`${styles.badge} ${styles.declarer}`}>👑 庄</span>}
                {isPartner && <span className={`${styles.badge} ${styles.partner}`}>🤝 搭</span>}
                {hasDeclarer && !isDeclarer && !isPartner && <span className={`${styles.badge} ${styles.defender}`}>闲</span>}
                {!hasDeclarer && isTeammate && <span className={`${styles.badge} ${styles.partner}`}>同队</span>}
                {isPeeked && <span className={styles.peekBadge}>👀透视</span>}
              </div>

              {/* 确定庄家后显示个人吃分 */}
              {hasDeclarer && <div className={styles.seatPointsChip} title={`${SEAT_NAMES[seat]}已收得分牌分`}>
                <span className={styles.ptsCoin}>🪙</span>
                <span className={styles.ptsVal}>{points ?? 0}分</span>
              </div>}

              {cardCount > 0 && (
                <div className={`${styles.seatCount} ${isAlarm ? styles.alarm : ''}`}>
                  <span>🎴</span>
                  <span>{cardCount}张</span>
                  {isAlarm && <span className={styles.alertTag}>警报!</span>}
                </div>
              )}
            </div>
          </div>

          {engineLabel && <button type="button" className={styles.seatEngine} aria-label={`${SEAT_NAMES[seat]}家当前引擎`} aria-haspopup="dialog" onClick={onChangeEngine}>{engineLabel}</button>}

        </div>
      </div>

      {showCards && revealedCards ? (
        <RevealedHand
          seat={seat}
          cards={revealedCards}
          trump={trump ?? null}
          isTeammate={isTeammate}
          className={styles.revealedCards}
          compactLabel
          orientation={SEAT_POS[displaySeat] === 'left' ? 'left' : SEAT_POS[displaySeat] === 'right' ? 'right' : 'top'}
        />
      ) : <div className={styles.seatCards} aria-label={`剩余 ${cardCount} 张手牌`}>
        {Array.from({ length: Math.min(cardCount, 3) }, (_, i) => (
          <CardView key={i} card={{ suit: 'S', rank: '2' }} size="mini" faceDown />
        ))}
      </div>}
    </div>
  );
}
