/**
 * 控制面板：按对局阶段分派到各子面板。
 * 增强各阶段的操作提示、花色统计、扣底预览与出牌确认。
 */
import { useState, type ReactNode } from 'react';
import { SUIT_NAME, SUIT_SYMBOL, Suit, Card, cardPoints, cardLabel } from '../cards';
import { SEAT_NAMES, HandResult, Phase, TrickCard } from '../engine';
import styles from './ControlPanel.module.css';

interface PanelProps {
  seat: number; // 当前行动座位
  humanSeat: number;
}

const isHuman = (p: PanelProps) => p.seat === p.humanSeat;

function BiddingPanel({
  seat, humanSeat, bidOptions, doBid,
}: PanelProps & { bidOptions: number[]; doBid: (b: number | null) => void }) {
  const [selectedBid, setSelectedBid] = useState<number | null>(bidOptions[0] ?? null);
  const chosenBid = selectedBid !== null && !bidOptions.includes(selectedBid)
    ? bidOptions[0] ?? null
    : selectedBid;
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待 {SEAT_NAMES[seat]} 叫分…</span>;
  }
  return (
    <div className={styles.ctlBiddingWrap}>
      <div className={styles.bidBtnGroup} role="group" aria-label="叫分分数">
        <button type="button" className={styles.passOption} aria-pressed={chosenBid === null} onClick={() => setSelectedBid(null)}>
          不叫
        </button>
        {bidOptions.map((b) => (
          <button
            key={b}
            type="button"
            className={styles.bidOption}
            aria-label={`${b} 分`}
            aria-pressed={chosenBid === b}
            onClick={() => setSelectedBid(b)}
          >
            {b}
          </button>
        ))}
      </div>
      <button type="button" className={`primary-btn ${styles.bidConfirm}`} onClick={() => doBid(chosenBid)}>
        {chosenBid === null ? '确认不叫' : `叫 ${chosenBid} 分`}
      </button>
      <span className={styles.bidStatus} role="status">{chosenBid === null ? '已选择不叫' : `已选择 ${chosenBid} 分，确认后提交`}</span>
    </div>
  );
}

