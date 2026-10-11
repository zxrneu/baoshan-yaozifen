/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/apiHandler';

export default defineConfig(({ mode }) => {
  // 仅在开发与生产构建时加载 .env 环境变量；测试模式保持独立默认配置
  if (mode !== 'test') {
    const env = loadEnv(mode, process.cwd(), '');
    Object.assign(process.env, env);
  }

  const api = createApiHandler();

  return {
    plugins: [
      react(),
      {
        name: 'baoshan-api-dev-middleware',
        configureServer(server) {
          // 直接在 Vite 开发服务器内挂载 /api 决策与模型反向代理路由
          // 开发模式下一键运行 `pnpm dev` 即可享受完整的 C/S 架构与模型推演，无需另开窗口启动 pnpm proxy
          server.middlewares.use(api.createMiddleware());
        },
      },
    ],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
