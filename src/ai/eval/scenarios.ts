/**
 * 评估样本统一入口；按依赖倒置原则将 JSON 数据交给通用适配器。
 * 四阶段数组与完整套件保留既有导出，新增样本只需编辑数据文件。
 */
import biddingData from '../../../data/evaluation/bidding.json';
import trumpData from '../../../data/evaluation/trump.json';
import buryData from '../../../data/evaluation/bury.json';
import playingData from '../../../data/evaluation/playing.json';
import { loadScenarios } from './scenarioLoader';

export { loadScenarios } from './scenarioLoader';

// 合并后统一校验，避免不同阶段使用重复 ID。
export const ALL_BENCHMARK_SCENARIOS = loadScenarios([
  ...biddingData, ...trumpData, ...buryData, ...playingData,
]);
export const BIDDING_SCENARIOS = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'bidding');
export const TRUMP_SCENARIOS = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'trump');
export const BURY_SCENARIOS = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'bury');
export const PLAYING_SCENARIOS = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'playing');