function TrumpPanel({
  seat, humanSeat, humanHand, doTrump,
}: PanelProps & { humanHand: Card[]; doTrump: (s: Suit) => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待庄家定主…</span>;
  }

  // 统计每门花色的张数与分值，推荐最多张数花色
  const suitStats = (['S', 'H', 'C', 'D'] as Suit[]).map((s) => {
    const cards = humanHand.filter((c) => c.suit === s);
    const pts = cards.reduce((sum, c) => sum + cardPoints(c), 0);
    return { suit: s, count: cards.length, pts };
  });

  const maxCount = Math.max(...suitStats.map((st) => st.count));

  return (
    <div className={styles.ctlTrumpWrap}>
      <span className={styles.ctlLabel}>你是庄家，请选择一门主牌花色：</span>
      <div className={styles.trumpButtonsRow}>
        {suitStats.map(({ suit, count, pts }) => {
          const isRed = suit === 'H' || suit === 'D';
          const isRecommended = count === maxCount && count > 0;
          return (
            <button
              key={suit}
              type="button"
              className={`${styles.trumpChoiceBtn} ${isRed ? styles.redSuit : styles.blackSuit} ${isRecommended ? styles.recommended : ''}`}
              onClick={() => doTrump(suit)}
            >
              <span>{SUIT_SYMBOL[suit]}</span>
              <span>{SUIT_NAME[suit]}</span>
              <span className={styles.suitMeta}>({count}张·{pts}分)</span>
              {isRecommended && <span className={styles.recBadge}>推荐</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BuryPanel({
  seat,
  humanSeat,
  kittySize,
  selected,
  doBury,
  autoSelectBury,
  clearSelectedBury,
}: PanelProps & {
  kittySize: number;
  selected: Card[];
  doBury: () => void;
  autoSelectBury: () => void;
  clearSelectedBury: () => void;
}) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待庄家扣底…</span>;
  }
  const isReady = selected.length === kittySize;

  return (
    <div className={styles.ctlBuryWrap}>
      <div className={styles.buryHeaderLine}>
        <span className={styles.ctlLabel}>
          你是庄家：点击手牌选 <strong>{kittySize}</strong> 张非分牌扣回底牌（已选 <strong>{selected.length}/{kittySize}</strong>）
        </span>
        <div className={styles.buryActions}>
          <button type="button" className="ghost-btn" onClick={autoSelectBury}>
            ✨ 智能推荐扣底
          </button>
          {selected.length > 0 && (
            <button type="button" className="ghost-btn" onClick={clearSelectedBury}>
              清空
            </button>
          )}
          <button
            type="button"
            className="primary-btn"
            disabled={!isReady}
            onClick={doBury}
          >
            确认扣底（{selected.length}/{kittySize}）
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className={styles.burySelectedChips}>
          <span>已选扣底：</span>
          {selected.map((c, i) => (
            <span key={i} className={styles.chip}>
              {cardLabel(c)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayPanel({
  seat,
  humanSeat,
  trick,
  selectedPlayCard,
  confirmPlayCard,
}: PanelProps & {
  trick: TrickCard[];
  selectedPlayCard: Card | null;
  confirmPlayCard: () => void;
  }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待 {SEAT_NAMES[seat]} 出牌…</span>;
  }

  const prompt = trick.length === 0 ? '首家领出（任意合法牌）' : '跟牌轮次（必须同门优先）';

  return (
    <div className={styles.ctlPlayWrap}>
      <span className={styles.ctlLabel}>轮到你出牌 · {prompt}</span>
      <div className={styles.playConfirmBox}>
        <button type="button" className={`primary-btn ${styles.playBtn}`} onClick={confirmPlayCard} disabled={!selectedPlayCard}>
          出 牌
        </button>
        <span className={styles.cardPicked}>
          {selectedPlayCard ? <>已选 <strong>{cardLabel(selectedPlayCard)}</strong></> : '请选择手牌'}
        </span>
      </div>
    </div>
  );
}

function ResultPanel({
  result, matchEnded, goNextHand, restart,
}: { result: HandResult | null; matchEnded: boolean; goNextHand: () => void; restart: () => void }) {
  return (
    <div className={styles.ctlResultInline}>
      {result && (
        <span className={styles.resultShort}>
          庄家 {SEAT_NAMES[result.declarer]}（叫 {result.bid} 分，吃 {result.declarerPoints} 分）
          → <strong>{result.success ? '成局' : '不成'}</strong>
        </span>
      )}
      {matchEnded ? (
        <button type="button" className="primary-btn" onClick={restart}>再来一场</button>
      ) : (
        <button type="button" className="primary-btn" onClick={goNextHand}>下一副</button>
      )}
      <button type="button" className="pass-btn" onClick={restart}>重新开局</button>
    </div>
  );
}

interface ControlPanelProps extends PanelProps {
  phase: Phase;
  highestBid: number;
  bidOptions: number[];
  kittySize: number;
  selected: Card[];
  humanHand: Card[];
  selectedPlayCard: Card | null;
  trick: TrickCard[];
  result: HandResult | null;
  doBid: (b: number | null) => void;
  doTrump: (s: Suit) => void;
  doBury: () => void;
  autoSelectBury: () => void;
  clearSelectedBury: () => void;
  confirmPlayCard: () => void;
  goNextHand: () => void;
  restart: () => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const base = { seat: props.seat, humanSeat: props.humanSeat };
  let inner: ReactNode = null;
  switch (props.phase) {
    case 'bidding':
      inner = (
        <BiddingPanel key={`${props.seat}-${props.highestBid}`} {...base} bidOptions={props.bidOptions} doBid={props.doBid} />
      );
      break;
    case 'trump':
      inner = <TrumpPanel {...base} humanHand={props.humanHand} doTrump={props.doTrump} />;
      break;
    case 'bury':
      inner = (
        <BuryPanel
          {...base}
          kittySize={props.kittySize}
          selected={props.selected}
          doBury={props.doBury}
          autoSelectBury={props.autoSelectBury}
          clearSelectedBury={props.clearSelectedBury}
        />
      );
      break;
    case 'playing':
      inner = (
        <PlayPanel
          {...base}
          trick={props.trick}
          selectedPlayCard={props.selectedPlayCard}
          confirmPlayCard={props.confirmPlayCard}
        />
      );
      break;
    case 'handEnd':
    case 'matchEnd':
      inner = (
        <ResultPanel
          result={props.result}
          matchEnded={props.phase === 'matchEnd'}
          goNextHand={props.goNextHand}
          restart={props.restart}
        />
      );
      break;
  }
  return (
    <div className={styles.controls}>
      <div className={styles.ctlGroup}>
        {inner}
      </div>
    </div>
  );
}
