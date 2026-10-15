/**
 * 保山幺子分统一 API 服务调度与中间件
 * - 提供 /api/decision 统一决策 RPC 调度
 * - 提供 /api/engines 引擎健康检查探测
 * - 提供 /api/llm/* 与 /api/laya/* 反向代理与鉴权注入
 * - 支持以中间件形式直接挂载至 Vite 开发服务器（单命令 pnpm dev 即全功能）
 * - 支持挂载至原生 http.Server 独立运行 (pnpm server)
 */
import { authorizeApiRequest } from './apiAccess';
import { openHistoryRepository } from './history/index';
import { SimulationService } from './history/simulationService';
import { handleHistory } from './history/http';
import type { HistoryRepository } from '@yaozifen/history-core/contracts';
import { ServerEngineRegistry } from './engines/serverEngineRegistry';
import { DecisionService } from './services/decisionService';
import { DecisionController } from './controllers/decisionController';

declare const process: any;

export interface HttpLikeReq {
  socket?: { remoteAddress?: string };
  method?: string;
  url?: string;
  headers?: Record<string, any>;
  on?(event: string, listener: (...args: any[]) => void): any;
}

export interface HttpLikeRes {
  setHeader?(name: string, value: string): unknown;
  writeHead(statusCode: number, headers?: Record<string, any>): void;
  end(data?: string | Uint8Array): void;
  write?(data: string | Uint8Array): unknown;
  headersSent?: boolean;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

export interface ApiHandlerConfig {
  allowedOrigins?: readonly string[];
  historyRepository?: () => HistoryRepository | null;
  laya?: {
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
  };
  llm?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    protocol?: 'chat' | 'completion';
    timeoutMs?: number;
  };
}

