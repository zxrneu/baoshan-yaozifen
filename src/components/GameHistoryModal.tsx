/** 对局历史界面（SRP / DIP）：只读列表与详情，恢复必须经完整校验后显式执行。 */
import Modal from './Modal';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { historyClient, type HistoryClient } from '../history/client';
import { exportHand, type HandDetail, type HandListItem } from '../history/transport';
import { MATCH_STATUSES, MATCH_SOURCES, type MatchRecord, type MatchStatus, type MatchSource } from '../history/contracts';
import { SEAT_NAMES, SIDE_NAMES } from '../engine';
import { SUIT_NAME } from '../cards';
import styles from './GameHistoryModal.module.css';
import HistoryReplay from './HistoryReplay';
import SimulationPanel from './SimulationPanel';
const statusNames: Record<MatchStatus,string> = { in_progress:'进行中', completed:'已完成', abandoned:'已中断', failed:'失败' };
const sourceNames: Record<MatchSource,string> = { human:'普通对局', ai:'AI 对局', bench:'工作台', simulation:'模拟', import:'导入' };
interface Props { onClose: () => void; onResume: (detail: HandDetail) => void | Promise<void>; client?: HistoryClient }
export default function GameHistoryModal({ onClose, onResume, client = historyClient }: Props) {
  const [simulating,setSimulating]=useState(false); const [replayBranch,setReplayBranch]=useState<string|undefined>();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [hands, setHands] = useState<HandListItem[] | null>(null);
  const [detail, setDetail] = useState<HandDetail | null>(null);
  const [view, setView] = useState<'matches' | 'hands' | 'detail'>('matches');
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);
  const [selectedHand, setSelectedHand] = useState<HandListItem | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);
  const positions = useRef({ matches:0, hands:0, detail:0 });
  const returnFocus = useRef<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [status, setStatus] = useState<MatchStatus | ''>(''); const [source, setSource] = useState<MatchSource | ''>('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [engineType, setEngineType] = useState(''); const [bid, setBid] = useState('');
  const [offset, setOffset] = useState(0); const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [exportText, setExportText] = useState('');
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = positions.current[view];
    const target = returnFocus.current
      ? [...(bodyRef.current?.querySelectorAll<HTMLButtonElement>('[data-history-id]') ?? [])].find(button => button.dataset.historyId === returnFocus.current)
      : null;
    (target ?? titleRef.current)?.focus({ preventScroll:true });
    returnFocus.current = null;
  }, [view, loading]);
  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setHands(null); setDetail(null); setReplaying(false); setView('matches');
    void client.matches({ limit:20, offset, status:status || undefined, source:source || undefined, from:from ? new Date(`${from}T00:00:00`).getTime() : undefined, to:to ? new Date(`${to}T23:59:59.999`).getTime() : undefined, engineType:engineType || undefined, bid:bid ? Number(bid) : undefined })
      .then(value => { if (id === requestId.current) setMatches(value); }).catch(() => { if (id === requestId.current) setError('历史加载失败，请重试'); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
    return () => { if (id === requestId.current) requestId.current++; };
  }, [client, status, source, from, to, engineType, bid, offset, refresh]);
  function enter(next: typeof view) {
    positions.current[view] = bodyRef.current?.scrollTop ?? 0;
    positions.current[next] = 0; setView(next); setNotice('');
  }
  function back(next: 'matches' | 'hands') {
    requestId.current++; setLoading(false); setError(''); setNotice(''); setReplaying(false);
    returnFocus.current = next === 'matches' ? selectedMatch?.matchId ?? null : selectedHand?.handId ?? null;
    setView(next);
  }
  async function openMatch(match: MatchRecord) {
    const id = ++requestId.current;
    enter('hands'); setSelectedMatch(match); setHands(null);
    setLoading(true); setError(''); setDetail(null); setReplaying(false); setExportText('');
    try { const value = await client.hands(match.matchId); if (id === requestId.current) setHands(value); }
    catch { if (id === requestId.current) setError('副牌列表加载失败，请重试'); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  async function openDetail(handId: string, branchId?:string) {
    const id = ++requestId.current;
    enter('detail'); setSelectedHand(hands?.find(hand => hand.handId === handId) ?? null); setDetail(null);
    setLoading(true); setError(''); setExportText(''); setReplaying(false);setReplayBranch(undefined);
    try {
      const value = await client.detail(handId);
      if (id === requestId.current) { setDetail(value); setSelectedHand(value.hand); setSelectedMatch(value.match); setReplayBranch(branchId); setReplaying(!!branchId); }
    } catch { if (id === requestId.current) setError('历史损坏、版本不支持或服务不可用，未修改当前对局'); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  function retry() {
    if (view === 'hands' && selectedMatch) void openMatch(selectedMatch);
    else if (view === 'detail' && selectedHand) void openDetail(selectedHand.handId);
    else setRefresh(value => value+1);
  }
  const actual=detail?.branches.find(branch=>branch.kind==='actual');
  const current=detail ? (actual?.tipNodeId ? detail.nodes.find(node=>node.nodeId===actual.tipNodeId)?.state : detail.hand.startSnapshot) : undefined;
  const declarer=detail?.hand.declarer ?? current?.declarer ?? null;
  const contract=detail?.hand.bid ?? current?.highestBid;
  const trump=detail?.hand.trump ?? current?.trump;
  function download() {
    if (!detail) return;
    const json = exportHand(detail); setExportText(json);
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([json], { type:'application/json' }));
    const link = document.createElement('a'); link.href=url; link.download=`对局历史-${detail.hand.handId}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <Modal label="对局历史" onClose={onClose} className={`modal-box ${styles.modal}`}>
    <div className={styles.heading}><h2>对局历史</h2><button className="ghost-btn" onClick={onClose}>关闭历史</button></div>
    {view !== 'matches' && <nav className={styles.navigation} aria-label="历史导航"><button className="ghost-btn" onClick={() => back(view === 'detail' && hands ? 'hands' : 'matches')}>{view === 'detail' && hands ? '返回副牌列表' : '返回对局列表'}</button><span>对局列表 / 副牌列表{view === 'detail' ? ' / 副牌详情' : ''}</span></nav>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.body} ref={bodyRef} aria-label="历史内容" aria-busy={loading}>
    <h3 ref={titleRef} tabIndex={-1} className={styles.pageTitle}>{view === 'matches' ? '对局列表' : view === 'hands' ? '副牌列表' : selectedHand ? `第 ${selectedHand.handIndex+1} 副详情` : '副牌详情'}</h3>
    {view !== 'matches' && selectedMatch && <p className={styles.context}>{new Date(selectedMatch.startedAt).toLocaleString('zh-CN')} · {sourceNames[selectedMatch.source]} · {statusNames[selectedMatch.status]}</p>}
    {view === 'matches' && <>
    <button className="ghost-btn" onClick={()=>setSimulating(value=>!value)}>{simulating ? '收起模拟对战' : '模拟对战'}</button>
    {simulating&&<SimulationPanel client={client} onOpen={openDetail}/>}
    <div className={styles.filters}>
      <label>状态 <select aria-label="历史状态筛选" value={status} onChange={event => { setStatus(event.target.value as MatchStatus | ''); setOffset(0); }}>{<option value="">全部状态</option>}{MATCH_STATUSES.map(value => <option key={value} value={value}>{statusNames[value]}</option>)}</select></label>
      <label>来源 <select aria-label="历史来源筛选" value={source} onChange={event => { setSource(event.target.value as MatchSource | ''); setOffset(0); }}><option value="">全部来源</option>{MATCH_SOURCES.map(value => <option key={value} value={value}>{sourceNames[value]}</option>)}</select></label>
      <label>起始日期 <input type="date" aria-label="历史起始日期" value={from} onChange={event=>{setFrom(event.target.value);setOffset(0);}}/></label>
      <label>结束日期 <input type="date" aria-label="历史结束日期" value={to} onChange={event=>{setTo(event.target.value);setOffset(0);}}/></label>
      <label>引擎 <select aria-label="历史引擎筛选" value={engineType} onChange={event=>{setEngineType(event.target.value);setOffset(0);}}><option value="">全部引擎</option>{['bridge','algorithm','llm','laya'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>叫分 <select aria-label="历史叫分筛选" value={bid} onChange={event=>{setBid(event.target.value);setOffset(0);}}><option value="">全部叫分</option>{[70,75,80,85,90,95,100].map(value=><option key={value}>{value}</option>)}</select></label>
      <button className="ghost-btn" onClick={() => setRefresh(value => value+1)}>刷新历史</button>
    </div>
    </>}
    {loading && <p role="status" className={styles.feedback}>{view === 'matches' ? '正在加载历史' : view === 'hands' ? '正在加载副牌' : '正在加载副牌详情'}…</p>}
    {error && <div className={styles.feedback}><p role="alert">{error}</p><button className="ghost-btn" disabled={loading} onClick={retry}>重试加载</button></div>}
    {view === 'matches' && <>
    {!loading && !matches.length && !error && <p className={styles.feedback}>还没有保存的对局。</p>}
    <ul className={styles.list}>{matches.map(match => <li key={match.matchId}><span>{new Date(match.startedAt).toLocaleString('zh-CN')}<small>{sourceNames[match.source]} · {statusNames[match.status]} · {match.handCount ?? 0} 副</small></span><button className="ghost-btn" data-history-id={match.matchId} disabled={loading} onClick={() => void openMatch(match)}>查看副牌</button></li>)}</ul>
    <div className={styles.filters}><button className="ghost-btn" disabled={loading || offset===0} onClick={() => setOffset(value => Math.max(0,value-20))}>上一页</button><span>第 {offset/20+1} 页</span><button className="ghost-btn" disabled={loading || matches.length<20} onClick={() => setOffset(value => value+20)}>下一页</button></div>
    </>}
    {view === 'hands' && hands && <><p className={styles.context}>共 {hands.length} 副，选择一副查看结果或逐步复盘。</p>{!hands.length && <p className={styles.feedback}>这场对局还没有保存的副牌。</p>}<ul className={styles.list}>{hands.map(hand => <li key={hand.handId}><span>第 {hand.handIndex+1} 副 · {hand.result ? `${SIDE_NAMES[hand.result.winnerSide]}胜` : '未结束'}{hand.bid ? ` · 叫 ${hand.bid} 分` : ''}{hand.declarer!==null ? ` · 庄 ${SEAT_NAMES[hand.declarer]}` : ''}{hand.trump ? ` · ${SUIT_NAME[hand.trump]}` : ''}{hand.seatNames && <small>{hand.seatNames.map((name,seat)=>`${SEAT_NAMES[seat]}：${name}`).join(' · ')}</small>}</span><button className="ghost-btn" data-history-id={hand.handId} disabled={loading} onClick={() => void openDetail(hand.handId)}>查看详情</button></li>)}</ul></>}
    {view === 'detail' && detail && <div className={styles.detail}>
      <p>已保存动作：{detail.nodes.length} · 评估：{detail.evaluations.length} · 路径：{detail.branches.length}</p>
      <p>{declarer === null ? (contract ? `当前叫分：${contract} 分` : '尚未叫分') : `庄家：${SEAT_NAMES[declarer]} · 叫 ${contract} 分`}{trump ? ` · 主牌：${SUIT_NAME[trump]}` : ''}</p>
      {detail.hand.result && <p>{SIDE_NAMES[detail.hand.result.winnerSide]}胜 · 庄方 {detail.hand.result.declarerPoints} 分 · 闲方 {detail.hand.result.defenderPoints} 分 · 未打出 {detail.hand.unplayedPoints ?? 0} 分</p>}
      <p>配置：{detail.profiles.map(profile => profile.name).join('、') || '未采集'}</p>
      <div className={styles.filters}><button className="primary-btn" aria-expanded={replaying} onClick={() => setReplaying(value => !value)}>{replaying ? '关闭复盘' : '开始复盘'}</button><button className="ghost-btn" onClick={download}>导出校验文件</button>
        <button className="ghost-btn" disabled={loading || detail.match.status!=='in_progress' || !!detail.hand.result} onClick={() => { setLoading(true); void Promise.resolve().then(() => onResume(detail)).then(() => { setNotice('已恢复，当前暂停'); setError(''); }).catch(cause => { setError(cause instanceof Error ? cause.message : '恢复失败，未修改当前对局'); }).finally(() => setLoading(false)); }}>恢复未结束副牌</button></div>
      {replaying && <HistoryReplay key={`${detail.hand.handId}:${replayBranch ?? "actual"}`} detail={detail} client={client} onUpdated={setDetail} initialBranchId={replayBranch}/>}
      {exportText && <label>校验导出内容<textarea readOnly aria-label="校验导出内容" value={exportText}/></label>}
    </div>}
    </div>
  </Modal>;
}
