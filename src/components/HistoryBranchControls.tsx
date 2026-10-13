/** 反事实操作界面（SRP）：独立引擎与提交会话，保存失败可重试，切换位置取消旧模拟。 */
import { useEffect, useRef, useState } from 'react';
import { currentSeat, legalBids, legalMoves, SEAT_NAMES, type GameState } from '../engine';
import { cardId, cardLabel, cardPoints, SUITS, SUIT_NAME, type Suit } from '../cards';
import { DecisionEngineManager, defaultEngineManager, type EngineType } from '../ai/engines';
import { HistoryBranch } from '../history/branch';
import { captureConfiguration } from '../history/capture';
import type { HandDetail } from '../history/transport';
import type { HistoryClient } from '../history/client';
import type { SessionCommand } from '../workbench/session';
import styles from './GameHistoryModal.module.css';
interface Props { detail:HandDetail; nodeId:string|null; branchId:string; state:GameState; client:HistoryClient; onSaved:(detail:HandDetail,branchId:string)=>void; onLock:(locked:boolean)=>void }
export default function HistoryBranchControls({ detail, nodeId, branchId, state, client, onSaved, onLock }: Props) {
  const [manager] = useState(() => new DecisionEngineManager({ defaultType:'bridge', useServerDecision:defaultEngineManager.isUseServerDecision(), llmOptions:defaultEngineManager.getLlmOptions(), layaOptions:defaultEngineManager.getLayaOptions() }));
  const workspace = useRef<HistoryBranch | null>(null); const generation=useRef(0); const mounted=useRef(true);
  const [enabled,setEnabled]=useState(false); const [name,setName]=useState(''); const [engineType,setEngineType]=useState<EngineType>('bridge');
  const [bid,setBid]=useState(''); const [trump,setTrump]=useState<Suit>('S'); const [cards,setCards]=useState<string[]>([]);
  const [busy,setBusy]=useState(false); const [writing,setWriting]=useState(false); const [failed,setFailed]=useState(false); const [message,setMessage]=useState(''); const [pendingText,setPendingText]=useState('');
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; generation.current++; workspace.current?.cancel(); }; }, []);
  useEffect(() => {
    const work=workspace.current;
    if (work && (work.getNodeId() !== nodeId || (work.getBranchId() !== branchId))) {
      generation.current++; work.cancel(); workspace.current=null; setEnabled(false); setBusy(false); setFailed(false); setMessage('');
    }
    setCards([]); setBid('');
  }, [nodeId,branchId]);
  const seat=currentSeat(state); const hand=seat<0 ? [] : state.hands[seat];
  function create() {
    workspace.current?.cancel(); generation.current++;
    workspace.current=new HistoryBranch(detail,nodeId,{ write:async packet=>{
      if(mounted.current) { setWriting(true); onLock(true); }
      try { await client.write(packet); }
      finally { if(mounted.current) { setWriting(false); onLock(false); } }
    }, reload:()=>client.detail(detail.hand.handId), configuration:captureConfiguration(manager,true), name:name.trim() || `反事实分支 ${detail.branches.length}` });
    setEnabled(true); setFailed(false); setMessage('新分支将在首个合法动作保存后出现');
  }
  function changeEngine(value:EngineType) {
    generation.current++; workspace.current?.cancel(); manager.setActiveType(value); setEngineType(value); setBusy(false);
    workspace.current?.configurationChanged(captureConfiguration(manager,true)); setMessage('后续模拟使用当前默认配置');
  }
  async function operate(action:(work:HistoryBranch)=>Promise<unknown>, simulate=false) {
    const work=workspace.current; if(!work) return;
    const token=generation.current; setBusy(true); setMessage(simulate ? '正在模拟…' : '正在保存分支…');
    if(!simulate) onLock(true);
    try {
      await action(work);
      if(mounted.current && token===generation.current) {
        setFailed(false); setPendingText(''); setMessage('分支已保存');
        onSaved(work.getDetail(),work.getBranchId());
      }
    } catch {
      if(mounted.current && token===generation.current) { setFailed(work.hasPendingSave() || work.hasUnsyncedDetail()); setMessage(work.hasUnsyncedDetail() ? '分支已保存，但详情同步失败，请重试同步' : work.hasPendingSave() ? '分支未确认保存，请重试或导出待保存分支' : '分支操作失败，请重试'); }
    } finally {
      if(mounted.current && token===generation.current) { setBusy(false); onLock(work.hasPendingSave() || work.hasUnsyncedDetail()); }
    }
  }
  function manualCommand():SessionCommand {
    switch(state.phase) {
      case 'bidding': return {kind:'bid',seat,bid:bid ? Number(bid) : null};
      case 'trump': return {kind:'trump',seat,trump};
      case 'bury': return {kind:'bury',seat,cards:hand.filter(card=>cards.includes(cardId(card)))};
      case 'playing': {const card=legalMoves(state,seat).find(value=>cardId(value)===cards[0]);if(!card)throw new Error('请选择合法牌');return {kind:'play',seat,card};}
      case 'handEnd': return {kind:'nextHand'};
      default: throw new Error('整场已结束');
    }
  }
  async function simulate(work:HistoryBranch, continuous:boolean) {
    const engine=manager.isUseServerDecision() ? manager.getRemoteEngine() : manager.getEngine(engineType);
    const token=generation.current;
    for(let count=0; count<512; count++) {
      if(token!==generation.current || currentSeat(work.getState())<0) return;
      if(!await work.step(engine)) return;
      if(mounted.current && token===generation.current) onSaved(work.getDetail(),work.getBranchId());
      if(!continuous) return;
    }
    throw new Error('模拟动作数超出上限');
  }
  return <section className={styles.evaluation} aria-label="反事实分支操作"><h4>从当前节点建立分支</h4>
    <div className={styles.filters}><label>分支名称 <input aria-label="分支名称" value={name} disabled={busy || failed} onChange={event=>setName(event.target.value)}/></label><button className="ghost-btn" disabled={busy || failed || state.phase==='matchEnd'} onClick={create}>新建分支</button></div>
    {enabled && <><p>操作座位：{seat<0 ? '结算' : SEAT_NAMES[seat]} · 原路径保留</p>
      <div className={styles.filters}><label>后续模拟配置 <select aria-label="分支模拟引擎" value={engineType} disabled={failed || writing} onChange={event=>changeEngine(event.target.value as EngineType)}>{(['bridge','algorithm','llm','laya'] as const).map(type=><option key={type} value={type}>默认 {type}</option>)}</select></label></div>
      {state.phase==='bidding' && <label>换叫分 <select aria-label="分支叫分" value={bid} disabled={busy || failed} onChange={event=>setBid(event.target.value)}><option value="">不叫</option>{legalBids(state).map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
      {state.phase==='trump' && <label>换主牌 <select aria-label="分支主牌" value={trump} disabled={busy || failed} onChange={event=>setTrump(event.target.value as Suit)}>{SUITS.map(value=><option key={value} value={value}>{SUIT_NAME[value]}</option>)}</select></label>}
      {state.phase==='bury' && <div className={styles.filters} aria-label="分支扣底选牌">{hand.filter(card=>cardPoints(card)===0).map(card=><label key={cardId(card)}><input type="checkbox" disabled={busy || failed} checked={cards.includes(cardId(card))} onChange={event=>setCards(value=>event.target.checked ? [...value,cardId(card)] : value.filter(id=>id!==cardId(card)))}/>{cardLabel(card)}</label>)}</div>}
      {state.phase==='playing' && <label>换出牌 <select aria-label="分支出牌" value={cards[0] ?? ''} disabled={busy || failed} onChange={event=>setCards([event.target.value])}><option value="">选择合法牌</option>{legalMoves(state,seat).map(card=><option key={cardId(card)} value={cardId(card)}>{cardLabel(card)}</option>)}</select></label>}
      <div className={styles.filters}>
        <button className="ghost-btn" disabled={busy || failed || state.phase==='matchEnd' || (state.phase==='bury' && cards.length!==state.rules.kittySize) || (state.phase==='playing' && !cards[0])} onClick={()=>void operate(work=>work.apply(manualCommand()))}>提交分支动作</button>
        <button className="ghost-btn" disabled={busy || failed || seat<0} onClick={()=>void operate(work=>simulate(work,false),true)}>模拟一步</button>
        <button className="ghost-btn" disabled={busy || failed || seat<0} onClick={()=>void operate(work=>simulate(work,true),true)}>继续模拟本副</button>
        {busy && <button className="ghost-btn" disabled={writing} onClick={()=>{generation.current++;workspace.current?.cancel();setBusy(false);setMessage('已取消模拟');onLock(workspace.current?.hasPendingSave() ?? false);}}>取消模拟</button>}
        {failed && <><button className="ghost-btn" onClick={()=>void operate(work=>work.retry())}>{workspace.current?.hasUnsyncedDetail() ? '重试同步详情' : '重试保存分支'}</button>{workspace.current?.hasPendingSave() && <button className="ghost-btn" onClick={()=>setPendingText(workspace.current?.exportPending() ?? '')}>导出待保存分支</button>}</>}
      </div></>}
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    {pendingText && <textarea aria-label="待保存分支" readOnly value={pendingText}/>}
  </section>;
}
