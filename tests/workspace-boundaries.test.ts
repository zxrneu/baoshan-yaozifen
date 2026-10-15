/** 工作区运行时边界回归（DIP）：实际构建消费者，防止拆包后拉入 Node 或评测数据。 */
import { describe, expect, it } from 'vitest';
import { build, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

function browserBoundary(modules: string[]): Plugin {
  return {
    name: 'workspace-browser-boundary',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('node:') || builtinModules.includes(id)) {
        throw new Error(`浏览器工作区误引入 Node 模块：${id}`);
      }
      return null;
    },
    generateBundle() { modules.push(...this.getModuleIds()); },
  };
}

describe('工作区运行时隔离', () => {
  it('规则与观察的浏览器构建不依赖 AI、历史存储或 React', async () => {
    const modules: string[] = [];
    await build({
      configFile: false, envDir: false, logLevel: 'silent',
      plugins: [browserBoundary(modules)],
      build: {
        write: false, minify: false,
        lib: {
          entry: fileURLToPath(new URL('../packages/game-view/src/index.ts', import.meta.url)),
          formats: ['es'], fileName: 'game-view',
        },
      },
    });
    expect(modules.some(id => id.includes('/game-core/src/game.ts'))).toBe(true);
    expect(modules.filter(id => /\/(?:ai-core|ai-eval|history-core|match-runtime)\/|\/node_modules\//.test(id))).toEqual([]);
  });

  it('完整牌桌生产构建不加载服务端、评测包或评测数据', async () => {
    const modules: string[] = [];
    await build({
      configFile: false, envDir: false, logLevel: 'silent',
      root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
      plugins: [react(), browserBoundary(modules)],
      build: { write: false, minify: false },
    });
    expect(modules.some(id => id.endsWith('/apps/web/src/App.tsx'))).toBe(true);
    expect(modules.filter(id => /\/apps\/server\/|\/packages\/ai-eval\/|\/data\/evaluation\//.test(id))).toEqual([]);
  }, 30000);
});
