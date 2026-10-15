import { describe, it, expect, beforeEach } from 'vitest';
import { soundManager } from '@yaozifen/web/audio/soundManager';
import { thinkingService } from '@yaozifen/ai-core/engines/thinkingService';
import { createGame, bid, currentSeat, sideOf, SEAT_NAMES } from '@yaozifen/game-core';

describe('Web Audio 音效管理器 (soundManager)', () => {
  beforeEach(() => {
    soundManager.setMuted(false);
  });

  it('支持静音与恢复，并能正确读取当前状态', () => {
    expect(soundManager.isMuted()).toBe(false);
    soundManager.toggleMute();
    expect(soundManager.isMuted()).toBe(true);
    soundManager.setMuted(false);
    expect(soundManager.isMuted()).toBe(false);
  });

  it('在无真实音频环境或静音状态下，音效函数调用安全不崩溃', () => {
    soundManager.setMuted(true);
    expect(() => soundManager.playCard()).not.toThrow();
    expect(() => soundManager.selectCard()).not.toThrow();
    expect(() => soundManager.trickWin()).not.toThrow();
    expect(() => soundManager.trumpKill()).not.toThrow();
    expect(() => soundManager.bidding()).not.toThrow();
    expect(() => soundManager.victory()).not.toThrow();
  });
});

describe('实时思维流服务 (thinkingService)', () => {
  beforeEach(() => {
    thinkingService.clear();
  });

  it('支持思考状态发布与订阅者通知', () => {
    const states: any[] = [];
    const unsubscribe = thinkingService.subscribe((s) => {
      states.push(s);
    });

    thinkingService.startThinking(1, '正在进行深度推演...');
    expect(states[states.length - 1].phase).toBe('thinking');
    expect(states[states.length - 1].seat).toBe(1);

    thinkingService.updateThinking(1, '分析同伴出牌意图...');
    expect(states[states.length - 1].text).toBe('分析同伴出牌意图...');

    thinkingService.finishThinking(1, '选出主牌方块A');
    expect(states[states.length - 1].phase).toBe('decided');
    expect(states[states.length - 1].conclusion).toBe('选出主牌方块A');

    unsubscribe();
  });
});

describe('正方形上帝模式牌桌座位几何与叫分逻辑', () => {
  it('四方座位对应关系：0=东, 1=南, 2=西, 3=北', () => {
    expect(SEAT_NAMES[0]).toBe('东');
    expect(SEAT_NAMES[1]).toBe('南');
    expect(SEAT_NAMES[2]).toBe('西');
    expect(SEAT_NAMES[3]).toBe('北');

    // 南北同队 (1)，东西同队 (0)
    expect(sideOf(1)).toBe(1);
    expect(sideOf(3)).toBe(1);
    expect(sideOf(0)).toBe(0);
    expect(sideOf(2)).toBe(0);
  });

  it('一步到位直接叫分验证：点击叫分直接更新状态而无需二次确认', () => {
    let game = createGame(12345);
    expect(game.phase).toBe('bidding');
    const firstBidder = currentSeat(game);
    
    // 直接叫 75
    game = bid(game, firstBidder, 75);
    expect(game.highestBid).toBe(75);
    expect(game.highestBidder).toBe(firstBidder);
  });
});
