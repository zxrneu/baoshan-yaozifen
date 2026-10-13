/**
 * 评估牌局构造辅助服务 (SOLID - SRP 原则，物理牌张守恒 L0 验证)。
 * 负责从特定的私有手牌与底牌配置中，以物理守恒方式补全合法的一副 52 张扑克牌，
 * 确保全副牌严格无重复、四家各有 12 张手牌、底牌恰好 4 张、全场总分严格为 100 分。
 */
import {
  Card,
  freshDeck,
  cardId,
  cardPoints,
  sortHand,
  Suit,
  makeCard,
  Rank,
} from '../../cards';
import { GameState, createGame, trickWinner, sideOf } from '../../engine';
import { PlayerObservation } from '../optimized/contracts';
import { legalObservationCards } from '../optimized/observation';
import { createBeliefSource } from '../optimized/belief';

/**
 * 快捷卡牌构造工具（双向支持 "SA" 与 "AS"、"10S" 与 "S10" 格式）
 */
export function c(notation: string): Card {
  notation = notation.trim();
  const SUIT_CHARS = ['S', 'H', 'C', 'D', '♠', '♥', '♣', '♦'];
  const suitMap: Record<string, Suit> = {
    S: 'S', H: 'H', C: 'C', D: 'D',
    '♠': 'S', '♥': 'H', '♣': 'C', '♦': 'D',
  };

  // 1. 若以花色开头（如 "SA", "♠10"）
  if (SUIT_CHARS.includes(notation[0].toUpperCase())) {
    const suitChar = notation[0].toUpperCase();
    const rankStr = notation.slice(1).toUpperCase();
    return makeCard(suitMap[suitChar], rankStr as Rank);
  }

  // 2. 若以花色结尾（如 "AS", "10S"，即工程 cardId 格式）
  const lastChar = notation.slice(-1).toUpperCase();
  if (SUIT_CHARS.includes(lastChar)) {
    const rankStr = notation.slice(0, -1).toUpperCase();
    return makeCard(suitMap[lastChar], rankStr as Rank);
  }

  throw new Error(`非法牌记法: ${notation}`);
}

export function parseCards(notations: string[]): Card[] {
  return notations.map(c);
}

/**
 * 52张扑克牌物理守恒发牌构建器
 */
export function buildCustomDeal(params: {
  targetSeat: number;
  targetHand: Card[]; // 必须为 12 张（若为叫分/定主）或 16 张（若为扣底带底手牌）
  kitty?: Card[];     // 4 张底牌（可选）
  partnerHand?: Card[]; // 可选指定搭档手牌
}): {
  hands: Card[][];
  kitty: Card[];
  allCards: Card[];
} {
  const { targetSeat, targetHand, kitty: customKitty, partnerHand } = params;
  const fullDeck = freshDeck();

  // 1. 收集已占用牌张并校验无重复
  const usedCardIds = new Set<string>();
  const markUsed = (cards: Card[], source: string) => {
    for (const card of cards) {
      const id = cardId(card);
      if (usedCardIds.has(id)) {
        throw new Error(`牌张重复冲突 [${source}]: ${id}`);
      }
      usedCardIds.add(id);
    }
  };

  markUsed(targetHand, 'targetHand');

  let kitty: Card[] = [];
  if (customKitty) {
    if (customKitty.length !== 4) throw new Error('底牌必须恰好 4 张');
    markUsed(customKitty, 'customKitty');
    kitty = [...customKitty];
  }

  if (partnerHand) {
    markUsed(partnerHand, 'partnerHand');
  }

  // 2. 剩余未分配牌
  const remaining = fullDeck.filter((card) => !usedCardIds.has(cardId(card)));

  // 如果未指定底牌，且 targetHand 是 12 张，则从剩余牌中抽取 4 张作为底牌
  if (!customKitty && targetHand.length === 12) {
    kitty = remaining.splice(0, 4);
  }

  // 3. 为四家构建 12 张手牌
  const hands: Card[][] = [[], [], [], []];
  const partnerSeat = (targetSeat + 2) % 4;

  if (targetHand.length === 12) {
    hands[targetSeat] = [...targetHand];
  } else if (targetHand.length === 16) {
    // 扣底阶段：前 12 张给 targetSeat，后 4 张算作原底牌
    hands[targetSeat] = targetHand.slice(0, 12);
    kitty = targetHand.slice(12, 16);
  } else {
    throw new Error(`目标手牌张数必须为 12 或 16 张，实际为 ${targetHand.length}`);
  }

  if (partnerHand) {
    hands[partnerSeat] = [...partnerHand];
  }

  // 补全其余未分配座位的 12 张手牌
  for (let s = 0; s < 4; s++) {
    if (hands[s].length === 0) {
      hands[s] = remaining.splice(0, 12);
    }
  }

  // 最终严格物理守恒验证
  const allCards = [...hands[0], ...hands[1], ...hands[2], ...hands[3], ...kitty];
  if (allCards.length !== 52) {
    throw new Error(`发牌异常：全场牌总数期望 52 张，实际为 ${allCards.length} 张`);
  }
  const totalScore = allCards.reduce((sum, card) => sum + cardPoints(card), 0);
  if (totalScore !== 100) {
    throw new Error(`全场分值守恒失败：期望恰好 100 分，实际为 ${totalScore} 分`);
  }

  return { hands, kitty, allCards };
}

