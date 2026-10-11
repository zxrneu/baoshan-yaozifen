/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/apiHandler';

export default defineConfig(({ mode }) => {
  // 仅在开发与生产构建时加载 .env 环境变量；测试模式保持独立默认配置
  if (mode !== 'test') {
    const env = loadEnv(mode === 'client' ? 'development' : mode, process.cwd(), '');
    Object.assign(process.env, env);
  }

  const isClientOnly = mode === 'client';
  const serverPort = Number(process.env.PORT) || 3001;

  const plugins = [react()];

  // 单命令合一模式 (pnpm dev)：内置 API 中间件，直接在 5173 处理 /api
  if (!isClientOnly && mode !== 'test') {
    const api = createApiHandler();
    plugins.push({
      name: 'baoshan-api-dev-middleware',
      configureServer(server) {
        server.middlewares.use(api.createMiddleware());
      },
    });
  }

  return {
    plugins,
    server: {
      // 独立客户端模式 (pnpm client)：反向代理转发至独立启动的 Node 决策服务 (pnpm server)
      proxy: isClientOnly
        ? {
            '/api': {
              target: `http://127.0.0.1:${serverPort}`,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
