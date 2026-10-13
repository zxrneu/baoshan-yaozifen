/** 模拟工作台（SRP / DIP）：独立四座配置、持久报告、取消续跑和逐副复盘。 */
import { useEffect, useState } from 'react';
import { requestProfiles } from '../ai/engines/profileClient';
import type { EngineProfile } from '../ai/engines/profiles';
import type { SimulationReport, SimulationRun, SimulationRequest } from '../history/simulation';
import type { HistoryClient } from '../history/client';
import { SEAT_NAMES } from '../engine';
import styles from './GameHistoryModal.module.css';
const failureNames: Record<string, string> = { timeout: '超时', cancelled: '取消', illegal: '非法动作', http: 'HTTP失败', parse: '解析/格式失败', network: '网络失败', execution: '执行/存储失败' };
const statusNames = { pending: '待运行', running: '运行中', completed: '完成', cancelled: '已取消 / 可续跑', failed: '失败 / 可续跑' };
interface Props {
    client: HistoryClient;
    source?: SimulationRequest['source'];
    onOpen: (handId: string, branchId: string) => void | Promise<void>;
}
export default function SimulationPanel({ client, source, onOpen }: Props) {
    const [profiles, setProfiles] = useState<EngineProfile[]>([]);
    const [seats, setSeats] = useState<string[]>(['', '', '', '']);
    const [runs, setRuns] = useState<SimulationRun[]>([]);
    const [report, setReport] = useState<SimulationReport | null>(null);
    const [seed, setSeed] = useState('20261013');
    const [count, setCount] = useState(1);
    const [concurrency, setConcurrency] = useState(1);
    const [decisionBudget, setDecisionBudget] = useState(10000);
    const [runBudget, setRunBudget] = useState(300000);
    const [maxActions, setMaxActions] = useState(512);
    const [maxRedeals, setMaxRedeals] = useState(3);
    const [mode, setMode] = useState<'lifecycle' | 'fixed'>('lifecycle');
    const [fixed, setFixed] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        void Promise.all([requestProfiles(), client.simulations()]).then(([values, saved]) => { if (disposed)
            return; setProfiles(values); setSeats(values.length ? Array(4).fill(values[0].version) : ['', '', '', '']); setFixed(values[0]?.version ?? ''); setRuns(saved); }).catch(() => { if (!disposed)
            setError('模拟配置或历史报告加载失败，请重试刷新'); });
        return () => { disposed = true; };
    }, [client]);
    useEffect(() => {
        if (report?.status !== 'running')
            return;
        let disposed = false;
        let pending = false;
        const timer = setInterval(() => { if (pending)
            return; pending = true; void client.simulation(report.runId).then(value => { if (!disposed) {
            setReport(value);
            setError('');
        } }).catch(() => { if (!disposed)
            setError('进度读取失败，已保存结果可刷新读取'); }).finally(() => { pending = false; }); }, 1500);
        return () => { disposed = true; clearInterval(timer); };
    }, [client, report?.runId, report?.status]);
    async function operate(action: () => Promise<void>) { setBusy(true); setError(''); try {
        await action();
    }
    catch (error) {
        setError(error instanceof Error ? error.message : '模拟请求失败');
    }
    finally {
        setBusy(false);
    } }
    const reference = (version: string) => { const profile = profiles.find(profile => profile.version === version); if (!profile)
        throw new Error('请选择有效的配置'); return { profileId: profile.profileId, version }; };
    const options = profiles.map(profile => <option key={profile.version} value={profile.version}>{profile.name}</option>);
    async function start() {
        const startSeed = Number(seed);
        if (!Number.isInteger(startSeed) || count < 1 || count > 1000)
            throw new Error('发牌种子与总组数无效');
        const request: SimulationRequest = { seeds: Array.from({ length: source ? 1 : count }, (_, index) => startSeed + index * 137), seats: seats.map(reference), mode: source ? 'lifecycle' : mode, ...(source ? { source } : {}), ...(mode === 'fixed' && !source ? { fixedProfile: reference(fixed) } : {}), decisionBudgetMs: decisionBudget, runBudgetMs: runBudget, concurrency: source ? 1 : concurrency, maxActions, maxRedeals };
        const result = await client.startSimulation(request);
        setReport(result);
        setRuns(await client.simulations());
    }
    const summary = report?.summary;
    const interval = summary?.interval;
    return <section className={styles.evaluation} aria-label={source ? '历史节点独立模拟' : '模拟对战工作台'}>
    <h3>{source ? '从当前节点独立续打' : '同种子换边模拟'}</h3>
    <p>{source ? '冻结四座配置，保留原路径，新结果保存为独立分支。' : '首局按四座配置运行，次局交换东西与南北；每个发牌组包含两副。'}</p>
    <div className={styles.filters}>{SEAT_NAMES.map((name, seat) => <label key={name}>{name}家 <select aria-label={`模拟${name}家配置`} disabled={busy} value={seats[seat]} onChange={event => setSeats(values => values.map((value, index) => index === seat ? event.target.value : value))}>{options}</select></label>)}</div>
    {!source && <div className={styles.filters}>
      <label>协议 <select aria-label="模拟协议" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="lifecycle">全生命周期</option><option value="fixed">固定前三阶段（仅比较出牌）</option></select></label>
      {mode === 'fixed' && <label>共同前三阶段 <select aria-label="共同前三阶段配置" value={fixed} onChange={event => setFixed(event.target.value)}>{options}</select></label>}
      <label>起始种子 <input aria-label="模拟起始种子" type="number" value={seed} onChange={event => setSeed(event.target.value)}/></label>
      <label>总组数 <input aria-label="模拟总组数" type="number" min={1} max={1000} value={count} onChange={event => setCount(Number(event.target.value))}/></label>
      <label>并发组数 <input aria-label="模拟并发" type="number" min={1} max={8} value={concurrency} onChange={event => setConcurrency(Number(event.target.value))}/></label>
    </div>}
    <div className={styles.filters}>
      <label>单步预算（毫秒） <input aria-label="模拟单步预算" type="number" min={1} max={3600000} value={decisionBudget} onChange={event => setDecisionBudget(Number(event.target.value))}/></label>
      <label>总预算（毫秒） <input aria-label="模拟总预算" type="number" min={1} max={3600000} value={runBudget} onChange={event => setRunBudget(Number(event.target.value))}/></label>
      <label>每副动作上限 <input aria-label="模拟动作上限" type="number" min={1} max={4096} value={maxActions} onChange={event => setMaxActions(Number(event.target.value))}/></label>
      <label>重发牌上限 <input aria-label="模拟重发上限" type="number" min={0} max={20} value={maxRedeals} onChange={event => setMaxRedeals(Number(event.target.value))}/></label>
    </div>
    <div className={styles.filters}>
      <button className="ghost-btn" disabled={busy || !profiles.length} onClick={() => void operate(start)}>{source ? '启动独立续打' : '开始换边批跑'}</button>
      <button className="ghost-btn" disabled={busy} onClick={() => void operate(async () => { setRuns(await client.simulations()); if (report)
        setReport(await client.simulation(report.runId)); })}>刷新模拟报告</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!!runs.length && <label>已保存运行 <select aria-label="模拟运行列表" value={report?.runId ?? ''} onChange={event => { if (event.target.value)
        void operate(async () => setReport(await client.simulation(event.target.value))); }}><option value="">选择运行…</option>{runs.map(run => <option key={run.runId} value={run.runId}>{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.request.source ? '历史续打' : run.request.mode === 'fixed' ? '固定前三阶段' : '全生命周期'} · {statusNames[run.status]}</option>)}</select></label>}
    {report && summary && interval && <section aria-label="模拟报告"><h4>{report.request.source ? '历史续打' : report.request.mode === 'fixed' ? '固定前三阶段报告' : '全生命周期报告'} · {statusNames[report.status]}</h4>
      <p>运行：{report.runId} · 已完成 {summary.completedGames} 副 · 预算已用 {Math.round(report.elapsedMs ?? 0)} 毫秒</p>
      <p>冻结配置：{report.request.seats.map((ref, seat) => `${SEAT_NAMES[seat]}：${report.profiles?.find(profile => profile.version === ref.version)?.name ?? ref.profileId}`).join(' · ')}</p>
      {!report.request.source && <p>A（首局东西）/ B（首局南北）实际赢副：{summary.aWins} / {summary.bWins} · A − B 赢副率差 {(interval.difference * 100).toFixed(1)} 个百分点 · 95% 组级区间 [{(interval.lower * 100).toFixed(1)}, {(interval.upper * 100).toFixed(1)}] · {interval.groups} 个完整组</p>}
      <p>{summary.note}</p>
      <p>实际回退 {summary.decisions.actualFallbacks} 次 · 原生非法 {summary.decisions.nativeIllegal} 次 · 无动作失败 {summary.decisions.noActionFailures} 次 · 决策耗时 P50 / P95：{summary.decisions.p50Ms ?? '未采集'} / {summary.decisions.p95Ms ?? '未采集'} 毫秒</p>
      <p>系统最终合法率：{typeof summary.decisions.systemFinalLegalRate === 'number' ? `${(summary.decisions.systemFinalLegalRate * 100).toFixed(1)}%` : '无完成决策'} · 原生模型合法率：{typeof summary.decisions.nativeModelLegalRate === 'number' ? `${(summary.decisions.nativeModelLegalRate * 100).toFixed(1)}%` : '无模型输出'}（网络、超时和取消不进入原生输出分母）</p>
      <p>来源：{Object.entries(summary.decisions.sources).map(([kind, count]) => `${({ model: '模型', heuristic: '启发式', search: '搜索', deterministic: '确定性' } as Record<string, string>)[kind]} ${count}`).join(' · ')} · 未打出分 {summary.unplayedPoints ?? 0}</p>
      <p>合同 / 成约：{Object.entries(summary.contracts).map(([bid, value]) => `${bid} 分：${value.success}/${value.count}`).join(' · ') || '尚无结算'} · 故障：{Object.entries(summary.faults).filter(([, count]) => count).map(([kind, count]) => `${failureNames[kind] ?? kind} ${count}`).join(' · ') || '无'}</p>
      {report.status === 'running' ? <button className="ghost-btn" disabled={busy} onClick={() => void operate(async () => setReport(await client.cancelSimulation(report.runId)))}>取消批跑</button> : report.status !== 'completed' && <button className="ghost-btn" disabled={busy} onClick={() => void operate(async () => setReport(await client.resumeSimulation(report.runId)))}>续跑未完成副牌</button>}
      <ul className={styles.list}>{report.boards.map(board => <li key={board.boardId}><div>第 {board.index + 1} 组 · 种子 {board.seed}
        {board.games.map((game, index) => <div key={game.branchId}>第 {index + 1} 局 · {statusNames[game.status]} · {game.actions} 动作 · 重发 {game.redeals} 次{game.result ? ` · ${game.result.winnerSide === 0 ? '东西' : '南北'}胜 · 合同 ${game.result.bid} · ${game.result.success ? '成约' : '未成约'}` : ''} <button className="ghost-btn" disabled={busy} onClick={() => void operate(async () => { await onOpen(game.handId, game.branchId); })}>打开第 {board.index + 1} 组第 {index + 1} 局复盘</button></div>)}
        {board.faults.map((fault, index) => <p key={index}>第 {fault.game + 1} 局 · {failureNames[fault.kind]}：{fault.message}</p>)}
      </div></li>)}</ul>
    </section>}
  </section>;
}