/**
 * 构造叫分阶段的 GameState
 */
export function createBiddingState(params: {
  seat: number;
  hand: Card[];
  highestBid?: number;
  highestBidder?: number | null;
  history?: Array<{ seat: number; bid: number | null }>;
}): GameState {
  const { seat, hand, highestBid = 0, highestBidder = null, history = [] } = params;
  const { hands, kitty } = buildCustomDeal({ targetSeat: seat, targetHand: hand });

  const state = createGame(9999);
  state.phase = 'bidding';
  state.hands = hands;
  state.kitty = kitty;
  state.dealer = (seat + 3) % 4;
  state.highestBid = highestBid;
  state.highestBidder = highestBidder;
  state.bidding = history;
  state.bidOrder = [(state.dealer + 1) % 4, (state.dealer + 2) % 4, (state.dealer + 3) % 4, state.dealer];

  return state;
}

/**
 * 构造定主阶段的 GameState
 */
export function createTrumpState(params: {
  seat: number;
  hand: Card[];
  winningBid?: number;
}): GameState {
  const { seat, hand, winningBid = 75 } = params;
  const { hands, kitty } = buildCustomDeal({ targetSeat: seat, targetHand: hand });

  const state = createGame(9999);
  state.phase = 'trump';
  state.hands = hands;
  state.kitty = kitty;
  state.declarer = seat;
  state.highestBid = winningBid;
  state.highestBidder = seat;
  state.leader = seat;

  return state;
}

/**
 * 构造扣底阶段的 GameState (手牌含拿底后的 16 张)
 */
export function createBuryState(params: {
  seat: number;
  hand16: Card[];
  trump: Suit;
  winningBid?: number;
}): GameState {
  const { seat, hand16, trump, winningBid = 75 } = params;
  if (hand16.length !== 16) throw new Error('扣底手牌必须包含 16 张牌 (12张起手 + 4张底牌)');
  const { hands, kitty } = buildCustomDeal({ targetSeat: seat, targetHand: hand16 });

  const state = createGame(9999);
  state.phase = 'bury';
  state.hands = hands;
  state.hands[seat] = [...hand16];
  state.kitty = [...kitty];
  state.declarer = seat;
  state.highestBid = winningBid;
  state.highestBidder = seat;
  state.trump = trump;
  state.leader = seat;

  return state;
}

/**
 * 构造出牌阶段的 PlayerObservation 与合法 candidates (严格 L0 牌张守恒验证)
 */
