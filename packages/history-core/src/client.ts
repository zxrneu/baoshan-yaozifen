/** 历史 HTTP 客户端（DIP）：确认成功响应后报告已保存，读取先做快照和路径校验。 */
import { encodeWrite, readHandDetail, type HistoryWrite, type HandListItem } from './transport';
import type { MatchRecord, MatchQuery } from '@yaozifen/protocol/contracts';
export class HistoryClient {
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}
  private async request(path: string, init?: RequestInit) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(`/api/history/${path}`, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error('历史服务请求失败');
      return await response.text();
    } finally { clearTimeout(timer); }
  }
  async simulations(): Promise<import('./simulation').SimulationRun[]> { return JSON.parse(await this.request('simulations')); }
  async simulation(runId: string): Promise<import('./simulation').SimulationReport> { return JSON.parse(await this.request(`simulations/${encodeURIComponent(runId)}`)); }
  async startSimulation(input: import('./simulation').SimulationRequest): Promise<import('./simulation').SimulationReport> { return JSON.parse(await this.request('simulations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})); }
  async cancelSimulation(runId: string): Promise<import('./simulation').SimulationReport> { return JSON.parse(await this.request(`simulations/${encodeURIComponent(runId)}/cancel`, {method:'POST'})); }
  async resumeSimulation(runId: string): Promise<import('./simulation').SimulationReport> { return JSON.parse(await this.request(`simulations/${encodeURIComponent(runId)}/resume`, {method:'POST'})); }
  async write(packet: HistoryWrite) {
    const response: unknown = JSON.parse(await this.request('write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeWrite(packet) }));
    if (!response || typeof response !== 'object' || !('saved' in response) || response.saved !== true) throw new Error('历史服务未确认保存');
  }
  async matches(query: MatchQuery = {}): Promise<MatchRecord[]> {
    const params = new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]));
    return JSON.parse(await this.request(`matches?${params}`));
  }
  async hands(matchId: string): Promise<HandListItem[]> { return JSON.parse(await this.request(`matches/${encodeURIComponent(matchId)}/hands`)); }
  async detail(handId: string) { return readHandDetail(await this.request(`hands/${encodeURIComponent(handId)}`)); }
}
export const historyClient = new HistoryClient();
