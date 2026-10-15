import { sanitizePlayerObservation } from '@yaozifen/game-view/decisionObservation';
/** Worker 的生命周期适配器，与搜索算法及 React 无关。 */
import { cardId } from '@yaozifen/game-core/cards';
import {
  AsyncCardSelector, ObservationPolicy, OptimizedBudget, PlayerObservation, SearchDecision,
} from './contracts';
import { legalObservationCards } from '@yaozifen/game-view/observation';
import { observationPolicy } from './policy';
import { SearchWorkerPort } from './workerProtocol';

export interface WorkerSelectorOptions {
  readonly budget?: Partial<OptimizedBudget>;
  readonly timeoutMs?: number;
  readonly createWorker?: () => SearchWorkerPort;
  readonly fallback?: ObservationPolicy;
}

export class WorkerCardSelector implements AsyncCardSelector {
  private sequence = 0;
  private readonly options: WorkerSelectorOptions;

  constructor(options: WorkerSelectorOptions = {}) {
    this.options = options;
  }

  choose(observation: PlayerObservation, signal?: AbortSignal): Promise<SearchDecision> {
    if (signal?.aborted) return Promise.reject(new DOMException('已取消搜索', 'AbortError'));
    const legal = legalObservationCards(observation);
    if (!legal.length) return Promise.reject(new Error('没有合法出牌'));
    const fallbackCard = (this.options.fallback ?? observationPolicy).chooseCard(observation);
    const card = legal.find((c) => cardId(c) === cardId(fallbackCard)) ?? legal[0];
    const fallback = (diagnostic: string): SearchDecision => ({
      card, status: 'fallback', worlds: 0, moves: [], comparisons: [], elapsedMs: 0, diagnostic,
    });
    return new Promise<SearchDecision>((resolve, reject) => {
      let worker: SearchWorkerPort | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        }
      };
      const finish = (decision: SearchDecision): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(decision);
      };
      const abort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('已取消搜索', 'AbortError'));
      };
      try {
        worker = (this.options.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })))();
        const id = ++this.sequence;
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          if ('error' in data) return finish(fallback(data.error));
          if (!legal.some((candidate) => cardId(candidate) === cardId(data.decision.card))) {
            return finish(fallback('Worker 返回非法牌'));
          }
          finish(data.decision);
        };
        worker.onerror = (event) => { event.preventDefault(); finish(fallback('Worker 执行失败')); };
        worker.onmessageerror = () => finish(fallback('Worker 消息解析失败'));
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(fallback('Worker 响应超时')), this.options.timeoutMs ?? 1500);
        worker.postMessage({ id, observation: sanitizePlayerObservation(observation), budget: this.options.budget ?? {} });
      } catch (error) {
        finish(fallback(error instanceof Error ? error.message : '无法启动 Worker'));
      }
    });
  }
}
