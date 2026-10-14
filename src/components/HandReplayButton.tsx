/** 本副复盘入口（SRP）：统一保存状态提示，确认保存后才允许读取真实记录。 */
import type { SaveState } from '../history/autosave';

export interface HandReplayProps {
  saveState?: SaveState;
  onReplay?: () => void;
}

export default function HandReplayButton({ saveState, onReplay }: HandReplayProps) {
  if (!onReplay) return null;
  const ready = saveState?.status === 'saved';
  const reason = saveState?.status === 'unsupported' ? '当前模式不支持历史复盘'
    : saveState?.status === 'error' ? '本副保存失败，请重试保存后复盘' : '本副记录保存中，保存完成后可复盘';
  return <>
    <button type="button" className="ghost-btn" disabled={!ready} onClick={onReplay}>复盘本副</button>
    {!ready && <span role="status">{reason}</span>}
  </>;
}
