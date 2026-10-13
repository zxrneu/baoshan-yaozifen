/** 对局历史界面（SRP / DIP）：只读列表与详情，恢复必须经完整校验后显式执行。 */
import { useEffect, useState } from 'react';
import { historyClient, type HistoryClient } from '../history/client';
import { exportHand, type HandDetail, type HandListItem } from '../history/transport';
import { MATCH_STATUSES, MATCH_SOURCES, type MatchRecord, type MatchStatus, type MatchSource } from '../history/contracts';
import { SEAT_NAMES, SIDE_NAMES } from '../engine';
import { SUIT_NAME } from '../cards';
import styles from './GameHistoryModal.module.css';
import HistoryReplay from './HistoryReplay';
const statusNames: Record<MatchStatus,string> = { in_progress:'进行中', completed:'已完成', abandoned:'已中断', failed:'失败' };
const sourceNames: Record<MatchSource,string> = { human:'普通对局', ai:'AI 对局', bench:'工作台', simulation:'模拟', import:'导入' };
interface Props { onClose: () => void; onResume: (detail: HandDetail) => void | Promise<void>; client?: HistoryClient }
export default function GameHistoryModal({ onClose, onResume, client = historyClient }: Props) {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [hands, setHands] = useState<HandListItem[] | null>(null);
  const [detail, setDetail] = useState<HandDetail | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [status, setStatus] = useState<MatchStatus | ''>(''); const [source, setSource] = useState<MatchSource | ''>('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [engineType, setEngineType] = useState(''); const [bid, setBid] = useState('');
  const [offset, setOffset] = useState(0); const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [exportText, setExportText] = useState('');
  useEffect(() => {
    let disposed = false; setLoading(true); setError(''); setHands(null); setDetail(null); setReplaying(false);
    void client.matches({ limit:20, offset, status:status || undefined, source:source || undefined, from:from ? new Date(`${from}T00:00:00`).getTime() : undefined, to:to ? new Date(`${to}T23:59:59.999`).getTime() : undefined, engineType:engineType || undefined, bid:bid ? Number(bid) : undefined })
      .then(value => { if (!disposed) setMatches(value); }).catch(() => { if (!disposed) setError('历史加载失败，请重试'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [client, status, source, from, to, engineType, bid, offset, refresh]);
  async function openMatch(matchId: string) {
    setLoading(true); setError(''); setDetail(null); setReplaying(false); setExportText('');
    try { setHands(await client.hands(matchId)); } catch { setError('副牌列表加载失败，请重试'); } finally { setLoading(false); }
  }
  async function openDetail(handId: string) {
    setLoading(true); setError(''); setExportText(''); setReplaying(false);
    try { setDetail(await client.detail(handId)); } catch { setError('历史损坏、版本不支持或服务不可用，未修改当前对局'); } finally { setLoading(false); }
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
  return <div className="modal-backdrop"><section className={`modal-box ${styles.modal}`} role="dialog" aria-modal="true" aria-label="对局历史">
    <div className={styles.heading}><h2>对局历史</h2><button className="ghost-btn" onClick={onClose}>关闭历史</button></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.body}>
    <div className={styles.filters}>
      <label>状态 <select aria-label="历史状态筛选" value={status} onChange={event => { setStatus(event.target.value as MatchStatus | ''); setOffset(0); }}>{<option value="">全部状态</option>}{MATCH_STATUSES.map(value => <option key={value} value={value}>{statusNames[value]}</option>)}</select></label>
      <label>来源 <select aria-label="历史来源筛选" value={source} onChange={event => { setSource(event.target.value as MatchSource | ''); setOffset(0); }}><option value="">全部来源</option>{MATCH_SOURCES.map(value => <option key={value} value={value}>{sourceNames[value]}</option>)}</select></label>
      <label>起始日期 <input type="date" aria-label="历史起始日期" value={from} onChange={event=>{setFrom(event.target.value);setOffset(0);}}/></label>
      <label>结束日期 <input type="date" aria-label="历史结束日期" value={to} onChange={event=>{setTo(event.target.value);setOffset(0);}}/></label>
      <label>引擎 <select aria-label="历史引擎筛选" value={engineType} onChange={event=>{setEngineType(event.target.value);setOffset(0);}}><option value="">全部引擎</option>{['bridge','algorithm','llm','laya'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>叫分 <select aria-label="历史叫分筛选" value={bid} onChange={event=>{setBid(event.target.value);setOffset(0);}}><option value="">全部叫分</option>{[70,75,80,85,90,95,100].map(value=><option key={value}>{value}</option>)}</select></label>
      <button className="ghost-btn" onClick={() => setRefresh(value => value+1)}>刷新历史</button>
    </div>
    {loading && <p role="status">正在加载历史…</p>}{error && <p role="alert">{error}</p>}
    {!loading && !matches.length && !error && <p>还没有保存的对局。</p>}
    <ul className={styles.list}>{matches.map(match => <li key={match.matchId}><span>{new Date(match.startedAt).toLocaleString('zh-CN')} · {sourceNames[match.source]} · {statusNames[match.status]} · {match.handCount ?? 0} 副</span><button className="ghost-btn" disabled={loading} onClick={() => void openMatch(match.matchId)}>查看副牌</button></li>)}</ul>
    <div className={styles.filters}><button className="ghost-btn" disabled={loading || offset===0} onClick={() => setOffset(value => Math.max(0,value-20))}>上一页</button><span>第 {offset/20+1} 页</span><button className="ghost-btn" disabled={loading || matches.length<20} onClick={() => setOffset(value => value+20)}>下一页</button></div>
    {hands && <div><h3>副牌列表</h3><ul className={styles.list}>{hands.map(hand => <li key={hand.handId}><span>第 {hand.handIndex+1} 副 · {hand.result ? `${SIDE_NAMES[hand.result.winnerSide]}胜` : '未结束'}{hand.bid ? ` · 叫 ${hand.bid} 分` : ''}{hand.declarer!==null ? ` · 庄 ${SEAT_NAMES[hand.declarer]}` : ''}{hand.trump ? ` · ${SUIT_NAME[hand.trump]}` : ''}{hand.seatNames && <small>{hand.seatNames.map((name,seat)=>`${SEAT_NAMES[seat]}：${name}`).join(' · ')}</small>}</span><button className="ghost-btn" disabled={loading} onClick={() => void openDetail(hand.handId)}>查看详情</button></li>)}</ul></div>}
    {detail && <div className={styles.detail}><h3>第 {detail.hand.handIndex+1} 副详情</h3>
      <p>已保存动作：{detail.nodes.length} · 评估：{detail.evaluations.length} · 路径：{detail.branches.length}</p>
      <p>{declarer === null ? (contract ? `当前叫分：${contract} 分` : '尚未叫分') : `庄家：${SEAT_NAMES[declarer]} · 叫 ${contract} 分`}{trump ? ` · 主牌：${SUIT_NAME[trump]}` : ''}</p>
      {detail.hand.result && <p>{SIDE_NAMES[detail.hand.result.winnerSide]}胜 · 庄方 {detail.hand.result.declarerPoints} 分 · 闲方 {detail.hand.result.defenderPoints} 分 · 未打出 {detail.hand.unplayedPoints ?? 0} 分</p>}
      <p>配置：{detail.profiles.map(profile => profile.name).join('、') || '未采集'}</p>
      <div className={styles.filters}><button className="ghost-btn" onClick={() => setReplaying(value => !value)}>{replaying ? '关闭复盘' : '开始复盘'}</button><button className="ghost-btn" onClick={download}>导出校验文件</button>
        <button className="ghost-btn" disabled={loading || detail.match.status!=='in_progress' || !!detail.hand.result} onClick={() => { setLoading(true); void Promise.resolve().then(() => onResume(detail)).then(() => { setNotice('已恢复，当前暂停'); setError(''); }).catch(cause => { setError(cause instanceof Error ? cause.message : '恢复失败，未修改当前对局'); }).finally(() => setLoading(false)); }}>恢复未结束副牌</button></div>
      {replaying && <HistoryReplay key={detail.hand.handId} detail={detail} client={client} onUpdated={setDetail}/>}
      {exportText && <label>校验导出内容<textarea readOnly aria-label="校验导出内容" value={exportText}/></label>}
    </div>}
    </div>
  </section></div>;
}
