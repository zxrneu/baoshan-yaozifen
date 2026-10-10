/**
 * 规则配置与结算策略。
 *
 * ScoringRule 抽象出"一副牌如何结算"：基础版直接比较吃分与叫分；
 * 地方变体（如抠底翻倍）只需提供新的 ScoringRule 即可接入（开闭原则），
 * 引擎其余部分无需改动。
 */
import { Card, Suit, cardPoints } from '../cards';

/** 叫到 100 分：成功扣底后，庄家的搭档向所有玩家公开剩余手牌。 */
export const OPEN_PARTNER_BID = 100;

export interface RuleConfig {
  minBid: number;
  bidStep: number;
  maxBid: number;
  kittySize: number;
  handSize: number;
  targetWins: number;
  /** 本局采用的结算策略 */
  scoring: ScoringRule;
}

/** 一副牌打完后交给结算策略的上下文 */
export interface ScoringContext {
  bid: number;
  declarer: number;
  declarerSide: number;
  trump: Suit;
  declarerTrickPoints: number;
  defenderTrickPoints: number;
  /** 末轮抠出的新底牌（结算底牌分用） */
  kitty: readonly Card[];
}

export interface HandResult {
  bid: number;
  declarer: number;
  trump: Suit;
  /** 庄家方吃分（出牌得分 + 底牌分） */
  declarerPoints: number;
  /** 闲家方吃分 */
  defenderPoints: number;
  /** 底牌分（归庄家方） */
  buriedPoints: number;
  success: boolean;
  /** 本副获胜方（0=东西, 1=南北） */
  winnerSide: number;
  /** 是否提前结束（胜负已确定，剩余手牌未打完） */
  earlyFinish?: boolean;
  /** 未打出的分牌分数 */
  unplayedPoints?: number;
}

export type ScoringRule = (ctx: ScoringContext) => HandResult;

/** v1 基础结算：庄家方吃分（含底牌）≥ 叫分即成局 */
export const basicScoring: ScoringRule = (ctx) => {
  const buried = ctx.kitty.reduce((a, c) => a + cardPoints(c), 0);
  const declarerPoints = ctx.declarerTrickPoints + buried;
  const defenderPoints = ctx.defenderTrickPoints;
  const success = declarerPoints >= ctx.bid;
  const winnerSide = success ? ctx.declarerSide : 1 - ctx.declarerSide;
  return {
    bid: ctx.bid,
    declarer: ctx.declarer,
    trump: ctx.trump,
    declarerPoints,
    defenderPoints,
    buriedPoints: buried,
    success,
    winnerSide,
  };
};

export const DEFAULT_RULES: RuleConfig = {
  minBid: 70,
  bidStep: 5,
  maxBid: 100,
  kittySize: 4,
  handSize: 12,
  targetWins: 5,
  scoring: basicScoring,
};
