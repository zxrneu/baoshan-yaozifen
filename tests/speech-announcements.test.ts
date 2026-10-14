// @vitest-environment happy-dom
/** 语音回归使用显式浏览器适配，覆盖中文报牌、静音及私有牌面不外播。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import { announcementForAction, SpeechManager } from '../src/audio/speechManager';

const speak = vi.fn(); const cancel = vi.fn();
beforeEach(() => {
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [{ name: '本地中文', lang: 'zh-CN', localService: true }] });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = ''; rate = 1; voice = null;
    constructor(public text: string) {}
  });
  speak.mockClear(); cancel.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it('公开出牌使用中文花色读数，叫分和定主播报已公开结论', () => {
  expect(announcementForAction({ kind: 'play', seat: 0, title: '东家跟牌 10♥', cards: [{ suit: 'H', rank: '10' }] })).toBe('东家，红桃十');
  expect(announcementForAction({ kind: 'bid', seat: 1, title: '南家叫 85 分', cards: [] })).toBe('南家叫 85 分');
  expect(announcementForAction({ kind: 'trump', seat: 1, title: '南家定主 黑桃', cards: [] })).toBe('南家定主 黑桃');
});

it('底牌与扣底即使有可见牌面也不报出具体牌，只有真正出牌才读牌', () => {
  for (const kind of ['kittyReveal', 'kittyPickup', 'bury', 'partnerReveal', 'deal'] as const) {
    expect(announcementForAction({ kind, seat: 0, title: '阶段动作', cards: [{ suit: 'S', rank: 'A' }] })).toBe('');
  }
});

it('用户操作解锁后采用中文语音，每次新播报清掉旧队列，关闭时立刻停止并保存偏好', () => {
  const manager = new SpeechManager();
  expect(manager.isAvailable()).toBe(true);
  manager.announce('东家，黑桃A'); expect(speak).not.toHaveBeenCalled();
  manager.unlock(); manager.announce('东家，黑桃A');
  expect(speak).toHaveBeenCalledOnce();
  const utterance = speak.mock.calls[0][0] as SpeechSynthesisUtterance;
  expect(utterance.text).toBe('东家，黑桃A'); expect(utterance.lang).toBe('zh-CN'); expect(utterance.voice?.name).toBe('本地中文');
  manager.announce('南家，红桃十'); expect(cancel).toHaveBeenCalledTimes(2);
  manager.setEnabled(false); expect(cancel).toHaveBeenCalledTimes(3);
  manager.announce('不会播放'); expect(speak).toHaveBeenCalledTimes(2);
  expect(new SpeechManager().isEnabled()).toBe(false);
});

it('语音不可用或浏览器拒绝播放时安全降级，保留文字和音效操作', () => {
  vi.stubGlobal('speechSynthesis', undefined);
  const manager = new SpeechManager(); expect(manager.isAvailable()).toBe(false);
  expect(() => { manager.unlock(); manager.announce('东家叫分'); manager.stop(); }).not.toThrow();
  vi.stubGlobal('speechSynthesis', { speak: () => { throw new Error('显式拒绝播放'); }, cancel, getVoices: () => [] });
  expect(() => { manager.unlock(); manager.announce('南家叫分'); }).not.toThrow();
});
