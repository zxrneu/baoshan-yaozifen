/** 浏览器回归环境隔离：测试专用模式不得读取玩家的模型、密钥或历史库配置。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEnv, UserConfig } from 'vite';

vi.mock('vite', async importOriginal => {
  const original = await importOriginal<typeof import('vite')>();
  return { ...original, loadEnv: vi.fn(() => ({ GAME_DB_PATH: '/玩家的历史.db', LLM_API_KEY: '玩家的密钥' })) };
});
import { loadEnv } from 'vite';
import config from '../vite.config';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

function resolveConfig(mode: string): UserConfig {
  if (typeof config !== 'function') throw new Error('Vite 配置必须按模式解析');
  return config({ mode, command: 'serve' } satisfies ConfigEnv) as UserConfig;
}

describe('浏览器回归使用隔离环境', () => {
  it('测试模式保留注入的临时库，不加载玩家的 .env，同时提供真实 API 中间件', () => {
    vi.stubEnv('GAME_DB_PATH', '/tmp/浏览器回归/history.db');
    vi.stubEnv('LLM_API_KEY', '');
    const result = resolveConfig('browser-test');
    expect(loadEnv).not.toHaveBeenCalled();
    expect(process.env.GAME_DB_PATH).toBe('/tmp/浏览器回归/history.db');
    expect(process.env.LLM_API_KEY).toBe('');
    expect(result.envDir).toBe(false);
    expect(result.plugins?.some(plugin => !!plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'baoshan-api-dev-middleware')).toBe(true);
  });
});
