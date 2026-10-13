/** 模拟搜索随机源（DIP）：独立搜索 seed 重现暗牌采样，不读取发牌 seed。 */
import { expect, it } from 'vitest';
import { BridgePimcEvaluator } from '../src/ai/bridge/pimc';
import { seededSearchRandom } from '../src/ai/optimized/computation';
import { constrainedWorldFactory } from '../src/ai/optimized/belief';
import { historyPlayingState } from './fixtures/history';
import { observePlayer } from '../src/ai/optimized/observation';
import { currentSeat, legalMoves } from '../src/engine';
import type { HiddenWorld } from '../src/ai/optimized/contracts';
it('注入独立搜索随机源时重复采样一致，修改发牌seed不改变观察和采样', async () => {
    const state = historyPlayingState();
    async function sample(seed: number) {
        const worlds: HiddenWorld[] = [];
        const evaluator = new BridgePimcEvaluator({ config: { mode: 'deep', minWorlds: 1, maxWorlds: 1, timeLimitMs: 10000, endgameCardLimit: 0 }, random: () => seededSearchRandom(9876),
            worldsFactory: { create: (observation, guard) => { const source = constrainedWorldFactory.create(observation, guard); return { sample: (random, check) => { const world = source.sample(random, check); worlds.push(world); return world; } }; } } });
        const game = { ...state, seed };
        await evaluator.evaluate(observePlayer(game, currentSeat(game)), legalMoves(game, currentSeat(game)));
        expect(worlds).toHaveLength(1);
        return worlds;
    }
    expect(await sample(731)).toEqual(await sample(99999));
});
