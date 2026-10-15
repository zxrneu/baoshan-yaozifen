/** Web 构建与开发组合根（SRP）：应用源码独立，环境和产物保留仓库根语义。 */
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const applicationRoot = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig(({ mode }) => {
  // 测试不加载玩家的 .env；浏览器回归由专用服务注入临时库和离线配置。
  if (mode !== 'test' && mode !== 'browser-test') {
    const env = loadEnv(mode === 'client' ? 'development' : mode, repositoryRoot, '');
    Object.assign(process.env, env);
  }

  const isClientOnly = mode === 'client';
  const serverPort = Number(process.env.PORT) || 3001;

  const plugins: PluginOption[] = [react()];

  if (mode === 'browser-test') {
    plugins.push({
      name: 'baoshan-browser-test-fixtures',
      configureServer(server) {
        // 夹具留在根 tests/，HTML 及其相对模块统一经 Vite 转换。
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/tests/fixtures/')) return next();
          const pathname = new URL(req.url, 'http://localhost').pathname;
          const filename = pathname.slice('/tests/fixtures/'.length);
          if (/^[\w-]+\.html$/.test(filename)) {
            try {
              const html = await readFile(new URL(`../../tests/fixtures/${filename}`, import.meta.url), 'utf8');
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              // /@fs 的静态 HTML 不执行 React preamble，须走完整 HTML 转换。
              res.end(await server.transformIndexHtml(req.url, html));
            } catch (error) { next(error); }
            return;
          }
          next();
        });
      },
    });
  }

  // 单命令合一模式 (pnpm dev)：内置 API 中间件，直接在 5173 处理 /api
  if (!isClientOnly && mode !== 'test') {
    plugins.push({
      name: 'baoshan-api-dev-middleware',
      async configureServer(server) {
        // 配置由 Node 加载；工作区 TS 交给 Vite 转换，避免原生 ESM 解析无扩展名导入。
        const { createApiHandler } = await server.ssrLoadModule('@yaozifen/server/apiHandler') as typeof import('@yaozifen/server/apiHandler');
        server.middlewares.use(createApiHandler().createMiddleware());
      },
    });
  }

  return {
    root: applicationRoot,
    envDir: repositoryRoot,
    publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
    build: { outDir: fileURLToPath(new URL('../../dist', import.meta.url)), emptyOutDir: true },
    plugins,
    resolve: mode === 'browser-test'
      ? { alias: { '/tests/fixtures': fileURLToPath(new URL('../../tests/fixtures', import.meta.url)) } }
      : undefined,
    ssr: { noExternal: [/^@yaozifen\//] },
    ...(mode === 'browser-test' ? { envDir: false as const } : {}),
    server: {
      // 独立客户端模式 (pnpm client)：反向代理转发至独立启动的 Node 决策服务 (pnpm server)
      proxy: isClientOnly
        ? {
            '/api': {
              target: `http://127.0.0.1:${serverPort}`,
              changeOrigin: false,
            },
          }
        : undefined,
    },
  };
});
