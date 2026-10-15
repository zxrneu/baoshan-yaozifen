/**
 * 桥牌出牌算法核心领域类型与数据结构。
 */
import { Card, Suit } from '@yaozifen/game-core/cards';

/**
 * 4门花色索引映射：
 * 0: S (黑桃), 1: H (红桃), 2: D (方块), 3: C (梅花)
 */
export const SUIT_INDEX: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
export const INDEX_TO_SUIT: readonly Suit[] = ['S', 'H', 'D', 'C'] as const;

/**
 * 点数位掩码：2=0 (1<<0) ... A=12 (1<<12)
 * 13位掩码范围：0 ~ 0x1FFF (8191)
 */
export type CardMask = number;

/**
 * 单个玩家的手牌位棋盘表示：4 门花色的 13 位掩码
 */
export type HandBitboard = [CardMask, CardMask, CardMask, CardMask];

/**
 * 4家全场手牌位棋盘：4 个玩家，每家 4 门花色
 */
export type DealBitboard = [
  HandBitboard, // 座位 0 (东)
  HandBitboard, // 座位 1 (南)
  HandBitboard, // 座位 2 (西)
  HandBitboard, // 座位 3 (北)
];

/**
 * 桥牌战术意图标签
 */
export type BridgeTacticalIntent =
  | 'draw_trumps'        // 做庄拔主/清主
  | 'cash_winner'        // 兑现副牌坚强赢张
  | 'promote_suit'       // 树立长套
  | 'safe_exit'          // 安全脱手让权
  | 'second_hand_low'    // 第二手出小
  | 'third_hand_high'    // 第三手出大
  | 'feed_points'        // 安全喂分 (出10或5)
  | 'fourth_cheap_win'   // 第四手便宜拿
  | 'fourth_pitch'       // 第四手垫废牌
  | 'lock_victory'       // 达成获胜线锁定胜局
  | 'fallback';          // 默认策略

/**
 * 桥牌启发式决策建议
 */
export interface BridgeHeuristicAdvice {
  card: Card;
  intent: BridgeTacticalIntent;
  score: number;
  reason: string;
}

/**
 * DDS 双明手求解配置
 */
export interface DdsOptions {
  /** 最大搜索深度（轮数），0 表示穷举至终局 */
  maxDepth?: number;
  /** 节点数上限 */
  nodeLimit?: number;
  /** 启用置换表缓存 */
  useTransposition?: boolean;
  /** 当前正在进行的这一墩中已打出的牌（按顺序从领出者开始） */
  initialTrick?: readonly { seat: number; suitIdx: number; rankVal: number }[];
  /** 外部预算/取消检查；抛出时本世界不计入有效样本。 */
  check?: () => void;
}

/**
 * 深度思考配置
 */
export interface BridgeThinkingConfig {
  /** 思考模式：deep=深度思考 (150-250ms), fast=极速模式 (<20ms) */
  mode: 'deep' | 'fast';
  /** 采样可能世界数上限 */
  maxWorlds: number;
  /** 最小样本世界数 */
  minWorlds: number;
  /** 思考时间上限 (毫秒) */
  timeLimitMs: number;
  /** 残局精准求解触发手牌张数上限（默认 <= 6） */
  endgameCardLimit: number;
}

export const DEFAULT_DEEP_THINKING_CONFIG: BridgeThinkingConfig = {
  mode: 'deep',
  maxWorlds: 32,
  minWorlds: 16,
  timeLimitMs: 220,
  endgameCardLimit: 6,
};

export const DEFAULT_FAST_THINKING_CONFIG: BridgeThinkingConfig = {
  mode: 'fast',
  maxWorlds: 8,
  minWorlds: 4,
  timeLimitMs: 25,
  endgameCardLimit: 4,
};
