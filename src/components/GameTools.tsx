/** 玩家工具栏只负责对局操作入口；依赖回调接口，工程能力由开发者设置与工作台提供。 */
import type { Phase } from '../engine';
import type { GameSpeed } from '../hooks/useGame';
import GameIcon from './GameIcon';
import styles from './GameTools.module.css';

interface Props {
  phase: Phase;
  completedTricks: number;
  speed: GameSpeed;
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
  /** 打开玩家设置与开发者参数；Debug 工作台也可从页头直接进入。 */
  onOpenSettings: () => void;
}

export default function GameTools(props: Props) {
  const nextSpeed: Record<GameSpeed, GameSpeed> = { fast: 'normal', normal: 'slow', slow: 'fast' };
  const speedLabel: Record<GameSpeed, string> = { fast: '快速', normal: '正常', slow: '慢速' };

  return (
    <nav className={styles.tools} aria-label="对局工具">
      <button type="button" onClick={props.onOpenHistory}><GameIcon name="history" /><span>出牌记录<small>{props.completedTricks} 轮</small></span></button>
      <button type="button" onClick={props.onOpenLedger}><GameIcon name="coins" /><span>分牌盘点</span></button>
      {props.phase === 'playing' && (
        <button type="button" disabled={props.completedTricks === 0} onClick={props.onOpenLastTrick}><GameIcon name="back" /><span>上一轮</span></button>
      )}
      <button type="button" onClick={() => props.onSpeedChange(nextSpeed[props.speed])} aria-label={`对局速度：${speedLabel[props.speed]}，点击切换`}>
        <GameIcon name="speed" /><span>速度<small>{speedLabel[props.speed]}</small></span>
      </button>
      {props.confirmBeforePlay !== undefined && props.onToggleConfirmBeforePlay && (
        <button
          type="button"
          onClick={props.onToggleConfirmBeforePlay}
          aria-pressed={props.confirmBeforePlay}
          className={props.confirmBeforePlay ? styles.activeGodMode : undefined}
          aria-label={`出牌二次确认设置：${props.confirmBeforePlay ? '开' : '关'}${props.isConfirmForced ? '（调试模式强制开启）' : ''}，点击切换`}
          title={props.isConfirmForced
            ? '设置已保存，但调试模式下强制确认（点牌选中→再点同一张出牌），以免单击误推进单步'
            : props.confirmBeforePlay ? '当前：点牌选中，再点同一张出牌（防误触）' : '当前：点牌即出，无需二次确认'}
        >
          <GameIcon name="check" /><span>出牌确认<small>{props.confirmBeforePlay ? '开' : '关'}{props.isConfirmForced ? '（调试强制）' : ''}</small></span>
        </button>
      )}
      <button type="button" onClick={props.onOpenSettings} aria-label="打开设置" title="设置（含开发者选项）">
        <GameIcon name="settings" /><span>设置</span>
      </button>
      <button type="button" onClick={props.onOpenRules}><GameIcon name="book" /><span>规则</span></button>
    </nav>
  );
}
