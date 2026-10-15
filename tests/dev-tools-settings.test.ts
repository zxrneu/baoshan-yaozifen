/**
 * T1.2 回归测试：开发者功能收进「设置 → 开发者选项」。
 *
 * 玩家工具栏只提供普通入口；设置分层与禁用状态用静态渲染检查。
 * 完整 App 的模式切换和透视清理由 dev-tools-interaction.test.ts 覆盖。
 *
 * 沿用 `tests/play-interaction.test.ts` 的 `renderToStaticMarkup` 模式，不引入组件测试框架。
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GameTools from '@yaozifen/web/components/GameTools';
import EngineSettingsModal from '@yaozifen/web/components/EngineSettingsModal';

/** GameTools 的公共 props，测试中按需覆盖。 */
const TOOLS_BASE: React.ComponentProps<typeof GameTools> = {
  phase: 'playing' as const,
  completedTricks: 2,
  speed: 'normal' as const,
  onSpeedChange: () => {},
  onOpenHistory: () => {},
  onOpenLedger: () => {},
  onOpenLastTrick: () => {},
  onOpenRules: () => {},
  onOpenSettings: () => {},
};

function renderTools(): string {
  return renderToStaticMarkup(React.createElement(GameTools, TOOLS_BASE));
}

/** 渲染设置弹窗；`initialLayer` 决定落在哪一层。 */
function renderSettings(initialLayer: 'player' | 'developer', overrides: Partial<React.ComponentProps<typeof EngineSettingsModal>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(EngineSettingsModal, {
      activeType: 'bridge',
      onClose: () => {},
      isDebugMode: false,
      onToggleDebugMode: () => {},
      initialLayer,
      ...overrides,
    }),
  );
}

describe('T1.2 · 玩家工具栏不含工程入口', () => {
  it('玩家工具栏不出现决策日志 / AI 引擎 / 全明手', () => {
    const html = renderTools();
    expect(html).not.toContain('决策日志');
    expect(html).not.toContain('AI 引擎');
    expect(html).not.toContain('全明手');
  });

  it('普通模式仍保留全部玩家功能与设置入口', () => {
    const html = renderTools();
    expect(html).toContain('出牌记录');
    expect(html).toContain('分牌盘点');
    expect(html).toContain('上一轮');
    expect(html).toContain('速度');
    expect(html).toContain('aria-label="打开设置"');
    expect(html).toContain('规则');
  });
});

describe('T1.2 · 设置弹窗分层', () => {
  it('玩家设置说明逐座入口，并使用明确的引擎与计算术语名称', () => {
    const html = renderSettings('player');
    expect(html).toContain('点击牌桌上每家玩家的引擎名称');
    for (const name of ['大模型 LLM', 'System One（Laya）', '桥牌 Bridge（DDS）', '推演算法（Worker）']) {
      expect(html).toContain(name);
    }
    for (const name of ['推演型', '规则型', '策略型', '思考型']) expect(html).not.toContain(name);
  });

  it('默认玩家层：不外露模型端点、密钥、协议等工程字段', () => {
    const html = renderSettings('player');
    expect(html).not.toContain('openai_api_base');
    expect(html).not.toContain('qwen38_27b');
    expect(html).not.toContain('reasoning_effort');
    expect(html).not.toContain('TypeSafe API 服务地址');
    expect(html).not.toContain('API 密钥');
  });

  it('默认玩家层：标题为通用「设置」而非 AI 引擎配置', () => {
    const html = renderSettings('player');
    expect(html).toContain('⚙️ 设置');
    expect(html).not.toContain('AI 决策引擎与模型服务配置');
  });

  it('两个层级页签始终可见，玩家可自行切到开发者选项', () => {
    const html = renderSettings('player');
    expect(html).toContain('玩家设置');
    expect(html).toContain('开发者选项');
  });

  it('开发者选项层：工程字段全部出现', () => {
    const html = renderSettings('developer');
    expect(html).toContain('openai_api_base');
    expect(html).toContain('qwen38_27b');
    expect(html).toContain('reasoning_effort');
    expect(html).toContain('TypeSafe API 服务地址');
    expect(html).toContain('API 密钥');
  });

  it('开发者设置说明座位看牌入口，不再要求透视权限或提供全明手开关', () => {
    for (const isDebugMode of [false, true]) {
      const html = renderSettings('developer', { isDebugMode });
      expect(html).toContain('看牌／关牌');
      expect(html).toContain('四家');
      expect(html).not.toContain('godModeCheck');
      expect(html).not.toContain('全明手');
      expect(html).not.toContain('始终展示四家手牌');
    }
  });
});
