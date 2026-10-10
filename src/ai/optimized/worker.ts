/** Worker 入口是组合边界；跨线程只传观察，不传真实牌局或函数。 */
import { createOptimizedSelector } from './index';
import { SearchWorkerRequest, SearchWorkerResponse } from './workerProtocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<SearchWorkerRequest>) => void;
  postMessage(response: SearchWorkerResponse): void;
};
scope.onmessage = ({ data }) => {
  try {
    const selector = createOptimizedSelector({ budget: data.budget });
    scope.postMessage({ id: data.id, decision: selector.choose(data.observation) });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : '搜索失败' });
  }
};
