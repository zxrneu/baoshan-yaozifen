/** 中文播报边界只接收可见动作字段，语音状态与游戏规则解耦。 */
import type { ActionPresentation } from '../hooks/actionPresentation';
import { SUIT_NAME, type Rank } from '../cards';
import { SEAT_NAMES } from '../engine';

export type AnnouncementAction = Pick<ActionPresentation, 'kind' | 'title' | 'cards' | 'seat'>;

const RANK_SPEECH: Record<Rank, string> = {
  A: 'A', K: 'K', Q: 'Q', J: 'J', '10': '十', '9': '九', '8': '八',
  '7': '七', '6': '六', '5': '五', '4': '四', '3': '三', '2': '二',
};

export function announcementForAction(action: AnnouncementAction): string {
  if (action.kind === 'play') {
    const card = action.cards[0];
    if (!card || action.seat === undefined || !SEAT_NAMES[action.seat]) return '';
    return `${SEAT_NAMES[action.seat]}家，${SUIT_NAME[card.suit]}${RANK_SPEECH[card.rank]}`;
  }
  // 白名单只允许公开结论，绝不读取 detail、底牌或任何完整牌局状态。
  return ['bid', 'declarer', 'trump', 'collect', 'score', 'result'].includes(action.kind) ? action.title : '';
}

export class SpeechManager {
  private enabled = true;
  private unlocked = false;

  constructor() {
    try { this.enabled = localStorage.getItem('baoshan_speech_enabled') !== 'false'; } catch { /* 无存储时使用默认设置。 */ }
  }

  isEnabled(): boolean { return this.enabled; }
  isAvailable(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
    try { localStorage.setItem('baoshan_speech_enabled', String(enabled)); } catch { /* 设置仍在本次会话生效。 */ }
  }
  /** 必须在用户的鼠标、触摸或键盘事件中解锁，不自动播放首次加载的语音。 */
  unlock(): void { this.unlocked = this.isAvailable(); }
  announce(text: string): void {
    if (!this.enabled || !this.unlocked || !text || !this.isAvailable()) return;
    try {
      this.stop();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.15;
      const voices = speechSynthesis.getVoices();
      const chinese = voices.filter(voice => /^zh(?:-|_|$)/i.test(voice.lang));
      utterance.voice = chinese.find(voice => voice.localService && /^zh[-_]CN$/i.test(voice.lang))
        ?? chinese.find(voice => voice.localService) ?? chinese[0] ?? null;
      speechSynthesis.speak(utterance);
    } catch { /* 浏览器不支持或拒绝语音时，继续使用界面与操作音效。 */ }
  }
  stop(): void {
    if (!this.isAvailable()) return;
    try { speechSynthesis.cancel(); } catch { /* 清理失败不阻塞游戏。 */ }
  }
}

export const speechManager = new SpeechManager();
