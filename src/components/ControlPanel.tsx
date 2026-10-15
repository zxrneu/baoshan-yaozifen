/**
 * 控制面板：按对局阶段分派到各子面板。
 * 增强各阶段的操作提示、花色统计、扣底预览与出牌确认。
 */
import { type ReactNode } from 'react';
import { SUIT_NAME, SUIT_SYMBOL, Suit, Card, cardPoints, cardLabel } from '../cards';
import { SEAT_NAMES, HandResult, Phase, TrickCard } from '../engine';
import styles from './ControlPanel.module.css';
import HandReplayButton, { type HandReplayProps } from './HandReplayButton';

interface PanelProps {
  seat: number; // 当前行动座位
  humanSeat: number;
  takeover?: boolean;
}

const isHuman = (p: PanelProps) => p.seat === p.humanSeat;

function BiddingPanel({
  seat, humanSeat, takeover, bidOptions, doBid,
}: PanelProps & { bidOptions: number[]; doBid: (b: number | null) => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待 {SEAT_NAMES[seat]} 叫分…</span>;
  }
  return (
    <div className={styles.ctlBiddingWrap}>
      <span className={styles.ctlBiddingPrompt}>{takeover ? SEAT_NAMES[seat] + '家叫分：' : '直接叫分：'}</span>
      <div className={styles.bidBtnGroup} role="group" aria-label="直接叫分档位">
        <button
          type="button"
          className={styles.passOption}
          onClick={() => doBid(null)}
          title="放弃本轮叫分"
        >
          不叫
        </button>
        {bidOptions.map((b, idx) => (
          <button
            key={b}
            type="button"
            className={`${styles.bidOption} ${idx === 0 ? styles.lowestBid : ''} ${b === 100 ? styles.maxBid : ''}`}
            aria-label={`叫 ${b} 分`}
            onClick={() => doBid(b)}
            title={`直接叫 ${b} 分`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}

function TrumpPanel({
  seat, humanSeat, takeover, humanHand, doTrump,
}: PanelProps & { humanHand: Card[]; doTrump: (s: Suit) => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待庄家定主…</span>;
  }

  // 花色统计只呈现事实；张数最多不代表经过引擎评估的最优主牌。
  const suitStats = (['S', 'H', 'C', 'D'] as Suit[]).map((s) => {
    const cards = humanHand.filter((c) => c.suit === s);
    const pts = cards.reduce((sum, c) => sum + cardPoints(c), 0);
    return { suit: s, count: cards.length, pts };
  });

  const maxCount = Math.max(...suitStats.map((st) => st.count));

  return (
    <div className={styles.ctlTrumpWrap}>
      <span className={styles.ctlLabel}>{takeover ? SEAT_NAMES[seat] + '家定主：' : '你是庄家，请选择一门主牌花色：'}</span>
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
              {isRecommended && <span className={styles.recBadge}>张数最多</span>}
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
  takeover,
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
          {takeover ? SEAT_NAMES[seat] + '家扣底：' : '你是庄家：'}点击手牌选 <strong>{kittySize}</strong> 张非分牌扣回底牌（已选 <strong>{selected.length}/{kittySize}</strong>）
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
  takeover,
  trick,
  humanHand,
  selectedPlayCard,
  confirmBeforePlay,
  confirmPlayCard,
}: PanelProps & {
  trick: TrickCard[];
  humanHand: Card[];
  selectedPlayCard: Card | null;
  confirmBeforePlay: boolean;
  confirmPlayCard: () => void;
  }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className={styles.ctlLabel}>等待 {SEAT_NAMES[seat]} 出牌…</span>;
  }

  const ledSuit = trick[0]?.card.suit;
  const suitName = ledSuit ? `${SUIT_NAME[ledSuit]}${SUIT_SYMBOL[ledSuit]}` : '';
  const prompt = !ledSuit ? '首家领出 · 可出任意牌'
    : humanHand.some(card => card.suit === ledSuit) ? `须跟${suitName}` : `缺${suitName} · 可出任意牌`;

  return (
    <div className={styles.ctlPlayWrap}>
      <span className={styles.ctlLabel}>{takeover ? '轮到' + SEAT_NAMES[seat] + '家' : '轮到你'}出牌 · {prompt}</span>
      {confirmBeforePlay ? (
        <div className={styles.playConfirmBox}>
          {/* 按钮与再次点击同牌等价，确认入口明确显示即将打出的牌。 */}
          <span className={styles.cardPicked}>
            {selectedPlayCard
              ? <>已选 <strong>{cardLabel(selectedPlayCard)}</strong> · 再点一次出牌</>
              : '点一张牌选中，再点一次出牌'}
          </span>
          <button type="button" className={`primary-btn ${styles.playBtnSecondary}`} onClick={confirmPlayCard} disabled={!selectedPlayCard}>
            {selectedPlayCard ? `出牌 ${selectedPlayCard.rank}${SUIT_SYMBOL[selectedPlayCard.suit]}` : '选择一张牌'}
          </button>
        </div>
      ) : (
        <div className={styles.playConfirmBox}>
          <span className={styles.playInstantHint}>⚡ 点牌即出（已关闭二次确认）</span>
        </div>
      )}
    </div>
  );
}

function ResultPanel({
  result, matchEnded, goNextHand, restart, saveState, onReplay, onExitPractice,
}: HandReplayProps & { result: HandResult | null; matchEnded: boolean; goNextHand: () => void; restart: () => void; onExitPractice?: () => void }) {
  return (
    <div className={styles.ctlResultInline}>
      {result && (
        <span className={styles.resultShort}>
          庄家 {SEAT_NAMES[result.declarer]}（叫 {result.bid} 分，吃 {result.declarerPoints} 分）
          → <strong>{result.success ? '成局' : '不成'}</strong>
        </span>
      )}
      <HandReplayButton saveState={saveState} onReplay={onReplay}/>
      {onExitPractice ? <button type="button" className="primary-btn" onClick={onExitPractice}>返回标准对局</button> : matchEnded ? (
        <button type="button" className="primary-btn" onClick={restart}>再来一场</button>
      ) : (
        <button type="button" className="primary-btn" onClick={goNextHand}>下一副</button>
      )}
      {!onExitPractice && <button type="button" className="pass-btn" onClick={restart}>重新开局</button>}
    </div>
  );
}

interface ControlPanelProps extends PanelProps, HandReplayProps {
  /** 暂停时的非人工回合必须说明继续入口，避免把静止局面称为正在等待。 */
  paused?: boolean;
  /** 正方形工作台使用紧凑布局，保留同一套阶段行为。 */
  compact?: boolean;
  phase: Phase;
  highestBid: number;
  bidOptions: number[];
  kittySize: number;
  selected: Card[];
  humanHand: Card[];
  selectedPlayCard: Card | null;
  trick: TrickCard[];
  result: HandResult | null;
  /** 出牌是否需要二次确认（点同牌再点一次）；false 时点牌即出 */
  confirmBeforePlay: boolean;
  doBid: (b: number | null) => void;
  doTrump: (s: Suit) => void;
  doBury: () => void;
  autoSelectBury: () => void;
  clearSelectedBury: () => void;
  confirmPlayCard: () => void;
  goNextHand: () => void;
  restart: () => void;
  onExitPractice?: () => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const base = { seat: props.seat, humanSeat: props.humanSeat, takeover: props.takeover };
  let inner: ReactNode = null;
  if (props.paused && !isHuman(base) && props.seat >= 0 && props.phase !== 'handEnd' && props.phase !== 'matchEnd') {
    inner = <span className={styles.ctlLabel} role="status">{props.saveState?.status === 'error'
      ? '保存失败，请先点击顶栏“重试保存”，再继续对局。'
      : `已暂停，点击顶栏“开始”让${SEAT_NAMES[props.seat]}家继续行动。`}</span>;
  } else switch (props.phase) {
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
          humanHand={props.humanHand}
          selectedPlayCard={props.selectedPlayCard}
          confirmBeforePlay={props.confirmBeforePlay}
          confirmPlayCard={props.confirmPlayCard}
        />
      );
      break;
    case 'handEnd':
    case 'matchEnd':
      inner = (
        <ResultPanel
          onExitPractice={props.onExitPractice}
          saveState={props.saveState}
          onReplay={props.onReplay}
          result={props.result}
          matchEnded={props.phase === 'matchEnd'}
          goNextHand={props.goNextHand}
          restart={props.restart}
        />
      );
      break;
  }
  return (
    <div className={`${styles.controls} ${props.compact ? styles.compact : ''}`}>
      <div className={styles.ctlGroup}>
        {inner}
      </div>
    </div>
  );
}
