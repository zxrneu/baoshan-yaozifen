/** 动作与会话身份契约（ISP / DIP）：只依赖规则类型，供 AI、历史和会话共用。 */
import type { Card, Suit } from "@yaozifen/game-core/cards";
import type { GameState } from "@yaozifen/game-core";

export type AiAction =
  | { kind: 'bid'; seat: number; bid: number | null }
  | { kind: 'trump'; seat: number; trump: Suit }
  | { kind: 'bury'; seat: number; cards: Card[] }
  | { kind: 'play'; seat: number; card: Card };

export interface DecisionContext {
  sessionId: string;
  nodeId: string;
  epoch: number;
  configRevision: number;
  requestId: string;
  purpose: 'prefetch' | 'hint' | 'step' | 'auto';
}

export interface SessionCursor {
  sessionId: string;
  nodeId: string;
  epoch: number;
  configRevision: number;
}
export type SessionCommand = AiAction | { kind: 'nextHand' };
export interface SessionCommit {
  command: SessionCommand;
  source: 'human' | 'manual' | 'ai' | 'hint';
  from: SessionCursor;
  to: SessionCursor;
  requestId?: string;
  before: GameState;
  after: GameState;
}
