/** 服务端决策与客户端降级回归测试，通过依赖注入隔离网络状态（DIP）。 */
import { observeBidding, observeTrump, observeBury } from '@yaozifen/game-view/decisionObservation';
import { describe, expect, it, vi } from 'vitest';
import { Card, makeCard, cardPoints } from '@yaozifen/game-core/cards';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import { ServerEngineRegistry } from '@yaozifen/server/engines/serverEngineRegistry';
import { DecisionService } from '@yaozifen/server/services/decisionService';
import { DecisionController } from '@yaozifen/server/controllers/decisionController';
import { DecisionRequest, DecisionResponse } from '@yaozifen/server/types';
import { RemoteDecisionEngine } from '@yaozifen/ai-core/engines/remoteEngine';
import { LayaEngine } from '@yaozifen/ai-core/engines/layaEngine';
import { createGame, bid, declareTrump, currentSeat } from '@yaozifen/game-core';

function makeObservation(hand: Card[]): PlayerObservation {
  return {
    seat: 0,
    ownHand: hand,
    handCounts: [hand.length, hand.length, hand.length, hand.length],
    declarer: 2,
    bid: 70,
    trump: 'D',
    leader: 2,
    roundNumber: 1,
    currentRound: [
      { seat: 2, card: makeCard('D', 'A') },
      { seat: 3, card: makeCard('D', 'J') },
    ],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 0,
    defenderPoints: 0,
    kittySize: 4,
    ruleId: 'basic-v1',
  };
}

describe('服务端全阶段决策服务 (DecisionService & Full Lifecycle Actions)', () => {
  const registry = new ServerEngineRegistry();
  const service = new DecisionService(registry);

  it('出牌阶段 (playing)：唯一候选牌 0ms 快速短路返回', async () => {
    const single = makeCard('D', 'K');
    const req: DecisionRequest = {
      seat: 0,
      phase: 'playing',
      engineType: 'bridge',
      candidates: [single],
      observation: makeObservation([single]),
    };

    const res = await service.processDecision(req);
    expect(res.success).toBe(true);
    expect(res.action.kind).toBe('play');
    if (res.action.kind === 'play') {
      expect(res.action.card).toEqual(single);
    }
    expect(res.decision?.diagnostic).toBe('唯一候选直接出牌');
  });

  it('出牌阶段 (playing)：多候选牌由 BridgeEngine 专家规则推演选出合法牌', async () => {
    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const req: DecisionRequest = {
      seat: 0,
      phase: 'playing',
      engineType: 'bridge',
      candidates,
      observation: makeObservation(candidates),
    };

    const res = await service.processDecision(req);
    expect(res.success).toBe(true);
    expect(res.action.kind).toBe('play');
    const playAction = res.action;
    if (playAction.kind === 'play') {
      expect(candidates.some((c) => c.rank === playAction.card.rank && c.suit === playAction.card.suit)).toBe(true);
    }
    expect(res.thinking).toBeDefined();
    expect(res.executionEnvironment).toBe('server');
  });

  it('叫分阶段 (bidding)：能够正确评估叫分意图并返回合法的 bid', async () => {
    const game = createGame(12345);
    const seat = currentSeat(game);

    const req: DecisionRequest = {
      seat,
      phase: 'bidding',
      engineType: 'bridge',
      observation: observeBidding(game, seat),
    };

    const res = await service.processDecision(req);
    expect(res.success).toBe(true);
    expect(res.action.kind).toBe('bid');
    if (res.action.kind === 'bid') {
      expect(res.action.bid === null || (typeof res.action.bid === 'number' && res.action.bid >= 70)).toBe(true);
    }
    expect(res.thinking).toContain('牌力');
  });

  it('定主阶段 (trump / declaring)：庄家能够选出合法的花色', async () => {
    let game = createGame(12345);
    const first = currentSeat(game);
    game = bid(game, first, 70);
    game = bid(game, (first + 1) % 4, null);
    game = bid(game, (first + 2) % 4, null);
    game = bid(game, (first + 3) % 4, null);

    const req: DecisionRequest = {
      seat: first,
      phase: 'trump',
      engineType: 'bridge',
      observation: observeTrump(game, first),
    };

    const res = await service.processDecision(req);
    expect(res.success).toBe(true);
    expect(res.action.kind).toBe('trump');
    if (res.action.kind === 'trump') {
      expect(['S', 'H', 'C', 'D']).toContain(res.action.trump);
    }
  });

  it('扣底阶段 (bury)：庄家扣出 4 张非分牌', async () => {
    let game = createGame(12345);
    const first = currentSeat(game);
    game = bid(game, first, 70);
    game = bid(game, (first + 1) % 4, null);
    game = bid(game, (first + 2) % 4, null);
    game = bid(game, (first + 3) % 4, null);
    game = declareTrump(game, first, 'H');

    const req: DecisionRequest = {
      seat: first,
      phase: 'bury',
      engineType: 'bridge',
      observation: observeBury(game, first),
    };

    const res = await service.processDecision(req);
    expect(res.success).toBe(true);
    expect(res.action.kind).toBe('bury');
    if (res.action.kind === 'bury') {
      expect(res.action.cards.length).toBe(game.kitty.length);
      // 分牌不可扣底验证
      for (const c of res.action.cards) {
        expect(cardPoints(c)).toBe(0);
      }
    }
  });

  it('容错降级：当请求 laya 且上游离线时，服务端同进程由 Bridge 接管，返回合法出牌并记录 fallbackReason', async () => {
    // 注入失败的 fetch 构造上游离线，避免依赖本机端口和 Ollaya 服务状态。
    const offlineFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('模拟上游网络不可达');
    });
    const offlineRegistry = new ServerEngineRegistry();
    offlineRegistry.register('laya', new LayaEngine({ fetchFn: offlineFetch }));
    const offlineService = new DecisionService(offlineRegistry);

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const req: DecisionRequest = {
      seat: 0,
      phase: 'playing',
      engineType: 'laya',
      candidates,
      observation: makeObservation(candidates),
    };

    const res = await offlineService.processDecision(req);
    expect(offlineFetch).toHaveBeenCalledOnce();
    expect(res.success).toBe(true);
    expect(res.engineType).toBe('bridge');
    expect(res.decision?.engineType).toBe('bridge');
    expect(res.action.kind).toBe('play');
    expect(res.fallbackReason).toBe('服务端自 laya 降级: 模拟上游网络不可达');
    // 降级必须仍返回合法牌，且落实在 decision 上供前端展示
    const action = res.action;
    if (action.kind === 'play') {
      expect(candidates.some((c) => c.suit === action.card.suit && c.rank === action.card.rank)).toBe(true);
    }
    expect(res.decision?.fallbackReason).toBe(res.fallbackReason);
  });
});