export function parseBody(req: HttpLikeReq): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    if (typeof req.on !== 'function') {
      resolve(data);
      return;
    }
    req.on('data', (chunk: any) => {
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

export function createApiHandler(customConfig?: ApiHandlerConfig) {
  const config = {
    laya: {
      baseUrl: customConfig?.laya?.baseUrl || process?.env?.LAYA_BASE_URL || 'http://127.0.0.1:11435',
      model: customConfig?.laya?.model || process?.env?.LAYA_MODEL || 'laya:multilingual',
      timeoutMs: customConfig?.laya?.timeoutMs || Number(process?.env?.LAYA_TIMEOUT_MS) || 2500,
    },
    llm: {
      baseUrl: customConfig?.llm?.baseUrl || process?.env?.LLM_BASE_URL || 'http://127.0.0.1:8000/v1',
      apiKey:
        customConfig?.llm?.apiKey ??
        (process?.env?.LLM_API_KEY ||
          process?.env?.OPENAI_API_KEY ||
          process?.env?.DEEPSEEK_API_KEY ||
          ''),
      model: customConfig?.llm?.model || process?.env?.LLM_MODEL || 'qwen38_27b',
      protocol: (customConfig?.llm?.protocol ||
        process?.env?.LLM_PROTOCOL ||
        'chat') as 'chat' | 'completion',
      timeoutMs: customConfig?.llm?.timeoutMs || Number(process?.env?.LLM_TIMEOUT_MS) || 60000,
    },
  };

  const engineRegistry = new ServerEngineRegistry({
    profilesPath: process.env.ENGINE_PROFILES_PATH,
    env: process.env,
    laya: config.laya,
    llm: config.llm,
  });
  engineRegistry.setProfileLoader(id => (customConfig?.historyRepository ?? openHistoryRepository)()?.getProfileVersion(id) ?? null);
  const decisionService = new DecisionService(engineRegistry);
  const simulationService = new SimulationService(customConfig?.historyRepository ?? openHistoryRepository, engineRegistry, decisionService);
  const decisionController = new DecisionController(decisionService);

  async function checkLayaHealth(): Promise<{ available: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${config.laya.baseUrl.replace(/\/+$/, '')}/api/version`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      if (res && (res.ok || res.status === 404)) {
        return { available: true };
      }
      const res2 = await fetch(`${config.laya.baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
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
      if (config.llm.apiKey) {
        headers['Authorization'] = `Bearer ${config.llm.apiKey}`;
      }
      const res = await fetch(`${config.llm.baseUrl.replace(/\/+$/, '')}/models`, {
        headers,
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      if (res && res.ok) {
        return { available: true };
      }
      return { available: !!config.llm.apiKey || false };
    } catch (e: any) {
      return { available: false, error: e?.message ?? '连接失败' };
    }
  }

  async function handleApiRequest(
    req: HttpLikeReq,
    res: HttpLikeRes,
    pathname: string,
  ): Promise<boolean> {
    const allowedOrigins = customConfig?.allowedOrigins ?? (process.env.API_ALLOWED_ORIGINS ?? '').split(',').map((value: string) => value.trim()).filter(Boolean);
    if (!authorizeApiRequest(req, res, allowedOrigins)) return true;
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    if (pathname.startsWith('/api/history/simulations')) {
      try {
        const match=/^\/api\/history\/simulations(?:\/([^/]+)(?:\/(cancel|resume))?)?$/.exec(pathname);
        if(!match) throw new Error('模拟接口不存在');
        const id=match[1]; const action=match[2]; let value;let status=200;
        if(req.method==='GET' && !action) value=id ? simulationService.report(id) : simulationService.list();
        else if(req.method==='POST' && !id) {value=simulationService.start(JSON.parse(await parseBody(req)));status=202;}
        else if(req.method==='POST' && id && action==='cancel') value=await simulationService.cancel(id);
        else if(req.method==='POST' && id && action==='resume') {simulationService.resume(id);value=simulationService.report(id);status=202;}
        else throw new Error('模拟接口方法不支持');
        res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));
      } catch(error) {res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error instanceof Error ? error.message : '模拟请求失败'}));}
      return true;
    }

    if (pathname.startsWith('/api/history/')) {
      await handleHistory(req, res, customConfig?.historyRepository ?? openHistoryRepository, parseBody, engineRegistry);
      return true;
    }

    if (pathname === '/api/engine-profiles') {
      try {
        let profiles;
        if (req.method === 'POST') {
          const body = JSON.parse(await parseBody(req));
          if (Array.isArray(body.resolve)) {
            profiles = body.resolve.map((reference: { profileId: string; version: string }) => engineRegistry.getProfile(reference.profileId, reference.version));
            for (const profile of [...profiles]) {
              let fallback = profile.parameters.fallback;
              const seen = new Set<string>();
              while (fallback) {
                if (seen.has(fallback.version)) throw new Error('历史备用配置成环'); seen.add(fallback.version);
                const resolved = engineRegistry.getProfile(fallback.profileId, fallback.version);
                if (!profiles.some((value: { version: string }) => value.version === resolved.version)) profiles.push(resolved);
                fallback = resolved.parameters.fallback;
              }
            }
          } else profiles = body.reload === true ? engineRegistry.profiles.reload() : engineRegistry.profiles.edit(body.profileId, body.name, body.options, body.expectedVersion);
        } else if (req.method === 'GET') profiles = engineRegistry.profiles.list();
        else { res.writeHead(405); res.end(); return true; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ profiles }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : '引擎配置请求失败' }));
      }
      return true;
    }

    // 0. /api/decision 服务端统一决策接口
    if (pathname === '/api/decision') {
      const bodyStr = await parseBody(req);
      await decisionController.handleDecision(req, res, bodyStr);
      return true;
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
        profiles: await Promise.all(engineRegistry.profiles.list().map(async profile => {
          if (profile.type === 'bridge' || profile.type === 'algorithm') return { ...profile, available: true };
          const resolved = engineRegistry.profiles.get(profile.profileId, profile.version);
          const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1500);
          try {
            const base = resolved.baseUrl!.replace(/\/+$/, '');
            const upstream = profile.type === 'llm' ? `${base}/models` : base.endsWith('/v1/systemone') ? base : `${base}/v1/systemone`;
            const response = await fetch(upstream, { method: profile.type === 'llm' ? 'GET' : 'OPTIONS', signal: controller.signal, headers: resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {} });
            return { ...profile, available: response.ok, ...(response.ok ? {} : { error: '模型服务探测失败' }) };
          } catch { return { ...profile, available: false, error: '模型服务探测失败' }; }
          finally { clearTimeout(timer); }
        })),
        engines: {
          algorithm: {
            available: true,
            type: 'worker',
            defaultBudgetMs: 250,
          },
          laya: {
            available: layaHealth.available,
            model: config.laya.model,
            timeoutMs: config.laya.timeoutMs,
            error: layaHealth.error,
          },
          llm: {
            available: llmHealth.available,
            model: config.llm.model,
            protocol: config.llm.protocol,
            timeoutMs: config.llm.timeoutMs,
            hasApiKey: !!config.llm.apiKey,
            error: llmHealth.error,
          },
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return true;
    }

    // 2. /api/laya/* 转发至 Ollaya
    if (pathname.startsWith('/api/laya')) {
      const targetSubPath = pathname.replace(/^\/api\/laya/, '');
      const upstreamUrl = `${config.laya.baseUrl.replace(/\/+$/, '')}${targetSubPath}`;
      const bodyStr = await parseBody(req);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.laya.timeoutMs + 500);

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
        res.end(new Uint8Array(data));
      } catch (e: any) {
        clearTimeout(timeout);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `上游 Laya 请求失败: ${e?.message}` }));
      }
      return true;
    }

    // 3. /api/llm/* 转发至 vLLM / OpenAI 兼容上游（自动注入鉴权）
    if (pathname.startsWith('/api/llm')) {
      const targetSubPath = pathname.replace(/^\/api\/llm/, '');
      const upstreamUrl = `${config.llm.baseUrl.replace(/\/+$/, '')}${targetSubPath}`;
      const bodyStr = await parseBody(req);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.llm.apiKey) {
        headers['Authorization'] = `Bearer ${config.llm.apiKey}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs + 1000);

      const disconnected = () => controller.abort(new DOMException('客户端已取消请求', 'AbortError'));
      res.on?.('close', disconnected);
      try {
        const upstreamRes = await fetch(upstreamUrl, {
          method: req.method,
          headers,
          body: bodyStr ? bodyStr : undefined,
          signal: controller.signal,
        });
        res.writeHead(upstreamRes.status, {
          'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        });
        if (upstreamRes.headers.get('content-type')?.includes('text/event-stream') && upstreamRes.body && res.write) {
          const reader = upstreamRes.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          res.end();
        } else {
          const data = await upstreamRes.arrayBuffer();
          res.end(new Uint8Array(data));
        }
      } catch (e: any) {
        if (res.headersSent) { res.end(); return true; }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `上游 LLM 请求失败: ${e?.message}` }));
      } finally {
        clearTimeout(timeout);
        res.off?.('close', disconnected);
      }
      return true;
    }

    return false;
  }

  function createMiddleware() {
    return async (
      req: HttpLikeReq,
      res: HttpLikeRes,
      next: (err?: any) => void,
    ) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api')) {
        const handled = await handleApiRequest(req, res, url.pathname);
        if (handled) return;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
        return;
      }
      next();
    };
  }

  return {
    config,
    engineRegistry,
    decisionService,
    simulationService,
    decisionController,
    handleApiRequest,
    createMiddleware,
  };
}
