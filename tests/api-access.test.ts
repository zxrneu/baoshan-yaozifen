/** 本地服务访问边界回归：真实 API 拒绝不可信请求，禁止触达模型或写入配置。 */
import { afterEach, expect, it, vi } from 'vitest';
import { createApiHandler, type ApiHandlerConfig, type HttpLikeReq } from '../server/apiHandler';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function request(req: HttpLikeReq, path = '/api/llm/models', config: ApiHandlerConfig = {}) {
  let status = 0; let body = ''; const headers: Record<string, string> = {};
  const handler = createApiHandler({ historyRepository: () => null, llm: { apiKey: 'test-secret' }, ...config });
  await handler.handleApiRequest(req, { writeHead(code) { status = code; }, end(data) { body = String(data ?? ''); }, setHeader(key: string, value: string) { headers[key] = value; } }, path);
  return { status, body, headers };
}

it.each(['/api/llm/models', '/api/decision', '/api/engine-profiles', '/api/history/write'])('外站 Origin 不能调用模型或修改数据：%s', async path => {
  const upstream = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', upstream);
  const result = await request({ method: 'POST', headers: { host: '127.0.0.1:3001', origin: 'https://evil.example' } }, path);
  expect(result.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
});
it('非本机 Host 的无 Origin 请求也不能借用服务端密钥', async () => {
  const upstream = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', upstream);
  expect((await request({ method: 'GET', headers: { host: '192.168.1.2:3001' } })).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});
it('DNS 重绑定站点即使 Origin 与 Host 一致也被拒绝', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  expect((await request({ method: 'GET', headers: { host: 'evil.example:3001', origin: 'http://evil.example:3001' } })).status).toBe(403);
});
it('同源本地前端仍可访问模型且只向上游注入密钥', async () => {
  const upstream = vi.fn(async (_url, init) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    return new Response('{"models":[]}');
  }); vi.stubGlobal('fetch', upstream);
  const result = await request({ method: 'GET', headers: { host: 'localhost:3001', origin: 'http://localhost:3001' } });
  expect(result.status).toBe(200); expect(result.body).not.toContain('test-secret');
  expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3001');
});
it('不可信预检被拒绝且不会获得通配 CORS 授权', async () => {
  const result = await request({ method: 'OPTIONS', headers: { host: 'localhost:3001', origin: 'https://evil.example' } });
  expect(result.status).toBe(403); expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
});
it('局域网客户端伪造本机 Host 和 Origin 仍不能借用密钥', async () => {
  const upstream = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', upstream);
  const result = await request({ method: 'GET', headers: { host: 'localhost:3001', origin: 'http://localhost:3001' }, socket: { remoteAddress: '192.168.1.20' } });
  expect(result.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
});
it('本机无 Origin 的命令行请求可用，但浏览器跨站请求被拒绝', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  const base = { method: 'GET', headers: { host: 'localhost:3001' }, socket: { remoteAddress: '::ffff:127.0.0.1' } };
  expect((await request(base)).status).toBe(200);
  expect((await request({ ...base, headers: { ...base.headers, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
});
it('IPv6 本机同源与无 Origin 请求均可访问，外部 IPv6 连接被拒绝', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  const base = { method: 'GET', headers: { host: '[::1]:3001' }, socket: { remoteAddress: '::1' } };
  expect((await request(base)).status).toBe(200);
  expect((await request({ ...base, headers: { ...base.headers, origin: 'http://[::1]:3001' } })).status).toBe(200);
  expect((await request({ ...base, socket: { remoteAddress: '2001:db8::1' } })).status).toBe(403);
});
it('显式白名单允许可信跨源前端的预检和请求，但不允许不同端口或相似域名', async () => {
  const upstream = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', upstream);
  const config = { allowedOrigins: ['https://trusted.example:8443'] };
  const base = { method: 'GET', headers: { host: '192.168.1.2:3001', origin: 'https://trusted.example:8443' }, socket: { remoteAddress: '192.168.1.20' } };
  const preflight = await request({ ...base, method: 'OPTIONS' }, '/api/llm/models', config);
  expect(preflight.status).toBe(204);
  expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://trusted.example:8443');
  expect(upstream).not.toHaveBeenCalled();
  expect((await request(base, '/api/llm/models', config)).status).toBe(200);
  upstream.mockClear();
  for (const origin of ['https://trusted.example', 'https://trusted.example.evil:8443', 'null']) {
    const rejected = await request({ ...base, headers: { ...base.headers, origin } }, '/api/llm/models', config);
    expect(rejected.status).toBe(403);
    expect(rejected.headers['Access-Control-Allow-Origin']).toBeUndefined();
  }
  expect(upstream).not.toHaveBeenCalled();
});
it('环境白名单按逗号分隔，显式空配置仍可禁止跨源访问', async () => {
  vi.stubEnv('API_ALLOWED_ORIGINS', ' https://one.example, , https://two.example ');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  const req = { method: 'GET', headers: { host: 'localhost:3001', origin: 'https://two.example' }, socket: { remoteAddress: '127.0.0.1' } };
  expect((await request(req)).status).toBe(200);
  expect((await request(req, '/api/llm/models', { allowedOrigins: [] })).status).toBe(403);
});
