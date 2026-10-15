/**
 * 独立保留集 (Holdout Test Set) 统一入口。
 * 遵循 SRP 与开闭原则，为引擎评测提供严格独立的外部保留检验集，
 * 绝不用于开发日常调优，从源头杜绝过拟合。
 */
import holdoutBidding from '../../../data/evaluation/holdout/bidding.json';
import holdoutTrump from '../../../data/evaluation/holdout/trump.json';
import holdoutBury from '../../../data/evaluation/holdout/bury.json';
import holdoutPlaying from '../../../data/evaluation/holdout/playing.json';
import { loadScenarios } from './scenarioLoader';

export const ALL_HOLDOUT_SCENARIOS = loadScenarios([
  ...holdoutBidding,
  ...holdoutTrump,
  ...holdoutBury,
  ...holdoutPlaying,
]);

export const HOLDOUT_BIDDING_SCENARIOS = ALL_HOLDOUT_SCENARIOS.filter((s) => s.phase === 'bidding');
export const HOLDOUT_TRUMP_SCENARIOS = ALL_HOLDOUT_SCENARIOS.filter((s) => s.phase === 'trump');
export const HOLDOUT_BURY_SCENARIOS = ALL_HOLDOUT_SCENARIOS.filter((s) => s.phase === 'bury');
export const HOLDOUT_PLAYING_SCENARIOS = ALL_HOLDOUT_SCENARIOS.filter((s) => s.phase === 'playing');
