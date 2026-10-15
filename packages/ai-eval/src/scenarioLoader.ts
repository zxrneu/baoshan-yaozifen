/**
 * 数据化样本适配器；按开闭原则通过阶段通用构造和判定支持新增 JSON 样本。
 * 每次构造克隆参数，沿用物理守恒校验及既有裁判语义。
 */
import { Card, cardId, RANKS, SUITS } from '@yaozifen/game-core/cards';
import { BaseEvaluationReport } from '@yaozifen/ai-core/engines/llm/llmEvaluator';
import { c, parseCards, createBiddingState, createTrumpState, createBuryState, createPlayingObservation } from './deckHelper';
import { parseScenarioDefinitions } from './scenarioData';
import { EvalScenario, ScenarioDefinition, ScenarioRoundCard, ScenarioSetupResult } from './types';

const roundCards = (entries: ScenarioRoundCard[]) => entries.map(entry => ({ ...entry, card: c(entry.card) }));

function createSetup(definition: ScenarioDefinition): ScenarioSetupResult {
  // 同时克隆历史、绝门信息等嵌套数组，调用方修改局面不影响后续运行。
  const data = structuredClone(definition);
  const seat = data.setup.seat;
  switch (data.phase) {
    case 'bidding':
      return { seat, state: createBiddingState({ ...data.setup, hand: parseCards(data.setup.hand) }) };
    case 'trump':
      return { seat, state: createTrumpState({ ...data.setup, hand: parseCards(data.setup.hand) }) };
    case 'bury':
      return { seat, state: createBuryState({ ...data.setup, hand16: parseCards(data.setup.hand16) }) };
    case 'playing':
      return { seat, ...createPlayingObservation({ ...data.setup,
        ownHand: parseCards(data.setup.ownHand),
        currentRound: roundCards(data.setup.currentRound),
        completedRounds: data.setup.completedRounds?.map(round => ({ ...round, cards: roundCards(round.cards) })),
        knownBuriedCards: data.setup.knownBuriedCards ? parseCards(data.setup.knownBuriedCards) : undefined,
        revealedHand: data.setup.revealedHand ? { seat: data.setup.revealedHand.seat,
          cards: parseCards(data.setup.revealedHand.cards) } : undefined,
      }) };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function actionField(raw: unknown, field: string): unknown {
  return isObject(raw) && isObject(raw.action) ? raw.action[field] : undefined;
}

function isCard(value: unknown): value is Card {
  return isObject(value) && RANKS.some(rank => rank === value.rank) && SUITS.some(suit => suit === value.suit);
}

function meetsCriteria(definition: ScenarioDefinition, report: BaseEvaluationReport, raw?: unknown): boolean {
  if (!report.isLegal) return false;
  switch (definition.phase) {
    case 'bidding': {
      const actualBid = actionField(raw, 'bid') ?? ('bid' in report ? report.bid : undefined);
      const expected = definition.expected;
      return 'bids' in expected
        ? (actualBid === null || typeof actualBid === 'number') && expected.bids.includes(actualBid)
        : typeof actualBid === 'number' && actualBid >= expected.minBid && actualBid <= expected.maxBid;
    }
    case 'trump': {
      const actualTrump = actionField(raw, 'trump') ?? ('trump' in report ? report.trump : undefined);
      return definition.expected.suits.some(suit => suit === actualTrump);
    }
    case 'bury': {
      if (!('zeroPointsBuried' in report) || !report.zeroPointsBuried) return false;
      const expected = definition.expected;
      if (expected.trumpsPreserved !== undefined
        && (!('trumpsPreserved' in report) || report.trumpsPreserved !== expected.trumpsPreserved)) return false;
      if (expected.minVoidsCreated !== undefined
        && (!('voidsCreated' in report) || typeof report.voidsCreated !== 'number'
          || report.voidsCreated < expected.minVoidsCreated)) return false;
      // 既有样本的逐牌约束使用实际动作；缺少动作时按空扣牌处理。
      const cards = actionField(raw, 'cards');
      const buriedIds = Array.isArray(cards) ? cards.filter(isCard).map(cardId) : [];
      return (expected.includeCards?.every(card => buriedIds.includes(card)) ?? true)
        && (expected.excludeCards?.every(card => !buriedIds.includes(card)) ?? true);
    }
    case 'playing': {
      const actualCard = 'cardId' in report ? report.cardId : undefined;
      return (definition.expected.cards?.some(card => card === actualCard) ?? true)
        && (definition.expected.excludeCards?.every(card => card !== actualCard) ?? true);
    }
  }
}

export function loadScenarios(data: unknown): EvalScenario[] {
  return parseScenarioDefinitions(data).map(definition => {
    const { setup: _setup, expected: _expected, ...metadata } = definition;
    const setup = () => {
      try { return createSetup(definition); }
      catch (error) {
        throw new Error(`评估样本 ${definition.id}：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    // 尽早拒绝牌张或历史矛盾，运行阶段仍保留相同校验。
    setup();
    return { ...metadata, definition, setup,
      expectedCriteria: (report, raw) => meetsCriteria(definition, report, raw) };
  });
}
