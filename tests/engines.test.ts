import { describe, expect, it, vi } from 'vitest';
import { Card, cardId, makeCard } from '../src/cards';
import { PlayerObservation } from '../src/ai/optimized/contracts';
import { LayaEngine } from '../src/ai/engines/layaEngine';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { AlgorithmEngine } from '../src/ai/engines/algorithmEngine';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { DecisionEngineManager } from '../src/ai/engines';
import { EngineSettings, applySettingsToManager } from '../src/ai/engines/engineSettings';
import { createGame, bid, declareTrump, bury, GameState, currentSeat } from '../src/engine';
import { smartBury } from '../src/ai';

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

function playingGame(seed = 101): GameState {
  let state = createGame(seed, { targetWins: 1 });
  const first = currentSeat(state);
  for (let i = 0; i < 4; i++) {
    state = bid(state, currentSeat(state), currentSeat(state) === first ? 70 : null);
  }
  state = declareTrump(state, first, 'D');
  return bury(state, first, smartBury(state, first));
}

describe('决策引擎接口与协议适配 (Decision Engines & Protocols)', () => {
  it('LLM Chat Completions 协议：正确发送 messages 与 response_format 并解析 JSON', async () => {
    let capturedUrl = '';
    let capturedBody: any;
    let capturedHeaders: any;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string);
      capturedHeaders = init?.headers;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ cardId: '2D', reason: '出小牌垫牌' }),
              },
            },
          ],
        }),
      } as any;
    };

    const engine = new LlmEngine({
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'test-token',
      model: 'deepseek-chat',
      protocol: 'chat',
      responseFormat: 'json_object',
      fetchFn: mockFetch,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);
    const decision = await engine.chooseCard(obs, candidates);

    expect(capturedUrl).toBe('http://localhost:8000/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
    expect(capturedBody.model).toBe('deepseek-chat');
    expect(capturedBody.response_format).toEqual({ type: 'json_object' });
    expect(capturedBody.messages[0].role).toBe('system');
    expect(capturedBody.messages[1].role).toBe('user');

    expect(decision.engineType).toBe('llm');
    expect(cardId(decision.card)).toBe('2D');
  });

  it('LLM 支持传递 reasoning_effort 思考等级参数', async () => {
    let capturedBody: any;
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ cardId: '2D' }) } }],
        }),
      } as any;
    };

    const engine = new LlmEngine({
      fetchFn: mockFetch,
      reasoningEffort: 'low',
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);
    await engine.chooseCard(obs, candidates);

    expect(capturedBody.reasoning_effort).toBe('low');
    expect(capturedBody.temperature).toBeUndefined();
  });

  it('LayaEngine 默认模型为 laya:multilingual 以支持中文', () => {
    const engine = new LayaEngine();
    expect(engine.getOptions().model).toBe('laya:multilingual');
  });

  it('LLM Legacy Completions 协议：正确构建 prompt 并解析 text 返回', async () => {
    let capturedUrl = '';
    let capturedBody: any;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ text: JSON.stringify({ cardId: 'KD', reason: '抢先出K' }) }],
        }),
      } as any;
    };

    const engine = new LlmEngine({
      baseUrl: 'http://localhost:8000/v1',
      model: 'custom-model',
      protocol: 'completion',
      fetchFn: mockFetch,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);
    const decision = await engine.chooseCard(obs, candidates);

    expect(capturedUrl).toBe('http://localhost:8000/v1/completions');
    expect(typeof capturedBody.prompt).toBe('string');
    expect(cardId(decision.card)).toBe('KD');
  });

  it('Laya TypeSafe /v1/systemone 协议：组织 criteria 并解析 choice、probabilities 与 confidence', async () => {
    let capturedUrl = '';
    let capturedBody: any;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          answers: {
            play: {
              choice: '2D',
              probabilities: { '2D': 0.85, KD: 0.15 },
              confidence: 0.92,
            },
          },
        }),
      } as any;
    };

    const engine = new LayaEngine({
      baseUrl: 'http://127.0.0.1:11435',
      model: 'laya',
      fetchFn: mockFetch,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);
    const decision = await engine.chooseCard(obs, candidates);

    expect(capturedUrl).toBe('http://127.0.0.1:11435/v1/systemone');
    expect(capturedBody.model).toBe('laya');
    expect(capturedBody.questions.play.type).toBe('choice');
    expect(capturedBody.questions.play.criteria['2D']).toBeDefined();
    expect(capturedBody.questions.play.criteria['KD']).toBeDefined();

    expect(decision.engineType).toBe('laya');
    expect(cardId(decision.card)).toBe('2D');
    expect(decision.probabilities?.['2D']).toBe(0.85);
    expect(decision.confidence).toBe(0.92);
  });

  it('单张候选牌直接返回，不发起网络请求', async () => {
    const fetchSpy = vi.fn();
    const engine = new LayaEngine({ fetchFn: fetchSpy as any });
    const single = [makeCard('S', '7')];
    const obs = makeObservation(single);

    const decision = await engine.chooseCard(obs, single);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cardId(decision.card)).toBe('7S');
    expect(decision.diagnostic).toContain('唯一候选');
  });

  it('AbortSignal 取消：外部取消时终止并抛出异常', async () => {
    const controller = new AbortController();
    controller.abort();

    const engine = new LayaEngine({
      fetchFn: (async () => {
        throw new DOMException('This operation was aborted', 'AbortError');
      }) as any,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);

    await expect(engine.chooseCard(obs, candidates, controller.signal)).rejects.toThrow();
  });
});

