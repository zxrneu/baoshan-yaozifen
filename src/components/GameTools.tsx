import type { Phase } from '../engine';
import type { GameSpeed } from '../hooks/useGame';
import type { EngineType } from '../ai/engines/engineTypes';
import styles from './GameTools.module.css';

interface Props {
  phase: Phase;
  completedTricks: number;
  speed: GameSpeed;
  engineType: EngineType;
  decisionCount?: number;
  godModeEnabled?: boolean;
  isAllPeeked?: boolean;
  isGodMode?: boolean;
  /** 出牌二次确认的玩家设置开关状态；未传则不渲染该玩家功能 */
  confirmBeforePlay?: boolean;
  /**
   * 调试模式下实际生效的策略恒为 true（保证单步不被单击误推进）。
   * 与 `confirmBeforePlay`（设置值）可能不同，用于把「设置已关但实际仍要确认」
   * 如实呈现给玩家，避免界面与行为不一致。
   */
  isConfirmForced?: boolean;
  onToggleConfirmBeforePlay?: () => void;
  onSpeedChange: (speed: GameSpeed) => void;
  onOpenHistory: () => void;
  onOpenLedger: () => void;
  onOpenLastTrick: () => void;
  onOpenRules: () => void;
  onOpenEngineSettings: () => void;
  onOpenDecisionLog: () => void;
  onToggleGodMode?: () => void;
  onToggleAllPeek?: () => void;
}

export default function GameTools(props: Props) {
  const nextSpeed: Record<GameSpeed, GameSpeed> = { fast: 'normal', normal: 'slow', slow: 'fast' };
  const speedLabel: Record<GameSpeed, string> = { fast: '快速', normal: '正常', slow: '慢速' };
  const engineLabel: Record<EngineType, string> = {
    bridge: '桥牌算法',
    algorithm: '传统算法',
    laya: 'Laya 模型',
    llm: '大语言模型',
  };

  const togglePeekHandler = props.onToggleAllPeek || props.onToggleGodMode;
  const isPeekActive = props.isAllPeeked ?? props.isGodMode ?? false;

  return (
    <nav className={styles.tools} aria-label="对局工具">
      <button type="button" onClick={props.onOpenHistory}>出牌记录 · {props.completedTricks}</button>
      <button type="button" onClick={props.onOpenLedger}>分牌盘点</button>
      {props.phase === 'playing' && (
        <button type="button" disabled={props.completedTricks === 0} onClick={props.onOpenLastTrick}>上一轮</button>
      )}
      <button type="button" onClick={() => props.onSpeedChange(nextSpeed[props.speed])} aria-label={`对局速度：${speedLabel[props.speed]}，点击切换`}>
        速度 · {speedLabel[props.speed]}
      </button>
      {props.confirmBeforePlay !== undefined && props.onToggleConfirmBeforePlay && (
        <button
          type="button"
          onClick={props.onToggleConfirmBeforePlay}
          className={props.confirmBeforePlay ? styles.activeGodMode : undefined}
          aria-label={`出牌二次确认设置：${props.confirmBeforePlay ? '开' : '关'}${props.isConfirmForced ? '（调试模式强制开启）' : ''}，点击切换`}
          title={props.isConfirmForced
            ? '设置已保存，但调试模式下强制确认（点牌选中→再点同一张出牌），以免单击误推进单步'
            : props.confirmBeforePlay ? '当前：点牌选中，再点同一张出牌（防误触）' : '当前：点牌即出，无需二次确认'}
        >
          出牌确认 · {props.confirmBeforePlay ? '开' : '关'}{props.isConfirmForced ? '（调试强制）' : ''}
        </button>
      )}
      <button type="button" onClick={props.onOpenDecisionLog} title="查看 AI 出牌思考与战术结论日志">
        🧠 决策日志{props.decisionCount !== undefined ? ` · ${props.decisionCount}` : ''}
      </button>
      <button type="button" onClick={props.onOpenEngineSettings} aria-label={`AI引擎：${engineLabel[props.engineType]}，点击配置`}>
        AI 引擎 · {engineLabel[props.engineType]}
      </button>
      {props.godModeEnabled && togglePeekHandler && (
        <button
          type="button"
          onClick={togglePeekHandler}
          className={isPeekActive ? styles.activeGodMode : undefined}
          title="上帝模式透视：点击一键看所有玩家手牌"
        >
          👀 全明手 {isPeekActive ? '开' : '关'}
        </button>
      )}
      <button type="button" onClick={props.onOpenRules}>规则</button>
    </nav>
  );
}
