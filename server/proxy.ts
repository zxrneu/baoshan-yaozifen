/**
 * 保山幺子分独立模型代理服务 (Node 22+)
 * - 提供引擎健康检查 /api/engines
 * - 提供 /api/laya/* 与 /api/llm/* 反向代理与鉴权注入
 * - 提供 /api/decision 统一服务端决策接口
 * - 生产模式下可直接托管 dist/ 静态前端资源
 */
import http from 'node:http';
import fs, { readFile } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './apiHandler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

// 自动加载 .env 环境变量（GPU 节点、模型名称及端点）
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile();
  } catch {
    // 忽略 .env 文件不存在或已加载的情况
  }
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const api = createApiHandler();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端构建产物 dist/ 不存在，请先运行 pnpm build 或在开发模式下运行 pnpm dev');
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api')) {
    const handled = await api.handleApiRequest(req, res, pathname);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] 保山幺子分模型与决策服务已启动: http://${HOST}:${PORT}`);
  console.log(`[Server] 上游 Laya: ${api.config.laya.baseUrl} (模型: ${api.config.laya.model})`);
  console.log(
    `[Server] 上游 LLM: ${api.config.llm.baseUrl} (模型: ${api.config.llm.model}, 鉴权: ${
      api.config.llm.apiKey ? '已配置' : '未配置'
    })`,
  );
});
