/**
 * 非自回归 Laya 决策引擎（TypeSafe / Ollaya /v1/systemone 接口适配）。
 * 默认超时 1.5 秒。只传递玩家可见信息；非法回答或超时将由适配器回退。
 */
import { Card, cardId, cardLabel } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { DecisionEngine, EngineDecision, bindSafeFetch } from './engineTypes';

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

    // 超时与取消控制
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal;

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
    }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
