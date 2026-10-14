// @vitest-environment happy-dom
/** 交互原型回归：从独立 HTML 启动真实事件，验证可观察的选牌和信息披露边界。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'docs/ui/interaction-prototype.html'), 'utf8');
beforeEach(() => {
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('原型缺少启动脚本');
  new Function('document', script)(document);
});
afterEach(() => { document.body.innerHTML = ''; });
const card = (id: string) => document.querySelector<HTMLButtonElement>(`[data-card="${id}"]`)!;
const confirm = () => document.querySelector<HTMLButtonElement>('#confirm')!;
function select(id: string, value: string) {
  const input = document.querySelector<HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('游戏 UI 设计原型', () => {
  it('有黑桃时只能选黑桃，先选牌再确认，重复确认不会出第二张牌', () => {
    expect(card('H10').disabled).toBe(true);
    card('H10').click();
    expect(confirm().disabled).toBe(true);
    card('SA').click();
    expect(card('SA').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#trick')?.textContent).not.toContain('A♠');
    expect(confirm().disabled).toBe(false);
    confirm().click();
    expect(document.querySelector('#trick')?.textContent).toContain('A♠');
    expect(document.querySelector('#turn-label')?.textContent).toBe('等待东家');
    expect(card('SK').getAttribute('aria-label')).toContain('等待东家，当前不能行动');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(11);
    confirm().click();
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(11);
  });

  it('切换扣底阶段清除出牌选择，分牌禁选，恰好四张才可提交并回到十二张手牌', () => {
    card('SA').click();
    select('phase', 'bury');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(16);
    expect(document.querySelectorAll('#hand [aria-pressed="true"]')).toHaveLength(0);
    expect(card('SA').disabled).toBe(true);
    expect(card('H10').disabled).toBe(true);
    expect(card('D5').disabled).toBe(true);
    ['S7', 'H2', 'C4'].forEach(id => card(id).click());
    expect(confirm().disabled).toBe(true);
    card('D3').click();
    expect(confirm().disabled).toBe(false);
    card('SK').click();
    expect(document.querySelectorAll('#hand [aria-pressed="true"]')).toHaveLength(4);
    confirm().click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('playing');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    expect(card('S7')).toBeNull();
  });

  it('叫分档位与定主选择有明确反馈，定主后拿底进入扣底', () => {
    select('phase', 'bidding');
    const bid = document.querySelector<HTMLButtonElement>('[data-bid="90"]');
    expect(bid).not.toBeNull();
    bid!.click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('trump');
    document.querySelector<HTMLButtonElement>('[data-trump="H"]')!.click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('bury');
    expect(document.querySelector('#trump-label')?.textContent).toContain('红桃');
    expect(document.querySelector('#contract-label')?.textContent).toContain('90');
    expect(document.querySelector('#their-target')?.textContent).toContain('15');
  });

  it('100 分局叫分、定主、扣底均不公开搭档，只有成功扣底后公开，重置后隐藏', () => {
    select('phase', 'bidding');
    select('contract', '100');
    const revealed = () => document.querySelector<HTMLDivElement>('#revealed')!;
    expect(revealed().hidden).toBe(true);
    expect(revealed().textContent).toBe('');
    document.querySelector<HTMLButtonElement>('[data-bid="100"]')!.click();
    expect(revealed().hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-trump="S"]')!.click();
    ['S7', 'H2', 'C4'].forEach(id => card(id).click());
    confirm().click();
    expect(revealed().hidden).toBe(true);
    expect(revealed().textContent).toBe('');
    card('D3').click();
    confirm().click();
    expect(revealed().hidden).toBe(false);
    expect(revealed().textContent).toContain('搭档明牌');
    expect(document.querySelector('#their-target')?.textContent).toContain('5');
    select('phase', 'bury');
    expect(revealed().hidden).toBe(true);
    expect(revealed().textContent).toBe('');
    select('contract', '85');
    ['S7', 'H2', 'C4', 'D3'].forEach(id => card(id).click());
    confirm().click();
    expect(revealed().hidden).toBe(true);
  });

  it('结算区分本副吃分与整场胜副，保留余牌但不能继续出牌', () => {
    select('phase', 'result');
    expect(document.querySelector('.match-score')?.getAttribute('aria-label')).toContain('南北队三胜');
    expect(document.querySelector('#our-score')?.textContent).toBe('85');
    expect(document.querySelector('#ledger')?.textContent).toContain('已吃 85 + 未打出 15 + 底牌 0 = 100 分');
    expect(card('SK').disabled).toBe(true);
    expect(confirm().textContent).toContain('下一副');
    confirm().click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('bidding');
    // 各阶段是独立样例，重新体验不会累计样例中的胜副。
    expect(document.querySelector('.match-score')?.getAttribute('aria-label')).toContain('南北队二胜');
  });

  it('调试默认仅看南家，逐座看牌不扩散到 AI 观察，退出时清理临时透视', () => {
    select('mode', 'debug');
    expect(document.querySelector('#table')?.getAttribute('data-mode')).toBe('debug');
    const before = document.querySelector('#debug-observation')?.textContent;
    expect(before).toContain('ownHand');
    expect(document.querySelector('[data-debug-hand="0"]')?.textContent).toContain('暗牌');
    document.querySelector<HTMLButtonElement>('[data-peek="0"]')!.click();
    expect(document.querySelector('[data-debug-hand="0"]')?.textContent).toContain('K♣');
    expect(document.querySelector('#debug-observation')?.textContent).toBe(before);
    expect(before).not.toContain('"seed"');
    select('mode', 'player');
    expect(document.querySelector('#debug-hands')?.textContent).toBe('');
    expect(document.querySelector<HTMLDivElement>('#debug-panel')?.hidden).toBe(true);
    select('mode', 'debug');
    expect(document.querySelector('[data-debug-hand="0"]')?.textContent).toContain('暗牌');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
  });

  it('调试建议只评估，显式应用后可撤销恢复，并清除失效的建议', () => {
    select('mode', 'debug');
    document.querySelector<HTMLButtonElement>('#debug-hint')!.click();
    expect(document.querySelector('#debug-status')?.textContent).toContain('已决定');
    expect(document.querySelector('#trick')?.textContent).not.toContain('K♠');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    document.querySelector<HTMLButtonElement>('#debug-apply')!.click();
    expect(document.querySelector('#trick')?.textContent).toContain('K♠');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(11);
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    expect(document.querySelector('#trick')?.textContent).not.toContain('K♠');
    expect(document.querySelector<HTMLButtonElement>('#debug-apply')!.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('#debug-redo')!.click();
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(11);
    expect(document.querySelector('#trick')?.textContent).toContain('K♠');
  });

  it('调试看牌与规则明牌分别标注，100 分扣底后的搭档明牌不能收起', () => {
    select('phase', 'bury');
    select('contract', '100');
    select('mode', 'debug');
    expect(document.querySelector('[data-debug-hand="3"]')?.textContent ?? '').toContain('暗牌');
    ['S7', 'H2', 'C4', 'D3'].forEach(id => card(id).click());
    confirm().click();
    expect(document.querySelector('[data-debug-hand="3"]')?.textContent).toContain('规则明牌');
    expect(document.querySelector<HTMLButtonElement>('[data-peek="3"]')?.disabled).toBe(true);
    select('mode', 'player');
    expect(document.querySelector<HTMLDivElement>('#revealed')?.hidden).toBe(false);
  });

  it('诊断页签可用键盘切换，候选选牌不提交，收起南家手牌后不留下牌面', () => {
    select('mode', 'debug');
    const first = document.querySelector<HTMLButtonElement>('#debug-tab-think')!;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.querySelector('#debug-tab-candidates')?.getAttribute('aria-selected')).toBe('true');
    document.querySelector<HTMLButtonElement>('[data-candidate="SK"]')!.click();
    expect(card('SK').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#trick')?.textContent).not.toContain('K♠');
    document.querySelector<HTMLButtonElement>('[data-peek="1"]')!.click();
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(0);
    expect(document.querySelector('#hand')?.textContent).toContain('暗牌');
    expect(confirm().disabled).toBe(true);
  });

  it('调试单步先准备动作再执行，切换阶段后不能应用旧建议', () => {
    select('mode', 'debug');
    document.querySelector<HTMLButtonElement>('#debug-step')!.click();
    expect(document.querySelector<HTMLButtonElement>('#debug-apply')!.disabled).toBe(false);
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    document.querySelector<HTMLButtonElement>('#debug-step')!.click();
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(11);
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    document.querySelector<HTMLButtonElement>('#debug-hint')!.click();
    select('phase', 'trump');
    expect(document.querySelector<HTMLButtonElement>('#debug-apply')!.disabled).toBe(true);
    expect(document.querySelector('#debug-status')?.textContent).toContain('等待决定');
  });

  it('调试建议可以推进叫分定主扣底，并逐步撤销到原阶段和手牌', () => {
    select('phase', 'bidding');
    select('mode', 'debug');
    const apply = () => {
      document.querySelector<HTMLButtonElement>('#debug-hint')!.click();
      document.querySelector<HTMLButtonElement>('#debug-apply')!.click();
    };
    apply();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('trump');
    expect(document.querySelector<HTMLButtonElement>('#debug-undo')!.disabled).toBe(false);
    apply();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('bury');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(16);
    apply();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('playing');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('bury');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(16);
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('trump');
    expect(document.querySelectorAll('#hand [data-card]')).toHaveLength(12);
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    expect(document.querySelector('#table')?.getAttribute('data-phase')).toBe('bidding');
    expect(document.querySelector<HTMLButtonElement>('#debug-undo')!.disabled).toBe(true);
  });

  it('出牌后行动提示转到东家，撤销回南家，结算不再显示等待决定', () => {
    select('mode', 'debug');
    expect(document.querySelector('.south')?.getAttribute('data-active')).toBe('true');
    card('SK').click();
    confirm().click();
    expect(document.querySelector('.east')?.getAttribute('data-active')).toBe('true');
    expect(document.querySelector('.south')?.getAttribute('data-active')).toBe('false');
    expect(document.querySelector('[data-debug-hand="0"] strong')?.textContent).toContain('当前行动座位');
    expect(document.querySelector('[data-debug-hand="1"] strong')?.textContent).not.toContain('当前行动座位');
    document.querySelector<HTMLButtonElement>('#debug-undo')!.click();
    expect(document.querySelector('.south')?.getAttribute('data-active')).toBe('true');
    select('phase', 'result');
    expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(0);
    expect(document.querySelector('#debug-status')?.textContent).toContain('本副结束');
  });
});
