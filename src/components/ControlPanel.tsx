/**
 * 控制面板：按对局阶段分派到各子面板（开闭原则——
 * 新增阶段 = 新增一个子面板 + 在 map 中登记一处，其余组件不动）。
 */
import type { ReactNode } from 'react';
import { SUIT_NAME, SUIT_SYMBOL, Suit } from '../cards';
import { SEAT_NAMES, HandResult, Phase, TrickCard } from '../engine';

interface PanelProps {
  seat: number; // 当前行动座位
  humanSeat: number;
}

const isHuman = (p: PanelProps) => p.seat === p.humanSeat;

function BiddingPanel({
  seat, humanSeat, highestBid, bidOptions, doBid,
}: PanelProps & { highestBid: number; bidOptions: number[]; doBid: (b: number | null) => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className="ctl-label">等待 {SEAT_NAMES[seat]} 叫分…</span>;
  }
  return (
    <>
      <span className="ctl-label">轮到你叫分（当前最高 {highestBid}）：</span>
      <button onClick={() => doBid(null)}>不叫</button>
      {bidOptions.map((b) => (
        <button key={b} onClick={() => doBid(b)}>{b}</button>
      ))}
    </>
  );
}

function TrumpPanel({
  seat, humanSeat, doTrump,
}: PanelProps & { doTrump: (s: Suit) => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className="ctl-label">等待庄家定主…</span>;
  }
  return (
    <>
      <span className="ctl-label">你是庄家，请定主：</span>
      {(Object.keys(SUIT_SYMBOL) as Suit[]).map((s) => (
        <button key={s} onClick={() => doTrump(s)}>
          {SUIT_SYMBOL[s]} {SUIT_NAME[s]}
        </button>
      ))}
    </>
  );
}

function BuryPanel({
  seat, humanSeat, kittySize, selectedCount, doBury,
}: PanelProps & { kittySize: number; selectedCount: number; doBury: () => void }) {
  if (!isHuman({ seat, humanSeat })) {
    return <span className="ctl-label">等待庄家扣底…</span>;
  }
  return (
    <>
      <span className="ctl-label">
        你是庄家：点击手牌选 {kittySize} 张非分牌扣回底牌（已选 {selectedCount}）
      </span>
      <button disabled={selectedCount !== kittySize} onClick={doBury}>确认扣底</button>
    </>
  );
}

function PlayPanel({ seat, humanSeat, trick }: PanelProps & { trick: TrickCard[] }) {
  const hint = isHuman({ seat, humanSeat })
    ? trick.length === 0 ? '轮到你领出（任意出牌）' : '轮到你跟牌（同门优先）'
    : `等待 ${SEAT_NAMES[seat]} 出牌…`;
  return <span className="ctl-label">{hint}</span>;
}

function ResultPanel({
  result, matchEnded, goNextHand, restart,
}: { result: HandResult | null; matchEnded: boolean; goNextHand: () => void; restart: () => void }) {
  return (
    <>
      {result && (
        <>
          <b>
            庄家 {SEAT_NAMES[result.declarer]}（叫 {result.bid} 分，主 {SUIT_SYMBOL[result.trump]}）
            庄方吃 {result.declarerPoints} 分（含底牌 {result.buriedPoints}）
            → {result.success ? '成局' : '不成'}
          </b>
          <span>{result.winnerSide === 0 ? '东西方' : '南北方'} 胜本副</span>
        </>
      )}
      {matchEnded
        ? <button onClick={restart}>再来一场</button>
        : <button onClick={goNextHand}>下一副</button>}
      <button className="ghost" onClick={restart}>重新开局</button>
    </>
  );
}

interface ControlPanelProps extends PanelProps {
  phase: Phase;
  highestBid: number;
  bidOptions: number[];
  kittySize: number;
  selectedCount: number;
  trick: TrickCard[];
  result: HandResult | null;
  doBid: (b: number | null) => void;
  doTrump: (s: Suit) => void;
  doBury: () => void;
  goNextHand: () => void;
  restart: () => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const base = { seat: props.seat, humanSeat: props.humanSeat };
  let inner: ReactNode = null;
  switch (props.phase) {
    case 'bidding':
      inner = (
        <BiddingPanel {...base} highestBid={props.highestBid} bidOptions={props.bidOptions} doBid={props.doBid} />
      );
      break;
    case 'trump':
      inner = <TrumpPanel {...base} doTrump={props.doTrump} />;
      break;
    case 'bury':
      inner = (
        <BuryPanel
          {...base}
          kittySize={props.kittySize}
          selectedCount={props.selectedCount}
          doBury={props.doBury}
        />
      );
      break;
    case 'playing':
      inner = <PlayPanel {...base} trick={props.trick} />;
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
    <div className="controls">
      <div className={`ctl-group ${props.phase === 'handEnd' || props.phase === 'matchEnd' ? 'result-panel' : ''}`}>
        {inner}
      </div>
    </div>
  );
}
