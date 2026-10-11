import { describe, expect, it, vi } from 'vitest';
import { Card, cardId, makeCard } from '../src/cards';
import { PlayerObservation } from '../src/ai/optimized/contracts';
import { LayaEngine } from '../src/ai/engines/layaEngine';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { AlgorithmEngine } from '../src/ai/engines/algorithmEngine';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { DecisionEngineManager } from '../src/ai/engines';
import { bindSafeFetch } from '../src/ai/engines/engineTypes';
import {
  EngineSettings,
  applySettingsToManager,
  DEFAULT_GOD_MODE,
  DEFAULT_ENGINE_SETTINGS,
  loadEngineSettings,
  saveEngineSettings,
} from '../src/ai/engines/engineSettings';
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
      useServerDecision: false,
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

  it('LLM 推理模型：提取 reasoning_content 与 <think> 标签并分离思考与结论', async () => {
    const mockFetch: typeof fetch = async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                reasoning_content: '这是来自推理模型的内部思考链：搭档♦A已出，我跟♦2保牌。',
                content: '<think>这是标签内部的思考过程</think>```json\n{"cardId": "2D", "thinking": "权衡手牌后决定垫小牌", "conclusion": "跟出最小0分牌♦2保牌", "confidence": 0.98}\n```',
              },
            },
          ],
        }),
      } as any;
    };

    const engine = new LlmEngine({
      baseUrl: 'http://localhost:8000/v1',
      model: 'deepseek-r1',
      fetchFn: mockFetch,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);
    const decision = await engine.chooseCard(obs, candidates);

    expect(cardId(decision.card)).toBe('2D');
    expect(decision.thinking).toContain('这是来自推理模型的内部思考链');
    expect(decision.thinking).toContain('这是标签内部的思考过程');
    expect(decision.thinking).toContain('权衡手牌后决定垫小牌');
    expect(decision.conclusion).toBe('跟出最小0分牌♦2保牌');
    expect(decision.confidence).toBe(0.98);
  });

  it('DecisionLogger：支持 subscribe 订阅机制，记录添加与清空时触发通知', () => {
    const logger = new DecisionLogger();
    let notifyCount = 0;
    const unsubscribe = logger.subscribe(() => {
      notifyCount++;
    });

    logger.record({
      seat: 0,
      engineType: 'llm',
      roundNumber: 1,
      trickNumber: 1,
      ownHand: [makeCard('D', '2')],
      currentRound: [],
      candidates: [makeCard('D', '2')],
      chosenCard: makeCard('D', '2'),
      latencyMs: 120,
      thinking: '测试思考链',
      conclusion: '测试结论',
    });

    expect(notifyCount).toBe(1);
    expect(logger.getRecords().length).toBe(1);
    expect(logger.getRecords()[0].thinking).toBe('测试思考链');
    expect(logger.getRecords()[0].conclusion).toBe('测试结论');

    logger.clear();
    expect(notifyCount).toBe(2);
    expect(logger.getRecords().length).toBe(0);

    unsubscribe();
    logger.record({
      seat: 0,
      engineType: 'bridge',
      roundNumber: 2,
      trickNumber: 2,
      ownHand: [],
      currentRound: [],
      candidates: [],
      chosenCard: makeCard('D', '2'),
      latencyMs: 50,
    });
    // 取消订阅后不再触发
    expect(notifyCount).toBe(2);
  });

  it('EngineSettings：上帝模式 (God Mode) 默认关闭，并支持持久化存储与回写', () => {
    expect(DEFAULT_GOD_MODE).toBe(false);
    expect(DEFAULT_ENGINE_SETTINGS.godMode).toBe(false);

    // 默认无 window 时安全回退
    const defaultSettings = loadEngineSettings();
    expect(defaultSettings.godMode).toBe(false);

    // 模拟 localStorage 持久化
    const store: Record<string, string> = {};
    const mockStorage: any = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };

    const origWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = { localStorage: mockStorage };

      // 保存上帝模式开启
      saveEngineSettings({
        ...DEFAULT_ENGINE_SETTINGS,
        godMode: true,
      });

      const loadedOn = loadEngineSettings();
      expect(loadedOn.godMode).toBe(true);

      // 保存上帝模式关闭
      saveEngineSettings({
        ...DEFAULT_ENGINE_SETTINGS,
        godMode: false,
      });

      const loadedOff = loadEngineSettings();
      expect(loadedOff.godMode).toBe(false);
    } finally {
      (globalThis as any).window = origWindow;
    }
  });

  it('LLM 请求参数、返回结果与上帝模式状态 (God Mode) 完整记录到决策日志', async () => {
    const mockFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      let chosenCardId = 'KD';
      try {
        const userContent = JSON.parse(body.messages[1].content);
        if (userContent.candidates && userContent.candidates.length > 0) {
          chosenCardId = userContent.candidates[0].cardId;
        }
      } catch {
        // fallback
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  cardId: chosenCardId,
                  thinking: '出大牌压制',
                  conclusion: '跟出选定牌',
                  confidence: 0.95,
                }),
              },
            },
          ],
        }),
      } as any;
    };

    const engine = new LlmEngine({ fetchFn: mockFetch, model: 'test-qwen' });
    const logger = new DecisionLogger();
    let godModeCurrent = { enabled: true, peekedSeats: [0, 2] };

    const agent = new EnginePlayerAgent({
      engine,
      logger,
      getGodModeState: () => godModeCurrent,
    });

    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(candidates);

    // 验证 LLM 决策包含 requestPayload 与 rawOutput
    const decision = await engine.chooseCard(obs, candidates);
    expect(decision.requestPayload).toBeDefined();
    expect(decision.requestPayload.model).toBe('test-qwen');
    expect(decision.rawOutput).toContain('出大牌压制');

    // 验证 Agent 记录日志中捕获了 godModeState 与 requestPayload
    const state = playingGame();
    await agent.nextActionAsync(state);

    const records = logger.getRecords();
    expect(records.length).toBeGreaterThan(0);
    const last = records[records.length - 1];
    expect(last.godModeState).toEqual({ enabled: true, peekedSeats: [0, 2] });
    expect(last.requestPayload).toBeDefined();
    expect(last.rawResponse).toBeDefined();
  });

  it('LLM 请求发生异常时：完整记录 errorDetails 与 fallbackReason，触发回退', async () => {
    const errorFetch: typeof fetch = async () => {
      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => 'vLLM service unavailable',
      } as any;
    };

    const engine = new LlmEngine({ fetchFn: errorFetch, model: 'offline-llm' });
    const logger = new DecisionLogger();

    const agent = new EnginePlayerAgent({
      engine,
      logger,
      getGodModeState: () => ({ enabled: false, peekedSeats: [] }),
    });

    const state = playingGame();
    const action = await agent.nextActionAsync(state);
    expect(action).not.toBeNull();
    expect(action?.kind).toBe('play');

    const records = logger.getRecords();
    const last = records[records.length - 1];
    expect(last.fallbackReason).toContain('从 llm 回退');
    expect(last.errorDetails).toContain('502 Bad Gateway');
    expect(last.godModeState).toEqual({ enabled: false, peekedSeats: [] });
  });

  it('bindSafeFetch：防止 Illegal invocation，确保 fetch 调用的上下文正确绑定', async () => {
    const mockWindow = {
      fetch: function (this: any, _input?: any, _init?: any) {
        if (this !== mockWindow) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve({ ok: true, status: 200 } as any);
      },
    };

    const origWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = mockWindow;

      // 如果直接作为对象方法调用未绑定的 fetch，会抛出 Illegal invocation
      const badObj = { fetchFn: mockWindow.fetch };
      expect(() => badObj.fetchFn('http://test')).toThrow('Illegal invocation');

      // 使用 bindSafeFetch 包装后，作为方法调用也能安全执行
      const safeObj = { fetchFn: bindSafeFetch() };
      const res = await safeObj.fetchFn('http://test');
      expect(res.ok).toBe(true);
    } finally {
      (globalThis as any).window = origWindow;
    }
  });
});
