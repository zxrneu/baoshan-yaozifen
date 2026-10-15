/** 浏览器回归编排（SRP）：独立服务、临时历史库与离线配置，结果不进入玩家数据。 */
import { defineConfig } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 主进程总是创建新目录；只有测试 worker 复用主进程传递的路径。
const runDirectory = process.env.TEST_WORKER_INDEX === undefined
  ? mkdtempSync(join(tmpdir(), 'yaozifen-browser-')) : process.env.YAOZIFEN_BROWSER_RUN_DIRECTORY;
if (!runDirectory) throw new Error('浏览器测试 worker 缺少本次临时目录');
process.env.YAOZIFEN_BROWSER_RUN_DIRECTORY = runDirectory;
const profilesPath = join(runDirectory, 'profiles.json');
writeFileSync(profilesPath, JSON.stringify({ schemaVersion: 1, profiles: [{
  id: 'default-bridge', name: '浏览器回归 · 离线 Bridge', type: 'bridge',
  options: { mode: 'fast' },
}] }));
// 显式覆盖继承的模型变量，专用 Vite 模式同时禁止加载 .env。
const isolatedEnv: Record<string, string> = Object.fromEntries(
  Object.keys(process.env).filter(key => /^(LLM_|LAYA_|VITE_)/.test(key)).map(key => [key, '']),
);

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.test.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'output/playwright/test-results',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  metadata: { runDirectory },
  globalTeardown: './tests/browser/cleanup.ts',
  use: { baseURL: 'http://127.0.0.1:4177', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: '桌面 Chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: '手机尺寸 Chromium', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, hasTouch: true } },
  ],
  webServer: {
    command: 'pnpm exec vite --config apps/web/vite.config.ts --mode browser-test --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...isolatedEnv, GAME_HISTORY: 'on', GAME_DB_PATH: join(runDirectory, 'history.db'),
      ENGINE_PROFILES_PATH: profilesPath, LLM_BASE_URL: 'http://127.0.0.1:1/v1', LLM_API_KEY: '',
      LAYA_BASE_URL: 'http://127.0.0.1:1', LAYA_API_KEY: '', VITE_ENABLE_GOD_MODE: 'false' },
  },
});
