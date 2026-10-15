/** 历史复盘界面（SRP / DIP）：独立牌桌、只读时间线与节点诊断，活动局不参与渲染。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SEAT_NAMES, SIDE_NAMES, currentSeat, revealedPartnerSeat } from '@yaozifen/game-core';
import { cardId, cardLabel, SUIT_NAME } from '@yaozifen/game-core/cards';
import CardView from '../CardView';
import type { HandDetail } from '@yaozifen/history-core/transport';
import { evaluationsAt, PHASE_NAMES, replayObservation, replayPath, validatedReplay, type ReplayFrame } from '@yaozifen/history-core/replay';
import { commandValue } from '@yaozifen/protocol/commands';
import { isRecord } from '@yaozifen/protocol/errors';
import { actionLabel } from '@yaozifen/match-runtime/actions';
import TrickArea from './TrickArea';
import styles from './GameHistoryModal.module.css';
import HistoryBranchControls from './HistoryBranchControls';
import SimulationPanel from './SimulationPanel';
import type { HistoryClient } from '@yaozifen/history-core/client';

export default function HistoryReplay({ detail: input, client, onUpdated, initialBranchId }: { initialBranchId?:string; detail:HandDetail; client:HistoryClient; onUpdated:(detail:HandDetail)=>void }) {
  const replayRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLElement>(null);
  const [navigation, setNavigation] = useState(0);
  useEffect(() => {
    replayRef.current?.focus({ preventScroll:true });
    replayRef.current?.scrollIntoView({ block:'start' });
  }, []);
  useEffect(() => {
    if (!navigation) return;
    actionRef.current?.focus({ preventScroll:true });
    actionRef.current?.scrollIntoView({ block:'start' });
  }, [navigation]);
  const [detail, setDetail] = useState(() => validatedReplay(input));
  const [simulation,setSimulation]=useState(false);
  const [locked, setLocked] = useState(false);
  const [branchId, setBranchId] = useState(() => initialBranchId ?? detail.branches.find(branch => branch.kind === 'actual')!.branchId);
  const frames = useMemo(() => replayPath(detail, branchId), [detail, branchId]);
  const [index, setIndex] = useState(0); const [playing, setPlaying] = useState(false);
  const [seat, setSeat] = useState(1); const [allCards, setAllCards] = useState(false);
  const frame = frames[Math.min(index, frames.length - 1)]; const state = frame.state;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex(value => {
      if (value >= frames.length - 2) setPlaying(false);
      return Math.min(value + 1, frames.length - 1);
    }), 800);
    return () => clearInterval(timer);
  }, [playing, frames.length]);
  function jump(next: number) { setPlaying(false); setIndex(Math.max(0, Math.min(next, frames.length-1))); setNavigation(value=>value+1); }
  function frameLabel(item: ReplayFrame): string {
    if (!item.node) return '副牌起点';
    const command = item.node.command;
    if (command.kind === 'nextHand') return '下一副';
    // 扣底是私有动作；切换座位时，时间线也遵循相同的可见性规则。
    const label = command.kind === 'bury' && !allCards && command.seat !== seat
      ? `扣底 ${command.cards.length} 张` : actionLabel(command);
    return `${SEAT_NAMES[command.seat]} ${label}`;
  }
  const endIndex = frames.findIndex(item => !!item.state.result);
  const nextActor = currentSeat(state);
  const newRound = index > 0 && state.completedTricks.length > frames[index-1].state.completedTricks.length ? state.completedTricks.at(-1) : undefined;
  const declarerPoints = state.declarerTrickPoints + state.buriedPoints;
  const remainingPoints = state.result?.unplayedPoints ?? 100 - declarerPoints - state.defenderTrickPoints;
  const roundPositions = new Map(frames.flatMap((item, position) => {
    const round = position > 0 && item.state.completedTricks.length > frames[position-1].state.completedTricks.length ? item.state.completedTricks.at(-1) : undefined;
    return round ? [[round.trickNumber, position] as const] : [];
  }));
  const revealed = revealedPartnerSeat(state);
  const observation = replayObservation(state, seat);
  const evaluations = evaluationsAt(detail, frame, seat, branchId);
  const jumps = frames.flatMap((item, position) => position === 0 || item.state.phase !== frames[position-1].state.phase || item.state.trickNumber !== frames[position-1].state.trickNumber || item.node?.command.kind === 'nextHand' ? [{ position, label:`${position} · ${PHASE_NAMES[item.state.phase]}${item.state.phase === 'playing' ? ` 第 ${item.state.trickNumber} 轮` : ''}` }] : []);
  function recommendationLabel(value:unknown):string {
    try { const command=commandValue(isRecord(value) ? value.action : value); return command.kind==='nextHand' ? '下一副' : actionLabel(command); }
    catch { return '详见保存的建议'; }
  }
  function executionLabel(nodeId?:string|null):string {
    const node=detail.nodes.find(value=>value.nodeId===nodeId); return node ? node.command.kind==='nextHand' ? '下一副' : `${SEAT_NAMES[node.command.seat]} ${actionLabel(node.command)}` : '未采用';
  }
  function accept(next:HandDetail, branch:string) {
    setPlaying(false); setDetail(next); onUpdated(next); setBranchId(branch); setIndex(replayPath(next,branch).length-1); setNavigation(value=>value+1);
  }
  const comparison = detail.branches.map(branch => {
    const path=replayPath(detail,branch.branchId); const result=branch.kind==='actual' ? detail.hand.result : [...path].reverse().find(frame=>frame.node?.branchId===branch.branchId && frame.state.result)?.state.result; return { branch, result, source:branch.sourceNodeId ? (detail.nodes.find(node=>node.nodeId===branch.sourceNodeId)?.seq ?? null) : null };
  });
  return <section ref={replayRef} tabIndex={-1} className={styles.replay} aria-label="历史复盘">
    <h3>只读复盘 · 节点 {index} / {frames.length - 1}</h3>
    <p className={styles.context}>按时间线回看每个动作，点击每轮收分可回到该轮结束时。默认展示所选座位当时能看到的牌。</p>
    <div className={styles.player}>
    <div className={styles.filters}>
      <label>路径 <select aria-label="复盘路径" disabled={locked} value={branchId} onChange={event => { setBranchId(event.target.value); jump(0); }}>{detail.branches.map(branch => <option key={branch.branchId} value={branch.branchId}>{branch.name || (branch.kind === 'actual' ? '实际对局' : '分支')}</option>)}</select></label>
      <button className="ghost-btn" disabled={locked || index === 0} onClick={() => jump(index - 1)}>上一步</button>
      <button className="ghost-btn" disabled={locked || index === frames.length - 1} onClick={() => jump(index + 1)}>下一步</button>
      <button className="ghost-btn" disabled={locked || (index === frames.length - 1 && !playing)} onClick={() => setPlaying(value => !value)}>{playing ? '暂停播放' : '播放'}</button>
      <button className="ghost-btn" disabled={locked || index===0} onClick={() => jump(0)}>回到起点</button>
      <button className="ghost-btn" disabled={locked || index===(endIndex<0 ? frames.length-1 : endIndex)} onClick={() => jump(endIndex<0 ? frames.length-1 : endIndex)}>{endIndex<0 ? '最新记录' : '本副结算'}</button>
      <label>轮次/阶段 <select aria-label="复盘轮次跳转" disabled={locked} value="" onChange={event => jump(Number(event.target.value))}><option value="">跳转到…</option>{jumps.map(item => <option key={item.position} value={item.position}>{item.label}</option>)}</select></label>
    </div>
    <label className={styles.progress}>进度 {index} / {frames.length-1}<input type="range" min={0} max={frames.length-1} step={1} value={index} aria-label="复盘进度" disabled={locked || frames.length===1} onChange={event => jump(Number(event.target.value))}/></label>
    </div>
    <label>时间线 <select className={styles.timeline} aria-label="复盘时间线" disabled={locked} value={index} onChange={event => jump(Number(event.target.value))}>{frames.map((item, position) => <option key={position} value={position}>{position} · {frameLabel(item)} · {PHASE_NAMES[item.state.phase]}</option>)}</select></label>
    <div className={styles.boardOverview}><div>
    <section ref={actionRef} tabIndex={-1} className={styles.actionSummary} aria-label="复盘动作说明">
      <span>{PHASE_NAMES[state.phase]}{state.phase==='playing' ? newRound ? ` · 第 ${newRound.trickNumber} 轮结束` : ` · 第 ${state.trickNumber} 轮` : ''}{state.trump ? ` · 主牌 ${SUIT_NAME[state.trump]}` : ''}</span>
      <strong>当前动作：{frameLabel(frame)}</strong>
      {newRound && <p>{SEAT_NAMES[newRound.winner]}收走本轮 {newRound.points} 分 · 归{SIDE_NAMES[newRound.winner%2]}</p>}
      <p>{state.result ? `${SIDE_NAMES[state.result.winnerSide]}胜 · 本副已结算` : nextActor>=0 ? `接下来：${SEAT_NAMES[nextActor]}${PHASE_NAMES[state.phase]}` : '已到记录末端'}</p>
    </section>
    <section className={styles.scoreGrid} aria-label="复盘得分">
      {[{name:'庄方',points:declarerPoints,side:state.declarer===null ? null : state.declarer%2,target:state.highestBid}, {name:'闲方',points:state.defenderTrickPoints,side:state.declarer===null ? null : 1-state.declarer%2,target:105-state.highestBid}].map(item => <div key={item.name} className={styles.scoreCard}><span>{item.name}{item.side===null ? '' : ` · ${SIDE_NAMES[item.side]}`}</span><strong>{item.points} <small>分</small></strong><span>{item.side===null ? '锁定线待叫分确定' : `锁定线 ${item.target} 分 · ${item.points>=item.target ? '已锁定' : `还差 ${item.target-item.points} 分`}`}</span></div>)}
      <div className={styles.scoreCard}><span>牌中剩余分</span><strong>{remainingPoints} <small>分</small></strong><span>未打出 {remainingPoints} 分 · 底牌 {state.buriedPoints} 分</span></div>
    </section>
    </div>
    <div className={styles.replayTable}><TrickArea viewSeat={seat} trick={state.trick} lastTrick={state.lastTrick} lastWinner={state.lastWinner} lastPoints={state.lastPoints} kitty={state.kitty} phase={state.trick.length || state.lastTrick.length ? 'playing' : state.phase} prompt={PHASE_NAMES[state.phase]} compact standalone/></div>
    </div>
    <div className={styles.filters}><label>座位视角 <select aria-label="复盘座位视角" value={seat} onChange={event => setSeat(Number(event.target.value))}>{SEAT_NAMES.map((name, value) => <option key={name} value={value}>{name}</option>)}</select></label>
      <label><input type="checkbox" checked={allCards} onChange={event => setAllCards(event.target.checked)}/>全牌复盘</label><span className={styles.context}>{allCards ? '已显示四家手牌与底牌，仅影响复盘展示。' : '其他座位的暗牌保持背面。'}</span></div>
    <div className={styles.replayHands}>{state.hands.map((hand, owner) => <section key={owner} aria-label={`${SEAT_NAMES[owner]}家复盘手牌`}><strong>{SEAT_NAMES[owner]} · {hand.length} 张{revealed === owner ? ' · 明牌' : ''}</strong><div className={styles.cards}>{hand.map(card => <CardView key={cardId(card)} card={card} faceDown={!allCards && owner !== seat && owner !== revealed} size="mini"/>)}</div></section>)}</div>
    {(allCards || (state.declarer === seat && state.phase === 'playing')) && <p>底牌：{state.kitty.map(cardLabel).join(' ')}</p>}
    <section className={styles.rounds} aria-label="每轮收分"><h4>每轮收分 · 已完成 {state.completedTricks.length} 轮</h4>
      {!state.completedTricks.length && <p className={styles.context}>尚未完成一轮，继续向后查看出牌。</p>}
      <ol>{state.completedTricks.map(round => <li key={round.trickNumber}><button className="ghost-btn" disabled={locked} aria-current={roundPositions.get(round.trickNumber)===index ? 'step' : undefined} onClick={() => jump(roundPositions.get(round.trickNumber) ?? 0)}>第 {round.trickNumber} 轮 · {SEAT_NAMES[round.winner]}收 {round.points} 分</button><span>{round.cards.map(play => `${SEAT_NAMES[play.seat]} ${cardLabel(play.card)}`).join(' → ')}</span><small>归{SIDE_NAMES[round.winner%2]}</small></li>)}</ol>
    </section>
    <details className={styles.advanced}><summary>逐步动作记录（已发生 {index} 步）</summary><ol className={styles.actionList}>{frames.slice(1,index+1).map((item,position)=><li key={item.node!.nodeId}><button className="ghost-btn" disabled={locked} aria-current={position+1===index ? 'step' : undefined} onClick={()=>jump(position+1)}>{position+1} · {frameLabel(item)}</button></li>)}</ol></details>
    <details><summary>当时可见观察（{SEAT_NAMES[seat]}）</summary><pre aria-label="当时可见观察">{JSON.stringify(observation, null, 2)}</pre></details>
    <details className={styles.advanced}><summary>分支推演与独立续打</summary>
    <button className="ghost-btn" disabled={state.phase==='handEnd'||state.phase==='matchEnd'} onClick={()=>setSimulation(value=>!value)}>{simulation ? '收起独立续打' : '配置四座独立续打'}</button>
    {simulation&&<SimulationPanel key={frame.node?.nodeId ?? 'root'} client={client} source={{handId:detail.hand.handId,nodeId:frame.node?.nodeId ?? null}} onOpen={async(handId,branch)=>accept(await client.detail(handId),branch)}/>}
    <HistoryBranchControls detail={detail} nodeId={frame.node?.nodeId ?? null} branchId={branchId} state={state} client={client} onSaved={accept} onLock={value=>{setLocked(value);if(value)setPlaying(false);}}/>
    {detail.branches.length>1 && <section><h4>原局与分支比较</h4><div className={styles.comparison}><table><thead><tr><th>路径 / 起点</th><th>后续动作</th><th>结果</th></tr></thead><tbody>{comparison.map(({branch,result,source})=><tr key={branch.branchId}><td>{branch.name} · {source===null ? '副起点' : `节点 ${source+1}`}</td><td>{detail.nodes.filter(node=>node.branchId===branch.branchId).map(node=>frameLabel({node,state:node.state})).join(' → ') || '尚无动作'}</td><td>{result ? `${SIDE_NAMES[result.winnerSide]}胜 · 庄 ${result.declarerPoints} / 闲 ${result.defenderPoints}` : '未结束'}</td></tr>)}</tbody></table></div><p>单个分支结果用于复盘，不代表统计牌力。</p></section>}
    </details>
    <h4>当时的决策记录（{SEAT_NAMES[seat]}）</h4>
    {!evaluations.length && <p>未采集</p>}
    {evaluations.map(evaluation => <article className={styles.evaluation} key={evaluation.evaluationId}>
      <p>{evaluation.status === 'applied' ? '已采用评估' : evaluation.status === 'stale' ? '已失效 / 未采用评估' : '未采用评估'} · {evaluation.latencyMs} ms · {evaluation.engineType ?? '引擎未采集'} · {evaluation.modelName ?? '模型未采集'}</p>
      <p>建议：{recommendationLabel(evaluation.recommended)} · 实际动作：{executionLabel(evaluation.appliedNodeId)}</p>
      <p>配置：{detail.profiles.find(profile=>profile.profileVersionId===evaluation.profileVersionId)?.name ?? '未采集'} · 回退：{evaluation.fallbackReason ?? '未采集'} · 执行节点：{evaluation.appliedNodeId ?? '未采用'}</p>
      <details><summary>保存的观察、候选与建议</summary><pre>{JSON.stringify({ observation:evaluation.observation, candidates:evaluation.candidates, recommended:evaluation.recommended }, null, 2)}</pre></details>
    </article>)}
  </section>;
}
