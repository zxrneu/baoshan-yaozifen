/**
 * 非自回归 Laya 决策引擎（TypeSafe / Ollaya /v1/systemone 接口适配）。
 * 支持全生命周期（叫分、定主、扣底、出牌）决策推演与概率打分。
 * 默认超时 1.5 秒。使用 safeAnySignal 严格保留 abort 异常上下文。
 */
import { Card, cardId, cardLabel, SUITS, Suit } from '../../cards';
import { GameState, legalBids, legalMoves } from '../../engine';
import { PlayerObservation } from '../optimized/contracts';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { smartBid, smartTrump, smartBury } from '../smart';
import {
  DecisionEngine, EngineDecision, ActionDecision, bindSafeFetch, safeAnySignal,
} from './engineTypes';

export interface LayaEngineOptions {
  baseUrl?: string; // 默认 'http://127.0.0.1:11435' 或代理端点
  model?: string;   // 默认 'laya:multilingual'
  timeoutMs?: number; // 默认 1500ms
  fetchFn?: typeof fetch;
}

export class LayaEngine implements DecisionEngine {
  readonly type = 'laya' as const;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: LayaEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:11435';
    this.model = options.model ?? 'laya:multilingual';
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchFn = bindSafeFetch(options.fetchFn);
  }

  getOptions(): LayaEngineOptions {
    return {
      baseUrl: this.baseUrl,
      model: this.model,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
    };
  }

  updateOptions(options: Partial<LayaEngineOptions>): void {
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.model !== undefined) this.model = options.model;
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
    if (options.fetchFn !== undefined) this.fetchFn = bindSafeFetch(options.fetchFn);
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'laya',
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    // 组织 criteria：将候选牌映射为键值对
    const criteria: Record<string, string> = {};
    for (const c of candidates) {
      criteria[cardId(c)] = `出 ${cardLabel(c)}`;
    }

    // 只投影合法可见信息（不泄露对手暗牌）
    const statePayload = {
      game: '云南保山幺子分',
      phase: 'playing',
      seat: observation.seat,
      hand: observation.ownHand.map((c) => cardLabel(c)),
      revealed_partner_hand: observation.revealedHand
        ? {
            seat: observation.revealedHand.seat,
            cards: observation.revealedHand.cards.map((c) => cardLabel(c)),
          }
        : null,
      trump: observation.trump,
      declarer: observation.declarer,
      bid: observation.bid,
      declarerPoints: observation.declarerPoints,
      defenderPoints: observation.defenderPoints,
      current_trick: observation.currentRound.map((entry) => ({
        seat: entry.seat,
        card: cardLabel(entry.card),
      })),
      completed_tricks_count: observation.completedRounds.length,
      known_voids: observation.voidSuits.map((suits, s) => ({
        seat: s,
        voids: suits,
      })),
    };

    const requestBody = {
      model: this.model,
      state: statePayload,
      questions: {
        play: {
          type: 'choice',
          instructions: '根据保山幺子分规则，请在候选牌中选择最佳出牌：',
          criteria,
        },
      },
    };

    // 超时与取消控制（严格保留原因，避免 signal is aborted without reason）
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`Laya 决策请求超时 (超过 ${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const url = this.baseUrl.endsWith('/v1/systemone')
        ? this.baseUrl
        : `${this.baseUrl.replace(/\/+$/, '')}/v1/systemone`;

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new Error(`Laya HTTP 请求失败 (${response.status} ${response.statusText})`);
      }

      const json = await response.json();
      const choiceId = json.answers?.play?.choice;
      if (!choiceId || typeof choiceId !== 'string') {
        throw new Error('Laya 返回格式无效：缺失 answers.play.choice');
      }

      const matched = candidates.find((c) => cardId(c) === choiceId);
      if (!matched) {
        throw new Error(`Laya 返回非法候选牌: ${choiceId}，不在当前可选范围内`);
      }

      const probabilities: Record<string, number> | undefined =
        json.answers?.play?.probabilities;
      const confidence: number | undefined = json.answers?.play?.confidence;

      const probDesc = probabilities
        ? Object.entries(probabilities)
            .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`)
            .join(' | ')
        : '单步直接分类';

      return {
        card: matched,
        engineType: 'laya',
        latencyMs: performance.now() - started,
        probabilities,
        confidence,
        thinking: `TypeSafe /v1/systemone 非自回归概率推断。\n候选概率分布: ${probDesc}`,
        conclusion: `Laya 模型单步推断选出最高分候选 ${cardLabel(matched)}${confidence !== undefined ? ` (置信度: ${(confidence * 100).toFixed(1)}%)` : ''}。`,
        diagnostic: `Laya选择: ${cardLabel(matched)}${confidence !== undefined ? ` (置信度: ${(confidence * 100).toFixed(1)}%)` : ''}`,
      };
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  async chooseBid(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    const started = performance.now();
    const legal = legalBids(state);
    if (legal.length === 0) {
      return {
        action: { kind: 'bid', seat, bid: null },
        engineType: 'laya',
        latencyMs: performance.now() - started,
        thinking: '无合法叫分档位，自动放弃',
        conclusion: '放弃叫分',
      };
    }

    const criteria: Record<string, string> = { pass: '不叫 / 放弃' };
    for (const b of legal) {
      criteria[String(b)] = `叫 ${b} 分`;
    }

    const requestBody = {
      model: this.model,
      state: {
        game: '云南保山幺子分',
        phase: 'bidding',
        seat,
        hand: state.hands[seat].map((c) => cardLabel(c)),
        highestBid: state.highestBid,
        legalBids: legal,
      },
      questions: {
        bid: {
          type: 'choice',
          instructions: '请根据起手手牌牌力决定叫分：',
          criteria,
        },
      },
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`Laya 叫分请求超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const url = this.baseUrl.endsWith('/v1/systemone')
        ? this.baseUrl
        : `${this.baseUrl.replace(/\/+$/, '')}/v1/systemone`;

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new Error(`Laya 叫分请求失败 (${response.status} ${response.statusText})`);
      }

      const json = await response.json();
      const choice = json.answers?.bid?.choice;
      const confidence = json.answers?.bid?.confidence;
      const targetBid = choice === 'pass' || !choice ? null : Number(choice);

      // 验证合法性
      const finalBid = targetBid === null || legal.includes(targetBid) ? targetBid : null;

      return {
        action: { kind: 'bid', seat, bid: finalBid },
        engineType: 'laya',
        latencyMs: performance.now() - started,
        confidence,
        thinking: `Laya 非自回归模型评估手牌牌力与叫分概率分布。`,
        conclusion: finalBid === null ? 'Laya 评估选择不叫。' : `Laya 叫出 ${finalBid} 分。`,
      };
    } catch {
      // 算法保底
      const fb = smartBid(state, seat);
      return {
        action: { kind: 'bid', seat, bid: fb },
        engineType: 'laya',
        latencyMs: performance.now() - started,
        fallbackReason: 'Laya 叫分网络异常，回退算法',
        thinking: '回退至保山牌力折价算法评估叫分。',
        conclusion: fb === null ? '不叫' : `叫 ${fb} 分`,
      };
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  async chooseTrump(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    const started = performance.now();
    const criteria: Record<string, string> = {
      S: '黑桃 ♠ 为主',
      H: '红心 ♥ 为主',
      C: '梅花 ♣ 为主',
      D: '方块 ♦ 为主',
    };

    const requestBody = {
      model: this.model,
      state: {
        game: '云南保山幺子分',
        phase: 'declaring',
        seat,
        hand: state.hands[seat].map((c) => cardLabel(c)),
      },
      questions: {
        trump: {
          type: 'choice',
          instructions: '请为当前手牌选择最佳主牌花色：',
          criteria,
        },
      },
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`Laya 定主请求超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const url = this.baseUrl.endsWith('/v1/systemone')
        ? this.baseUrl
        : `${this.baseUrl.replace(/\/+$/, '')}/v1/systemone`;

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new Error(`Laya 定主请求失败 (${response.status} ${response.statusText})`);
      }

      const json = await response.json();
      const choice = json.answers?.trump?.choice as Suit;
      const validChoice = SUITS.includes(choice) ? choice : smartTrump(state, seat);

      return {
        action: { kind: 'trump', seat, trump: validChoice },
        engineType: 'laya',
        latencyMs: performance.now() - started,
        thinking: `Laya 评估四门花色控制力与绝门潜质。`,
        conclusion: `Laya 选定主牌花色: ${validChoice}。`,
      };
    } catch {
      const fb = smartTrump(state, seat);
      return {
        action: { kind: 'trump', seat, trump: fb },
        engineType: 'laya',
        latencyMs: performance.now() - started,
        fallbackReason: 'Laya 定主网络异常，回退算法',
        conclusion: `算法选定主牌花色: ${fb}。`,
      };
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  async chooseBury(state: GameState, seat: number, _signal?: AbortSignal): Promise<ActionDecision> {
    const started = performance.now();
    // 扣底规则：A/10/5 不能扣底，必须扣 4 张非分牌
    const cards = smartBury(state, seat);
    return {
      action: { kind: 'bury', seat, cards },
      engineType: 'laya',
      latencyMs: performance.now() - started,
      thinking: '扣底遵循保山幺子分规则：严禁扣分牌 (A/10/5)，优先制造短门与保护主牌及大牌。',
      conclusion: `扣底 ${cards.map((c) => cardLabel(c)).join(' ')}。`,
    };
  }

  async chooseAction(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    if (state.phase === 'bidding') {
      return this.chooseBid(state, seat, signal);
    }
    if (state.phase === 'trump') {
      return this.chooseTrump(state, seat, signal);
    }
    if (state.phase === 'bury') {
      return this.chooseBury(state, seat, signal);
    }
    if (state.phase === 'playing') {
      const observation = observePlayer(state, seat);
      const legal = legalMoves(state, seat);
      const candidates = pruneCandidates(observation, legal);
      const decision = await this.chooseCard(observation, candidates, signal);
      return {
        action: { kind: 'play', seat, card: decision.card },
        decision,
        engineType: 'laya',
        latencyMs: decision.latencyMs,
        thinking: decision.thinking,
        conclusion: decision.conclusion,
        confidence: decision.confidence,
        modelName: decision.modelName,
        probabilities: decision.probabilities,
        fallbackReason: decision.fallbackReason,
        errorDetails: decision.errorDetails,
      };
    }
    throw new Error(`不支持的状态阶段: ${state.phase}`);
  }
}
