/**
 * 玩家头顶流式思考状态服务（SRP：只负责维护与分发当前思考流状态）。
 * 支持单例全局订阅与多座位隔离。
 */
import { Card } from '../../cards';
import { ThinkingPhase } from './engineTypes';

export interface ThinkingState {
  seat: number | null;
  phase: ThinkingPhase;
  text: string;
  conclusion?: string;
  chosenCard?: Card;
  startedAt?: number;
}

export class ThinkingService {
  private state: ThinkingState = {
    seat: null,
    phase: 'idle',
    text: '',
  };
  private readonly listeners: Set<(state: ThinkingState) => void> = new Set();
  private clearTimer: any = null;

  getState(): ThinkingState {
    return { ...this.state };
  }

  subscribe(listener: (state: ThinkingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const current = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(current);
      } catch (err) {
        console.error('ThinkingService 监听异常:', err);
      }
    });
  }

  startThinking(seat: number, initialText = ''): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.state = {
      seat,
      phase: 'thinking',
      text: initialText,
      startedAt: Date.now(),
    };
    this.notify();
  }

  updateThinking(seat: number, text: string): void {
    if (this.state.seat !== seat) return;
    this.state = {
      ...this.state,
      phase: 'thinking',
      text,
    };
    this.notify();
  }

  finishThinking(seat: number, conclusion?: string, chosenCard?: Card): void {
    if (this.state.seat !== seat) return;
    this.state = {
      ...this.state,
      phase: 'decided',
      conclusion,
      chosenCard,
    };
    this.notify();

    // 停留 1.8 秒后淡出气泡
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.clear(seat);
    }, 1800);
  }

  clear(seat?: number): void {
    if (seat !== undefined && this.state.seat !== seat) return;
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.state = {
      seat: null,
      phase: 'idle',
      text: '',
    };
    this.notify();
  }
}

export const thinkingService = new ThinkingService();
