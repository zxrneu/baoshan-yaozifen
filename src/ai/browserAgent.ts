/** 浏览器组合根。非浏览器脚本可直接使用同步 optimizedAgent。 */
import { createAsyncOptimizedAgent } from './optimizedAgent';
import { WorkerCardSelector } from './optimized/workerClient';

export const browserOptimizedAgent = createAsyncOptimizedAgent(new WorkerCardSelector());