export function createPlayingObservation(params: {
  seat: number;
  ownHand: Card[];
  trump: Suit;
  declarer: number;
  bid: number;
  leader: number;
  roundNumber: number;
  currentRound: Array<{ seat: number; card: Card }>;
  completedRounds?: Array<{
    trickNumber: number;
    winner: number;
    points: number;
    cards: Array<{ seat: number; card: Card }>;
  }>;
  knownBuriedCards?: Card[];
  revealedHand?: PlayerObservation['revealedHand'];
  declarerPoints?: number;
  defenderPoints?: number;
  voidSuits?: Suit[][];
}): {
  observation: PlayerObservation;
  candidates: readonly Card[];
} {
  const {
    seat,
    ownHand,
    trump,
    declarer,
    bid,
    leader,
    roundNumber,
    currentRound,
    completedRounds = [],
    knownBuriedCards,
    revealedHand,
    declarerPoints = 0,
    defenderPoints = 0,
    voidSuits = [[], [], [], []],
  } = params;

  // L0 验证：本局中所有已见牌不重不漏
  const seenIds = new Set<string>();
  const checkUnique = (cards: Card[], tag: string) => {
    for (const card of cards) {
      const id = cardId(card);
      if (seenIds.has(id)) {
        throw new Error(`出牌场景牌张冲突 [${tag}]: ${id}`);
      }
      seenIds.add(id);
    }
  };

  checkUnique(ownHand, 'ownHand');
  checkUnique(currentRound.map((r) => r.card), 'currentRound');
  for (const round of completedRounds) {
    checkUnique(round.cards.map((r) => r.card), `completedRound-${round.trickNumber}`);
  }
  if (knownBuriedCards) {
    if (seat !== declarer || knownBuriedCards.length !== 4 || knownBuriedCards.some(card => cardPoints(card) !== 0)) {
      throw new Error('出牌场景已知底牌必须为庄家的四张零分扣牌');
    }
    checkUnique(knownBuriedCards, 'knownBuriedCards');
  }
  if ((bid === 100) !== (revealedHand !== undefined)) throw new Error('出牌场景 100 分合同必须包含搭档明牌，其他合同禁止明牌');

  // L0 验证：手牌张数守恒与历史得分守恒
  const handCounts = [12, 12, 12, 12].map((cnt, s) => {
    const playedInCompleted = completedRounds.length;
    const playedInCurrent = currentRound.some((r) => r.seat === s) ? 1 : 0;
    return cnt - playedInCompleted - playedInCurrent;
  });

  if (ownHand.length !== handCounts[seat]) {
    throw new Error(
      `出牌场景手牌张数不守恒: 座位 ${seat} 的 ownHand 实际有 ${ownHand.length} 张，但 handCounts 计算应为 ${handCounts[seat]} 张 (已完成 ${completedRounds.length} 轮)`,
    );
  }

  const teamPoints = [0, 0];
  let previousWinner: number | undefined;
  for (const [index, round] of completedRounds.entries()) {
    if (round.trickNumber !== index + 1 || round.cards.length !== 4) {
      throw new Error('出牌场景历史墩序号或张数不合法');
    }
    const roundLeader = round.cards[0].seat;
    if (round.cards.some((entry, i) => entry.seat !== (roundLeader + i) % 4)
      || (previousWinner !== undefined && roundLeader !== previousWinner)) {
      throw new Error('出牌场景历史领出家或出牌顺序不自洽');
    }
    const actualWinner = trickWinner(round.cards, trump).seat;
    if (round.winner !== actualWinner) throw new Error(`出牌场景第 ${round.trickNumber} 墩赢家不正确`);
    previousWinner = actualWinner;
    const actualTrickPoints = round.cards.reduce((sum, entry) => sum + cardPoints(entry.card), 0);
    if (round.points !== actualTrickPoints) throw new Error(`出牌场景第 ${round.trickNumber} 墩分值不守恒`);
    teamPoints[sideOf(actualWinner) === sideOf(declarer) ? 0 : 1] += actualTrickPoints;
    if (teamPoints[0] >= bid || teamPoints[1] >= 105 - bid) {
      throw new Error('出牌场景历史已达到成局线，本副应已结束');
    }
  }
  if (teamPoints[0] !== declarerPoints || teamPoints[1] !== defenderPoints) {
    throw new Error(`出牌场景双方得分归属不正确: 应为庄 ${teamPoints[0]} / 闲 ${teamPoints[1]}`);
  }
  if (previousWinner !== undefined && leader !== previousWinner) {
    throw new Error('出牌场景领出家不自洽: 必须由上一墩赢家继续领出');
  }
  if (roundNumber !== completedRounds.length + 1 || currentRound.length >= 4
    || currentRound.some((entry, i) => entry.seat !== (leader + i) % 4)
    || seat !== (leader + currentRound.length) % 4) {
    throw new Error('出牌场景当前轮序号或行动座位不自洽');
  }
  // 曾经垫牌即证明绝门，之后不能再出现该门牌（包括当前保留手牌）。
  const inferredVoids = Array.from({ length: 4 }, () => new Set<Suit>());
  for (const round of [...completedRounds.map(r => r.cards), currentRound]) {
    for (const entry of round) {
      if (inferredVoids[entry.seat].has(entry.card.suit)) throw new Error('出牌场景历史绝门矛盾');
      if (entry.card.suit !== round[0].card.suit) inferredVoids[entry.seat].add(round[0].card.suit);
    }
  }
  if (ownHand.some(card => inferredVoids[seat].has(card.suit) || voidSuits[seat].includes(card.suit))) {
    throw new Error('出牌场景自身手牌与绝门信息矛盾');
  }

  const observation: PlayerObservation = {
    seat,
    ownHand: sortHand(ownHand),
    handCounts,
    declarer,
    bid,
    trump,
    leader,
    roundNumber,
    currentRound,
    completedRounds,
    knownBuriedCards,
    declarerPoints,
    defenderPoints,
    voidSuits: voidSuits.map((suits, s) => [...new Set([...suits, ...inferredVoids[s]])]),
    ...(revealedHand ? { revealedHand } : {}),
    kittySize: 4,
    ruleId: 'basic-v1',
  };

  // 同一套约束求解器验证明牌一致性及暗牌/零分底牌存在合法补全，拒绝不可达夹具。
  createBeliefSource(observation);

  const candidates = legalObservationCards(observation);

  return { observation, candidates };
}