describe('引擎适配器与健壮性回退机制 (EnginePlayerAgent Fallback & Logging)', () => {
  it('模型发生 HTTP 错误时自动回退到算法引擎，并记录回退原因', async () => {
    const mockErrorFetch: typeof fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);

    const failingLlm = new LlmEngine({ fetchFn: mockErrorFetch });
    const algoEngine = new AlgorithmEngine();
    const logger = new DecisionLogger();

    const agent = new EnginePlayerAgent({
      engine: failingLlm,
      fallbackEngine: algoEngine,
      logger,
    });

    const game = playingGame();
    const action = await agent.nextActionAsync(game);

    expect(action).not.toBeNull();
    expect(action?.kind).toBe('play');

    const records = logger.getRecords();
    expect(records.length).toBeGreaterThan(0);
    const lastRecord = records[records.length - 1];
    expect(lastRecord.engineType).toBe('algorithm');
    expect(lastRecord.requestedEngine).toBe('llm');
    expect(lastRecord.fallbackReason).toContain('回退');
  });

  it('模型返回不在候选列表的非法牌时，被安全拦截并回退到算法', async () => {
    const mockIllegalCardFetch: typeof fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ cardId: 'INVALID_CARD_999' }) } }],
      }),
    } as any);

    const illegalLlm = new LlmEngine({ fetchFn: mockIllegalCardFetch });
    const algoEngine = new AlgorithmEngine();
    const logger = new DecisionLogger();

    const agent = new EnginePlayerAgent({
      engine: illegalLlm,
      fallbackEngine: algoEngine,
      logger,
    });

    const game = playingGame();
    const action = await agent.nextActionAsync(game);

    expect(action).not.toBeNull();
    expect(action?.kind).toBe('play');

    const records = logger.getRecords();
    const lastRecord = records[records.length - 1];
    expect(lastRecord.fallbackReason).toContain('非法候选牌');
  });

  it('DecisionLogger 导出 JSON 格式完整，且胜率与概率指标隔离', () => {
    const logger = new DecisionLogger();
    logger.record({
      seat: 0,
      engineType: 'algorithm',
      roundNumber: 1,
      trickNumber: 1,
      ownHand: [makeCard('S', 'A')],
      currentRound: [],
      candidates: [makeCard('S', 'A')],
      chosenCard: makeCard('S', 'A'),
      latencyMs: 12,
      searchWinRate: 0.78, // 传统算法搜索胜率
    });

    logger.record({
      seat: 2,
      engineType: 'laya',
      roundNumber: 1,
      trickNumber: 1,
      ownHand: [makeCard('H', 'K')],
      currentRound: [],
      candidates: [makeCard('H', 'K')],
      chosenCard: makeCard('H', 'K'),
      latencyMs: 180,
      probabilities: { KH: 0.9, '2H': 0.1 }, // 模型概率
      confidence: 0.95,
    });

    const jsonStr = logger.exportJson();
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total).toBe(2);
    expect(parsed.records[0].searchWinRate).toBe(0.78);
    expect(parsed.records[0].probabilities).toBeUndefined();
    expect(parsed.records[1].probabilities).toEqual({ KH: 0.9, '2H': 0.1 });
    expect(parsed.records[1].searchWinRate).toBeUndefined();
  });

  it('EngineSettings 配置支持自定义 vLLM 端点 (qwen38_27b) 与 TypeSafe 地址并即时生效', () => {
    const manager = new DecisionEngineManager();
    const customSettings: EngineSettings = {
      activeType: 'llm',
      useProxy: false,
      llm: {
        baseUrl: 'http://211.141.18.165:6195/v1/',
        model: 'qwen38_27b',
        apiKey: 'custom-key',
        protocol: 'chat',
        reasoningEffort: 'low',
        timeoutMs: 9000,
      },
      laya: {
        baseUrl: 'http://192.168.1.100:11435',
        model: 'laya-custom',
        timeoutMs: 2000,
      },
    };

    applySettingsToManager(customSettings, manager);

    expect(manager.getActiveType()).toBe('llm');
    const llmOpts = manager.getLlmOptions();
    expect(llmOpts.baseUrl).toBe('http://211.141.18.165:6195/v1');
    expect(llmOpts.model).toBe('qwen38_27b');
    expect(llmOpts.apiKey).toBe('custom-key');
    expect(llmOpts.timeoutMs).toBe(9000);

    const layaOpts = manager.getLayaOptions();
    expect(layaOpts.baseUrl).toBe('http://192.168.1.100:11435');
    expect(layaOpts.model).toBe('laya-custom');
    expect(layaOpts.timeoutMs).toBe(2000);

    // 启用代理转发模式时，自动路由到同源代理路径
    applySettingsToManager({ ...customSettings, useProxy: true }, manager);
    expect(manager.getLlmOptions().baseUrl).toBe('/api/llm');
    expect(manager.getLayaOptions().baseUrl).toBe('/api/laya');
  });
});
