// @vitest-environment happy-dom
/** 配置玩家入口（SRP）：真实组件选择四座配置并编辑版本参数。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EngineSettingsModal from '../src/components/EngineSettingsModal';
import { DecisionEngineManager } from '../src/ai/engines';
import { makeProfile, parseProfilesFile } from '../src/ai/engines/profiles';
const profiles = parseProfilesFile({ schemaVersion: 1, profiles: [
  { id: 'a', name: '快算甲', type: 'bridge', options: { mode: 'fast' } },
  { id: 'b', name: '快算乙', type: 'bridge', options: { mode: 'fast', maxWorlds: 12 } },
] }).profiles.map(definition => makeProfile(definition, definition.options));
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const manager = new DecisionEngineManager(); manager.setProfiles(profiles);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(React.createElement(EngineSettingsModal, { manager, activeType: 'bridge', onSelectType: vi.fn(), onClose: vi.fn(), isDebugMode: false, onToggleDebugMode: vi.fn(), godModeEnabled: false, isAllPeeked: false, onToggleAllPeek: vi.fn() })));
  const click = async (name: string) => { const button = [...host.querySelectorAll('button')].find(value => value.textContent?.trim() === name); expect(button).toBeDefined(); await act(async () => button!.click()); };
  const select = async (label: string, value: string) => { const element = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`); expect(element).not.toBeNull(); await act(async () => { element!.value = value; element!.dispatchEvent(new Event('change', { bubbles: true })); }); };
  return { host, manager, click, select };
}
describe('多配置设置界面', () => {
  it('玩家界面每座可选 Human 或任意配置，同类型不同名称可分配两队', async () => {
    const { host, manager, select, click } = await mount();
    await select('东家配置', 'human'); expect(manager.isHumanSeat(0)).toBe(true);
    await select('南北队配置', 'a'); await select('东西队配置', 'b'); await click('应用两队配置');
    expect(manager.getSeatRoutes()?.map(route => route === 'human' ? route : route.profileId)).toEqual(['b','a','b','a']);
    expect(host.textContent).toContain('快算甲'); expect(host.textContent).toContain('快算乙');
  });
  it('参数编辑产生新目录版本，已有座位版本冻结，失败时显示错误并保持配置', async () => {
    const { host, manager, select, click } = await mount(); const original = manager.getSeatRoutes();
    await click('🛠️ 开发者选项'); await select('编辑配置', 'a');
    expect(host.querySelector('[aria-label="配置参数"]')).not.toBeNull();
    const next = makeProfile({ id: 'a', name: '改后', type: 'bridge', options: {} }, { ...profiles[0].parameters.options, timeLimitMs: 50 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ profiles: [next, profiles[1]] }))).mockRejectedValueOnce(new Error('显式网络失败'));
    await click('保存配置新版本'); expect(manager.getProfiles()[0].version).toBe(next.version); expect(manager.getSeatRoutes()).toEqual(original);
    await click('保存配置新版本'); expect(host.textContent).toContain('显式网络失败'); expect(manager.getSeatRoutes()).toEqual(original);
  });
});
