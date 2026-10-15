import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SquareTable from '../src/components/SquareTable';
import DebugSidePanel from '../src/components/DebugSidePanel';
import { createGame, bid, legalMoves } from '../src/engine';
import { decisionLogger } from '../src/ai/engines/decisionLogger';
import { thinkingService } from '../src/ai/engines/thinkingService';

describe('上帝调试模式牌桌与超宽控制台自测 (Debug Mode Integration)', () => {
  beforeEach(() => {
    decisionLogger.clear();
    thinkingService.clear();
  });

  it('SquareTable 默认朝向各自玩家：西家东家垂直旋转朝向桌面，北家180度，各牌角标清晰', () => {
    const game = createGame(12345);
    // 强制进入出牌阶段
    game.phase = 'playing';
    game.declarer = 1;
    game.trump = 'S';
    game.trickNumber = 1;

    const html = renderToStaticMarkup(
      React.createElement(SquareTable, {
        game,
        humanSeat: 1,
        seat: 1,
        selectedPlayCard: null,
        aiHintCard: null,
        selectedBuryCards: [],
        bidOptions: [75, 80],
        onHumanCardClick: () => {},
        onManualPlaySeat: () => {},
        confirmPlayCard: () => {},
        doBid: () => {},
        doTrump: () => {},
        doBury: () => {},
        autoSelectBury: () => {},
        clearSelectedBury: () => {},
        goNextHand: () => {},
        restart: () => {},
      })
    );

    // 检查是否包含朝向各自玩家的西家列、东家列与北家横排
    expect(html).toContain('handColWest');
    expect(html).toContain('cardWrapperWest');
    expect(html).toContain('handColEast');
    expect(html).toContain('cardWrapperEast');
    expect(html).toContain('handRowNorth');
    expect(html).toContain('cardWrapperNorth');
    // 固定朝向行动者，取消观察者朝向切换。
    expect(html).not.toContain('orientationToggleBtn');
    // 检查东西南北四个座位的名称均已完整渲染
    expect(html).toContain('北');
    expect(html).toContain('南');
    expect(html).toContain('西');
    expect(html).toContain('东');
    // 出牌阶段应包含中央出牌插槽
    expect(html).toContain('trickSquare');
  });

  it('SquareTable 观战也保持四家各自朝向，东西牌列连续且头像在外侧', () => {
    const game = createGame(12345);
    game.phase = 'playing';
    game.declarer = 1;
    game.trump = 'S';
    game.trickNumber = 1;

    const html = renderToStaticMarkup(
      React.createElement(SquareTable, {
        game,
        humanSeat: 1,
        seat: 1,
        selectedPlayCard: null,
        aiHintCard: null,
        selectedBuryCards: [],
        bidOptions: [75, 80],
        interactive: false,
        onHumanCardClick: () => {},
        onManualPlaySeat: () => {},
        confirmPlayCard: () => {},
        doBid: () => {},
        doTrump: () => {},
        doBury: () => {},
        autoSelectBury: () => {},
        clearSelectedBury: () => {},
        goNextHand: () => {},
        restart: () => {},
      })
    );

    expect(html).toContain('handColWest');
    expect(html).toContain('handColEast');
    for (const [seat, angle] of [[0, -90], [2, 90]]) {
      expect(html).toContain(`data-seat-header="${seat}" style="transform:rotate(${angle}deg)"`);
      expect(html).toContain(`data-seat-identity="${seat}"`);
    }
    expect(html).not.toContain('sideHandAnchor');
    expect(html).not.toContain('sideHandContainer');
    expect(html).not.toContain('sideHandRow');
  });

  it('SquareTable 叫分阶段：不应渲染出牌插槽，且座位头显示叫分标记', () => {
    let game = createGame(12345);
    game = bid(game, game.bidOrder[0], 75);

    const html = renderToStaticMarkup(
      React.createElement(SquareTable, {
        game,
        humanSeat: 1,
        seat: game.bidOrder[1],
        selectedPlayCard: null,
        aiHintCard: null,
        selectedBuryCards: [],
        bidOptions: [80, 85],
        onHumanCardClick: () => {},
        onManualPlaySeat: () => {},
        confirmPlayCard: () => {},
        doBid: () => {},
        doTrump: () => {},
        doBury: () => {},
        autoSelectBury: () => {},
        clearSelectedBury: () => {},
        goNextHand: () => {},
        restart: () => {},
      })
    );

    // 叫分阶段中央不应有出牌十字槽 trickSquare
    expect(html).not.toContain('trickSquare');
    // 叫过 75 分的玩家座位头上应有对应徽标
    expect(html).toContain('叫 75');
  });

  it('DebugSidePanel 直接展示全部诊断信息，不显示页签或绝门记牌', () => {
    const game = createGame(12345);
    game.phase = 'playing';
    game.declarer = 1;
    game.trump = 'H';
    game.trickNumber = 2;

    // 写入一条模拟决策记录
    decisionLogger.record({
      seat: 2,
      engineType: 'bridge',
      roundNumber: 1,
      trickNumber: 1,
      ownHand: [...game.hands[2]],
      currentRound: [],
      candidates: [...game.hands[2]],
      chosenCard: game.hands[2][0],
      latencyMs: 42,
      thinking: '位棋盘 DDS 深度推演：分析残局控制权...',
      conclusion: '选出主牌红心K',
      searchWinRate: 0.88,
      candidateEvaluations: [
        { card: game.hands[2][0], winRate: 0.88, expectedPoints: 4.5, isChosen: true },
      ],
    });

    const html = renderToStaticMarkup(
      React.createElement(DebugSidePanel, {
        game,
        seat: 1,
        actorEngineLabel: '桥牌 Bridge（DDS）',
        isStepMode: true,
        isThinking: false,
        pendingAiAction: null,
        aiHintAction: null,
        stepNext: async () => {},
        triggerAiHint: async () => {},
        manualPlaySeat: () => {},
        undo: () => true,
        canUndo: true,
        restart: () => {},
        onOpenEngineSettings: () => {},
        onOpenDecisionLog: () => {},
      })
    );

    // 检查常驻诊断信息，直接看牌无需额外记牌面板。
    expect(html).toContain('思维推演');
    expect(html).toContain('候选比选');
    expect(html).not.toContain('绝门记牌');
    expect(html).toContain('历史追溯');
    expect(html).toContain('沙盒工具');
    expect(html).not.toContain('role="tab"');

    // 检查常驻元素：Next 按钮、只读座位引擎提示、撤销按钮
    expect(html).toContain('下一步');
    expect(html).toContain('桥牌 Bridge（DDS）');
    expect(html).not.toContain('<select');
    expect(html).toContain('撤销一步');
  });

  it('出牌与合法走法在候选评估中的计算守恒', () => {
    const game = createGame(54321);
    game.phase = 'playing';
    game.declarer = 0;
    game.trump = 'D';
    game.leader = 0;

    const legals = legalMoves(game, 0);
    expect(legals.length).toBeGreaterThan(0);
    // 第一家引牌可出任意手牌
    expect(legals.length).toBe(game.hands[0].length);
  });

  it('叫分面板按钮仅显示纯数字（无“分”字后缀），北家手牌具备横排 handRow 布局类', () => {
    let game = createGame(12345);
    const html = renderToStaticMarkup(
      React.createElement(SquareTable, {
        game,
        humanSeat: 1,
        seat: 1,
        selectedPlayCard: null,
        aiHintCard: null,
        selectedBuryCards: [],
        bidOptions: [70, 75, 80],
        onHumanCardClick: () => {},
        onManualPlaySeat: () => {},
        confirmPlayCard: () => {},
        doBid: () => {},
        doTrump: () => {},
        doBury: () => {},
        autoSelectBury: () => {},
        clearSelectedBury: () => {},
        goNextHand: () => {},
        restart: () => {},
      })
    );

    // 叫分按钮直接显示数字
    expect(html).toContain('>70</button>');
    expect(html).toContain('>75</button>');
    expect(html).toContain('>80</button>');
    expect(html).not.toContain('>70 分</button>');

    // 北家手牌容器必须具有 handRow 与 handRowNorth
    expect(html).toMatch(/class="[^"]*handRow[^"]*handRowNorth[^"]*"/);
  });
});

