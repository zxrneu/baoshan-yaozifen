/** 动作展示层遵循单一职责：逐步呈现动作、牌张与去向，推进由对局编排控制。 */
import type { CSSProperties } from 'react';
import { cardId, cardPoints, SUIT_SYMBOL } from '@yaozifen/game-core/cards';
import { SEAT_NAMES } from '@yaozifen/game-core';
import type { ActionPresentation as Presentation } from '../hooks/actionPresentation';
import CardView from '../CardView';
import styles from './ActionPresentation.module.css';
import { seatAngle } from './seatLayout';

interface Props { action: Presentation; automatic: boolean; viewSeat: number; playerFacing?: boolean; inSidebar?: boolean; onNext: () => void; onPause: () => void }
const LABELS = { deal: '发牌', bid: '叫分', declarer: '定庄', trump: '定主', kittyReveal: '翻底', kittyPickup: '起底', bury: '扣底', partnerReveal: '明牌', play: '出牌', collect: '收墩', score: '计分', result: '结算' };
export default function ActionPresentation({ action, automatic, viewSeat, playerFacing = false, inSidebar = false, onNext, onPause }: Props) {
  const { kind, cards, hiddenCount, seat } = action;
  const position = seat === undefined ? -1 : (seat - viewSeat + 5) % 4;
  const directions = [[48, 0], [0, 48], [-48, 0], [0, -48]];
  const [x, y] = directions[position] ?? [0, 0];
  const style = { '--action-x': `${x}px`, '--action-y': `${y}px`, '--action-duration': `${action.duration}ms` } as CSSProperties;
  const totalPoints = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  const emblem = kind === 'trump' && action.game.trump ? SUIT_SYMBOL[action.game.trump]
    : kind === 'bid' ? action.title.match(/\d+/)?.[0] ?? '—'
    : kind === 'score' ? `+${action.game.lastPoints}` : kind === 'declarer' ? '♛' : kind === 'result' ? '✦' : null;
  const route = kind === 'kittyPickup' ? `桌面底牌 → ${SEAT_NAMES[seat!]}家手牌`
    : kind === 'bury' ? `${SEAT_NAMES[seat!]}家手牌 → 桌面底牌`
    : kind === 'collect' ? `桌面四张牌 → ${SEAT_NAMES[seat!]}家收牌区` : null;
  return <div className={styles.overlay} data-layout={inSidebar ? 'sidebar' : playerFacing ? 'center' : 'seat'}>
    <section key={`${kind}-${action.index}`} className={styles.panel} aria-label="动作展示" data-action={kind} data-position={['right', 'bottom', 'left', 'top'][position] ?? 'center'} style={style}>
      <div className={styles.facingContent} data-action-facing style={{transform: `rotate(${playerFacing ? seatAngle(seat ?? -1) : 0}deg)`}}>
      <div role="status" aria-live="polite" aria-atomic="true" className={styles.actionText}>
        {emblem && <span className={styles.emblem} aria-hidden="true">{emblem}</span>}<h2>{action.title}</h2>
      </div>
      {kind !== 'play' && (cards.length > 0 || hiddenCount > 0) && <div className={`${styles.cards} ${cards.length > 4 ? styles.many : ''}`}>
        {cards.map((card, i) => <div key={cardId(card)} className={styles.cardItem} data-action-card={cardId(card)} style={{animationDelay: `${i * 90}ms`}}>
          <CardView card={card} isTrump={card.suit === action.game.trump} isKitty={kind === 'kittyReveal' || kind === 'kittyPickup'} />
        </div>)}
        {Array.from({length: hiddenCount}, (_, i) => <div key={i} className={styles.cardItem} style={{animationDelay: `${i * 90}ms`}}>
          <CardView card={{suit:'S',rank:'2'}} faceDown />
        </div>)}
      </div>}
      <p className={styles.detail}>{route ?? action.detail}</p>
      {(kind === 'kittyReveal' || kind === 'collect') && cards.length > 0 && <span className={styles.points}>含 {totalPoints} 分</span>}
      <div className={styles.controls}><span>{LABELS[kind]} · {action.index} / {action.total}</span>
        {automatic && <button type="button" aria-label="暂停当前动作" title="留在这一步" onClick={onPause}>Ⅱ</button>}
        <button type="button" aria-label="继续展示下一步" title="下一步（空格）" onClick={onNext} onKeyDown={event => {
          if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); event.stopPropagation(); onNext(); }
        }}>→</button>
      </div>
      {automatic && <div className={styles.timer} aria-hidden="true" />}
      </div>
    </section>
  </div>;
}
