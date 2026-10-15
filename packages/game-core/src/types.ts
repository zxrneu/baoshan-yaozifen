/**
 * 领域类型与座位常量（无逻辑，被 rules/trick/game 依赖）。
 */
import { Card, Suit } from './cards';
import { HandResult, RuleConfig } from './rules';

export type Phase = 'bidding' | 'trump' | 'bury' | 'playing' | 'handEnd' | 'matchEnd';

/** 座位：0=东 1=南 2=西 3=北；座位 % 2 即所属方（0=东西方, 1=南北方） */
export const SEAT_NAMES = ['东', '南', '西', '北'] as const;
export const SIDE_NAMES = ['东西方', '南北方'] as const;

export const sideOf = (seat: number): number => seat % 2;
export const partnerOf = (seat: number): number => (seat + 2) % 4;

export interface BiddingNote {
  seat: number;
  bid: number | null; // null = 不叫
}

export interface TrickCard {
  seat: number;
  card: Card;
}

export interface CompletedTrick {
  trickNumber: number;
  winner: number;
  points: number;
  cards: TrickCard[];
}

export interface GameState {
  phase: Phase;
  hands: Card[][];
  kitty: Card[];
  dealer: number;
  bidding: BiddingNote[];
  /** 叫分顺序（座位序列），从发牌者下家开始 */
  bidOrder: number[];
  highestBid: number;
  highestBidder: number | null;
  declarer: number | null;
  trump: Suit | null;
  leader: number;
  trick: TrickCard[];
  /** 上一轮留存（结算后不清，供 UI 展示“上一轮谁收走多少分”） */
  lastTrick: TrickCard[];
  lastWinner: number | null;
  lastPoints: number;
  /** 完整出牌历史（每轮所有选手的出牌明细与收分） */
  completedTricks: CompletedTrick[];
  trickNumber: number; // 1..12
  declarerTrickPoints: number;
  defenderTrickPoints: number;
  buriedPoints: number;
  /** 各方已胜副数 [东西, 南北] */
  scores: [number, number];
  targetWins: number;
  result: HandResult | null;
  history: string[];
  seed: number;
  rules: RuleConfig;
}

export class IllegalActionError extends Error {}