describe('服务端 HTTP 控制器 (DecisionController)', () => {
  const registry = new ServerEngineRegistry();
  const service = new DecisionService(registry);
  const controller = new DecisionController(service);

  it('非法参数缺失时返回 400', async () => {
    let statusCode = 0;
    let body = '';

    const req: any = { method: 'POST' };
    const res: any = {
      writeHead: (code: number) => { statusCode = code; },
      end: (data: string) => { body = data; },
    };

    await controller.handleDecision(req, res, JSON.stringify({ seat: 0 }));
    expect(statusCode).toBe(400);
    expect(body).toContain('缺失必要字段');
  });

  it('合法 POST 请求时返回 200 与决策数据', async () => {
    let statusCode = 0;
    let body = '';

    const req: any = { method: 'POST' };
    const res: any = {
      writeHead: (code: number) => { statusCode = code; },
      end: (data: string) => { body = data; },
    };

    const candidates = [makeCard('D', '2')];
    const payload: DecisionRequest = {
      seat: 0,
      phase: 'playing',
      engineType: 'bridge',
      candidates,
      observation: makeObservation(candidates),
    };

    await controller.handleDecision(req, res, JSON.stringify(payload));
    expect(statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.action.kind).toBe('play');
  });
});

describe('客户端 RemoteDecisionEngine 远程调用与保底', () => {
  it('服务端正常响应时正确解析出牌决策', async () => {
    const expectedCard = makeCard('D', 'A');
    const mockFetch: typeof fetch = async () => ({
      ok: true,
      json: async (): Promise<DecisionResponse> => ({
        success: true,
        action: { kind: 'play', seat: 0, card: expectedCard },
        decision: {
          card: expectedCard,
          engineType: 'laya',
          latencyMs: 120,
          conclusion: '远程模型选牌',
        },
        engineType: 'laya',
        latencyMs: 120,
        executionEnvironment: 'server',
      }),
    } as any);

    const remote = new RemoteDecisionEngine({
      targetEngineType: 'laya',
      fetchFn: mockFetch,
    });

    const candidates = [expectedCard, makeCard('D', '2')];
    const decision = await remote.chooseCard(makeObservation(candidates), candidates);
    expect(decision.card.rank).toBe('A');
    expect(decision.card.suit).toBe('D');
  });

  it('服务端网络不可达时，平滑降级为本地 BridgeEngine 保底', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:3001');
    };

    const remote = new RemoteDecisionEngine({
      targetEngineType: 'laya',
      fetchFn: mockFetch,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const decision = await remote.chooseCard(makeObservation(candidates), candidates);
    expect(decision).toBeDefined();
    expect(decision.fallbackReason).toContain('客户端从服务端 laya 回退');
  });

  it('统一 API 处理器 (createApiHandler)：能够被 Vite 开发中间件与独立代理服务共用', async () => {
    const { createApiHandler } = await import('@yaozifen/server/apiHandler');
    const api = createApiHandler();
    expect(api.config).toBeDefined();
    expect(api.handleApiRequest).toBeInstanceOf(Function);
    expect(api.createMiddleware).toBeInstanceOf(Function);
  });
});
