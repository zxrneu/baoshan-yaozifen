/** 历史控制器（SRP / DIP）：共用 dev/server 的 HTTP 协议，完整私有状态只进入历史库。 */
import type { HistoryRepository, MatchStatus, MatchSource } from '../../src/history/contracts';
import { MATCH_STATUSES, MATCH_SOURCES } from '../../src/history/contracts';
import { decodeWrite, exportHand, type HandDetail } from '../../src/history/transport';
import { HistoryProtocolError } from '../../src/history/errors';
import type { ServerEngineRegistry } from '../engines/serverEngineRegistry';
import { resolveHistoryConfiguration } from './configuration';
import type { HttpLikeReq, HttpLikeRes } from '../apiHandler';

export function historyDetail(repo: HistoryRepository, handId: string): HandDetail {
  const hand = repo.getHand(handId);
  if (!hand) throw new HistoryProtocolError('历史副不存在');
  const match = repo.getMatch(hand.matchId);
  if (!match) throw new HistoryProtocolError('历史场不存在');
  const branches = repo.listBranches(handId);
  const nodes = branches.flatMap(branch => repo.listActionNodes(branch.branchId));
  const evaluations = [...branches.flatMap(branch => repo.listEvaluations(`root:${branch.branchId}`)), ...nodes.flatMap(node => repo.listEvaluations(node.nodeId))];
  const assignments = repo.listSeatAssignments(handId);
  const ids = new Set([...assignments.map(value => value.profileVersionId), ...evaluations.map(value => value.profileVersionId)].filter((value): value is string => !!value));
  const profiles = [...ids].map(id => { const profile = repo.getProfileVersion(id); if (!profile) throw new HistoryProtocolError('历史配置缺失'); return profile; });
  return { match, hand, branches, nodes, evaluations, profiles, assignments };
}
export async function handleHistory(req: HttpLikeReq, res: HttpLikeRes, repository: () => HistoryRepository | null, parseBody: (req: HttpLikeReq) => Promise<string>, registry?: ServerEngineRegistry): Promise<void> {
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    const body = req.method === 'POST' ? await parseBody(req) : '';
    const repo = repository();
    if (!repo) { send(503, { error: '历史存储已禁用，当前对局未保存' }); return; }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/history/write' && req.method === 'POST') {
      const packet=decodeWrite(JSON.parse(body));
      repo.writeHistory(registry ? resolveHistoryConfiguration(packet,registry) : packet); send(200, { saved: true }); return;
    }
    if (req.method !== 'GET') { send(405, { error: '历史接口不支持此方法' }); return; }
    if (url.pathname === '/api/history/matches') {
      const status = url.searchParams.get('status') || undefined; const source = url.searchParams.get('source') || undefined;
      if (status && !MATCH_STATUSES.includes(status as MatchStatus) || source && !MATCH_SOURCES.includes(source as MatchSource)) throw new HistoryProtocolError('历史筛选值非法');
      send(200, repo.listMatches({ status: status as MatchStatus | undefined, source: source as MatchSource | undefined, limit: Number(url.searchParams.get('limit') ?? 20), offset: Number(url.searchParams.get('offset') ?? 0),
        from: url.searchParams.has('from') ? Number(url.searchParams.get('from')) : undefined, to: url.searchParams.has('to') ? Number(url.searchParams.get('to')) : undefined,
        engineType: url.searchParams.get('engineType') || undefined, bid: url.searchParams.has('bid') ? Number(url.searchParams.get('bid')) : undefined })); return;
    }
    const hands = /^\/api\/history\/matches\/([^/]+)\/hands$/.exec(url.pathname);
    if (hands) {
      send(200,repo.listHands(decodeURIComponent(hands[1])).map(({ startSnapshot, ...summary }) => {
        const branch=repo.listBranches(summary.handId).find(value=>value.kind==='actual');
        const current=branch?.tipNodeId ? repo.getActionNode(branch.tipNodeId)!.state : startSnapshot;
        const assignments=repo.listSeatAssignments(summary.handId,branch?.branchId);
        const seatNames=[0,1,2,3].map(seat=>{const assigned=assignments.filter(value=>value.seat===seat).at(-1);return assigned?.kind==='human' ? '人工' : assigned?.profileVersionId ? repo.getProfileVersion(assigned.profileVersionId)?.name ?? '未采集' : '未采集';});
        return { ...summary, declarer:summary.declarer ?? current.declarer, bid:summary.bid ?? (current.highestBid || null), trump:summary.trump ?? current.trump, seatNames };
      }));return;
    }
    const detail = /^\/api\/history\/hands\/([^/]+)$/.exec(url.pathname);
    if (detail) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(exportHand(historyDetail(repo, decodeURIComponent(detail[1])))); return; }
    send(404, { error: '历史接口不存在' });
  } catch (error) {
    // 数据库路径、服务地址和原始请求不回传给浏览器。
    send(error instanceof HistoryProtocolError || error instanceof SyntaxError || error instanceof TypeError ? 400 : 503,
      { error: error instanceof HistoryProtocolError ? error.message : '历史存储请求失败，请重试' });
  }
}
