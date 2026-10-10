/**
 * 保山幺子分模型代理服务 (Node 22+)
 * - 提供引擎健康检查 /api/engines
 * - 提供 /api/laya/* 与 /api/llm/* 反向代理与鉴权注入
 * - 提供 /api/decision 统一服务端决策接口
 * - 生产模式下可直接托管 dist/ 静态前端资源
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// 上游配置
const CONFIG = {
  laya: {
    baseUrl: process.env.LAYA_BASE_URL || 'http://127.0.0.1:11435',
    model: process.env.LAYA_MODEL || 'laya:multilingual',
    timeoutMs: Number(process.env.LAYA_TIMEOUT_MS) || 1500,
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'http://211.141.18.165:6195/v1',
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    model: process.env.LLM_MODEL || 'qwen38_27b',
    protocol: process.env.LLM_PROTOCOL || 'chat',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 8000,
  },
};

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

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        // 10MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function checkLayaHealth(): Promise<{ available: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    // Ollaya 的健康/版本探测端点
    const res = await fetch(`${CONFIG.laya.baseUrl.replace(/\/+$/, '')}/api/version`, {
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    if (res && (res.ok || res.status === 404)) {
      return { available: true };
    }
    // 备用探测：向 /v1/systemone 发送 options 或空请求
    const res2 = await fetch(`${CONFIG.laya.baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
      method: 'OPTIONS',
      signal: controller.signal,
    }).catch(() => null);
    return { available: res2 !== null };
  } catch (e: any) {
    return { available: false, error: e?.message ?? '连接失败' };
  }
}

async function checkLlmHealth(): Promise<{ available: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const headers: Record<string, string> = {};
    if (CONFIG.llm.apiKey) {
      headers['Authorization'] = `Bearer ${CONFIG.llm.apiKey}`;
    }
    const res = await fetch(`${CONFIG.llm.baseUrl.replace(/\/+$/, '')}/models`, {
      headers,
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    if (res && res.ok) {
      return { available: true };
    }
    return { available: !!CONFIG.llm.apiKey || false };
  } catch (e: any) {
    return { available: false, error: e?.message ?? '连接失败' };
  }
}

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. /api/engines 或 /api/health
  if (pathname === '/api/engines' || pathname === '/api/health') {
    const [layaHealth, llmHealth] = await Promise.all([
      checkLayaHealth(),
      checkLlmHealth(),
    ]);

    const result = {
      status: 'ok',
      timestamp: Date.now(),
      engines: {
        algorithm: {
          available: true,
          type: 'worker',
          defaultBudgetMs: 250,
        },
        laya: {
          available: layaHealth.available,
          baseUrl: CONFIG.laya.baseUrl,
          model: CONFIG.laya.model,
          timeoutMs: CONFIG.laya.timeoutMs,
          error: layaHealth.error,
        },
        llm: {
          available: llmHealth.available,
          baseUrl: CONFIG.llm.baseUrl,
          model: CONFIG.llm.model,
          protocol: CONFIG.llm.protocol,
          timeoutMs: CONFIG.llm.timeoutMs,
          hasApiKey: !!CONFIG.llm.apiKey,
          error: llmHealth.error,
        },
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 2. /api/laya/* 转发至 Ollaya
  if (pathname.startsWith('/api/laya')) {
    const targetSubPath = pathname.replace(/^\/api\/laya/, '');
    const upstreamUrl = `${CONFIG.laya.baseUrl.replace(/\/+$/, '')}${targetSubPath}`;
    const bodyStr = await parseBody(req);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.laya.timeoutMs + 500);

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr ? bodyStr : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      res.writeHead(upstreamRes.status, {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      });
      const data = await upstreamRes.arrayBuffer();
      res.end(Buffer.from(data));
    } catch (e: any) {
      clearTimeout(timeout);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `上游 Laya 请求失败: ${e?.message}` }));
    }
    return;
  }

  // 3. /api/llm/* 转发至 LLM 端点并自动注入 API Key
  if (pathname.startsWith('/api/llm')) {
    const targetSubPath = pathname.replace(/^\/api\/llm/, '');
    const upstreamUrl = `${CONFIG.llm.baseUrl.replace(/\/+$/, '')}${targetSubPath}`;
    const bodyStr = await parseBody(req);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.llm.timeoutMs + 1000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (CONFIG.llm.apiKey) {
        headers['Authorization'] = `Bearer ${CONFIG.llm.apiKey}`;
      } else if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }

      const upstreamRes = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: bodyStr ? bodyStr : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      res.writeHead(upstreamRes.status, {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      });
      const data = await upstreamRes.arrayBuffer();
      res.end(Buffer.from(data));
    } catch (e: any) {
      clearTimeout(timeout);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `上游 LLM 请求失败: ${e?.message}` }));
    }
    return;
  }

  // 未匹配的 /api/* 接口
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端构建产物 dist/ 不存在，请先运行 pnpm build 或在开发模式下运行 pnpm dev');
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
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
    await handleApiRequest(req, res, pathname);
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Proxy] 保山幺子分模型代理服务器已启动: http://${HOST}:${PORT}`);
  console.log(`[Proxy] 上游 Laya: ${CONFIG.laya.baseUrl} (模型: ${CONFIG.laya.model})`);
  console.log(`[Proxy] 上游 LLM: ${CONFIG.llm.baseUrl} (模型: ${CONFIG.llm.model}, 鉴权: ${CONFIG.llm.apiKey ? '已配置' : '未配置'})`);
});
