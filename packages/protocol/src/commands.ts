/** 历史动作及身份指纹（SRP）：白名单解析动作，区分节点身份与完整局面摘要。 */
import { RANKS, SUITS, cardId, cardPoints } from '@yaozifen/game-core/cards';
import type { Card, Suit } from '@yaozifen/game-core/cards';
import type { AiAction } from './session';
import type { SessionCommand } from './session';
import type { ActionNodeInput, MatchStatus } from './contracts';
import { MATCH_STATUSES } from './contracts';
import { contentDigest } from './json';
import { sanitizeHistorySnapshot } from './snapshot';
import { fail, isRecord } from './errors';

export function matchesStatus(value: unknown): MatchStatus | null {
  return MATCH_STATUSES.includes(value as MatchStatus) ? (value as MatchStatus) : null;
}

export function suitOrNull(value: unknown): Suit | null {
  return SUITS.includes(value as Suit) ? (value as Suit) : null;
}

export function cardValue(value: unknown): Card {
  if (!isRecord(value) || !SUITS.includes(value.suit as Suit) || !RANKS.includes(value.rank as Card['rank'])) {
    return fail('非法牌张');
  }
  return { suit: value.suit as Suit, rank: value.rank as Card['rank'] };
}

export function commandValue(value: unknown): SessionCommand {
  if (!isRecord(value)) return fail('非法动作');
  if (value.kind === 'nextHand') return { kind: 'nextHand' };
  if (typeof value.seat !== 'number' || !Number.isInteger(value.seat) || value.seat < 0 || value.seat > 3) return fail('非法动作座位（应为 0..3）');
  const seat = value.seat;
  switch (value.kind) {
    case 'bid': {
      if (value.bid !== null && (typeof value.bid !== 'number' || !Number.isInteger(value.bid)
        || value.bid < 70 || value.bid > 100 || (value.bid - 70) % 5 !== 0)) return fail('非法动作叫分（应为 70..100，步长 5，或 null）');
      return { kind: 'bid', seat, bid: value.bid as number | null };
    }
    case 'trump': {
      const trump = suitOrNull(value.trump);
      return trump === null ? fail('非法动作主花色') : { kind: 'trump', seat, trump };
    }
    case 'bury': {
      if (!Array.isArray(value.cards) || value.cards.length !== 4) return fail('非法埋牌数组（应恰好 4 张）');
      const cards = value.cards.map(cardValue);
      if (new Set(cards.map(cardId)).size !== 4) return fail('埋牌不能重复');
      if (cards.some(card => cardPoints(card) !== 0)) return fail('分牌不能埋牌');
      return { kind: 'bury', seat, cards };
    }
    case 'play': return { kind: 'play', seat, card: cardValue(value.card) };
    default: return fail('未知动作类型');
  }
}

/** 持久化局面指纹（state_digest）：只覆盖完整局面，包含 seed/history，不包含提交位置或动作元数据。 */
export function actionNodeDigest(input: Pick<ActionNodeInput, 'state'>): string {
  return contentDigest({ state: sanitizeHistorySnapshot(input.state) });
}

/** 节点身份指纹：分支、父指针、序号、动作、来源与检查点共同派生默认 nodeId；忽略重试时间戳。 */
export function actionNodeIdentity(input: Pick<ActionNodeInput, 'branchId' | 'parentId' | 'seq' | 'command' | 'source' | 'state' | 'checkpoint'>): string {
  return contentDigest({
    branchId: input.branchId,
    parentId: input.parentId ?? null,
    seq: input.seq,
    command: commandValue(input.command),
    source: input.source,
    checkpoint: input.checkpoint === true,
    stateDigest: actionNodeDigest(input),
  });
}

export function aiActionCommand(command: SessionCommand): AiAction | null {
  return command.kind === 'nextHand' ? null : command;
}
