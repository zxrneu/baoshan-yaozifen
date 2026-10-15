/** 音频入口只反映设置并调用回调；音效与报牌独立可控，不承担游戏操作。 */
import GameIcon from './GameIcon';
import styles from './AudioControls.module.css';

interface Props {
  soundMuted: boolean;
  speechEnabled: boolean;
  speechAvailable: boolean;
  onToggleSound: () => void;
  onToggleSpeech: () => void;
}

export default function AudioControls(props: Props) {
  return <div className={styles.controls} role="group" aria-label="声音设置">
    <button type="button" aria-label="操作音效" aria-pressed={!props.soundMuted} onClick={props.onToggleSound} title="选牌、出牌、叫分和吃分音效">
      <GameIcon name={props.soundMuted ? 'muted' : 'volume'} /><span>音效<small>{props.soundMuted ? '关' : '开'}</small></span>
    </button>
    <button type="button" aria-label="中文报牌" aria-pressed={props.speechAvailable && props.speechEnabled} onClick={props.onToggleSpeech} disabled={!props.speechAvailable} title={props.speechAvailable ? '中文播报叫分、定主和出牌' : '当前浏览器不支持语音报牌'}>
      <GameIcon name="speech" /><span>报牌<small>{!props.speechAvailable ? '不支持' : props.speechEnabled ? '开' : '关'}</small></span>
    </button>
  </div>;
}
