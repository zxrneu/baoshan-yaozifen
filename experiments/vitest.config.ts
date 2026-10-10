import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 独立的实验跑分配置：不进 pnpm test，避免拖慢常规测试 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['experiments/**/*.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    reporters: ['dot'],
  },
});
