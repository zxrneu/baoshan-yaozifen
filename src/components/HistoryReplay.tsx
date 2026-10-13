/** 历史复盘界面（SRP / DIP）：独立牌桌、只读时间线与节点诊断，活动局不参与渲染。 */
import { useEffect, useMemo, useState } from 'react';
import { SEAT_NAMES, SIDE_NAMES, revealedPartnerSeat } from '../engine';
import { cardId, cardLabel, SUIT_NAME } from '../cards';
import CardView from '../CardView';
import type { HandDetail } from '../history/transport';
import { evaluationsAt, PHASE_NAMES, replayObservation, replayPath, validatedReplay } from '../history/replay';
import { commandValue } from '../history/commands';
import { isRecord } from '../history/errors';
import { actionLabel } from '../workbench/actions';
import TrickArea from './TrickArea';
import styles from './GameHistoryModal.module.css';
import HistoryBranchControls from './HistoryBranchControls';
import SimulationPanel from './SimulationPanel';
import type { HistoryClient } from '../history/client';

export default function HistoryReplay({ detail: input, client, onUpdated, initialBranchId }: { initialBranchId?:string; detail:HandDetail; client:HistoryClient; onUpdated:(detail:HandDetail)=>void }) {
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
  function jump(next: number) { setPlaying(false); setIndex(next); }
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
    setPlaying(false); setDetail(next); onUpdated(next); setBranchId(branch); setIndex(replayPath(next,branch).length-1);
  }
  const comparison = detail.branches.map(branch => {
    const path=replayPath(detail,branch.branchId); const result=branch.kind==='actual' ? detail.hand.result : [...path].reverse().find(frame=>frame.node?.branchId===branch.branchId && frame.state.result)?.state.result; return { branch, result, source:branch.sourceNodeId ? (detail.nodes.find(node=>node.nodeId===branch.sourceNodeId)?.seq ?? null) : null };
  });
  return <section className={styles.replay} aria-label="历史复盘">
    <h3>只读复盘 · 节点 {index} / {frames.length - 1}</h3>
    <div className={styles.filters}>
      <label>路径 <select aria-label="复盘路径" disabled={locked} value={branchId} onChange={event => { setBranchId(event.target.value); jump(0); }}>{detail.branches.map(branch => <option key={branch.branchId} value={branch.branchId}>{branch.name || (branch.kind === 'actual' ? '实际对局' : '分支')}</option>)}</select></label>
      <button className="ghost-btn" disabled={locked || index === 0} onClick={() => jump(index - 1)}>上一步</button>
      <button className="ghost-btn" disabled={locked || index === frames.length - 1} onClick={() => jump(index + 1)}>下一步</button>
      <button className="ghost-btn" disabled={locked || (index === frames.length - 1 && !playing)} onClick={() => setPlaying(value => !value)}>{playing ? '暂停播放' : '播放'}</button>
      <label>轮次/阶段 <select aria-label="复盘轮次跳转" disabled={locked} value="" onChange={event => jump(Number(event.target.value))}><option value="">跳转到…</option>{jumps.map(item => <option key={item.position} value={item.position}>{item.label}</option>)}</select></label>
    </div>
    <label>时间线 <select className={styles.timeline} aria-label="复盘时间线" disabled={locked} value={index} onChange={event => jump(Number(event.target.value))}>{frames.map((item, position) => <option key={position} value={position}>{position} · {item.node ? item.node.command.kind === 'nextHand' ? '下一副' : `${SEAT_NAMES[item.node.command.seat]} ${actionLabel(item.node.command)}` : '副牌起点'} · {PHASE_NAMES[item.state.phase]}</option>)}</select></label>
    <p>当前阶段：{PHASE_NAMES[state.phase]} · 第 {state.trickNumber} 轮 · 庄方 {state.declarerTrickPoints + state.buriedPoints} 分 · 闲方 {state.defenderTrickPoints} 分{state.trump ? ` · 主牌 ${SUIT_NAME[state.trump]}` : ''}</p>
    <p>当前动作：{frame.node ? frame.node.command.kind === 'nextHand' ? '下一副' : `${SEAT_NAMES[frame.node.command.seat]} ${actionLabel(frame.node.command)}` : '副牌起点'}</p>
    {state.result && <p>{SIDE_NAMES[state.result.winnerSide]}胜 · 未打出 {state.result.unplayedPoints ?? 0} 分</p>}
    <div className={styles.replayTable}><TrickArea trick={state.trick} lastTrick={state.lastTrick} lastWinner={state.lastWinner} lastPoints={state.lastPoints} kitty={state.kitty} phase={state.trick.length || state.lastTrick.length ? 'playing' : state.phase} prompt={PHASE_NAMES[state.phase]} compact/></div>
    <div className={styles.filters}><label>座位视角 <select aria-label="复盘座位视角" value={seat} onChange={event => setSeat(Number(event.target.value))}>{SEAT_NAMES.map((name, value) => <option key={name} value={value}>{name}</option>)}</select></label>
      <label><input type="checkbox" checked={allCards} onChange={event => setAllCards(event.target.checked)}/>全牌复盘</label></div>
    <div className={styles.replayHands}>{state.hands.map((hand, owner) => <section key={owner} aria-label={`${SEAT_NAMES[owner]}家复盘手牌`}><strong>{SEAT_NAMES[owner]} · {hand.length} 张{revealed === owner ? ' · 明牌' : ''}</strong><div className={styles.cards}>{hand.map(card => <CardView key={cardId(card)} card={card} faceDown={!allCards && owner !== seat && owner !== revealed} size="mini"/>)}</div></section>)}</div>
    {(allCards || (state.declarer === seat && state.phase === 'playing')) && <p>底牌：{state.kitty.map(cardLabel).join(' ')}</p>}
    <details><summary>当时可见观察（{SEAT_NAMES[seat]}）</summary><pre aria-label="当时可见观察">{JSON.stringify(observation, null, 2)}</pre></details>
    <button className="ghost-btn" disabled={state.phase==='handEnd'||state.phase==='matchEnd'} onClick={()=>setSimulation(value=>!value)}>{simulation ? '收起独立续打' : '配置四座独立续打'}</button>
    {simulation&&<SimulationPanel key={frame.node?.nodeId ?? 'root'} client={client} source={{handId:detail.hand.handId,nodeId:frame.node?.nodeId ?? null}} onOpen={async(handId,branch)=>accept(await client.detail(handId),branch)}/>}
    <HistoryBranchControls detail={detail} nodeId={frame.node?.nodeId ?? null} branchId={branchId} state={state} client={client} onSaved={accept} onLock={value=>{setLocked(value);if(value)setPlaying(false);}}/>
    {detail.branches.length>1 && <section><h4>原局与分支比较</h4><div className={styles.comparison}><table><thead><tr><th>路径 / 起点</th><th>后续动作</th><th>结果</th></tr></thead><tbody>{comparison.map(({branch,result,source})=><tr key={branch.branchId}><td>{branch.name} · {source===null ? '副起点' : `节点 ${source+1}`}</td><td>{detail.nodes.filter(node=>node.branchId===branch.branchId).map(node=>node.command.kind==='nextHand' ? '下一副' : actionLabel(node.command)).join(' → ') || '尚无动作'}</td><td>{result ? `${SIDE_NAMES[result.winnerSide]}胜 · 庄 ${result.declarerPoints} / 闲 ${result.defenderPoints}` : '未结束'}</td></tr>)}</tbody></table></div><p>单个分支结果用于复盘，不代表统计牌力。</p></section>}
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
