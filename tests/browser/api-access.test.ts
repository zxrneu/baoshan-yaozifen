/** HTTP 访问边界回归：经过真实开发中间件确认本机请求可用、外站请求和预检被拒绝。 */
import { test, expect } from '@playwright/test';

test('真实 API 中间件允许本机读取配置，拒绝外站来源和跨站无 Origin 请求', async ({ request, baseURL }) => {
  const local = await request.get('/api/engine-profiles', { headers: { Origin: baseURL! } });
  expect(local.status()).toBe(200);
  expect((await local.json()).profiles).toHaveLength(1);
  expect(local.headers()['access-control-allow-origin']).toBe(baseURL);

  for (const method of ['GET', 'OPTIONS']) {
    const denied = await request.fetch('/api/engine-profiles', { method, headers: { Origin: 'https://evil.example' } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toContain('API_ALLOWED_ORIGINS');
    expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
  }
  const crossSite = await request.get('/api/engine-profiles', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  expect(crossSite.status()).toBe(403);
  const cli = await request.get('/api/engine-profiles');
  expect(cli.status()).toBe(200);
});
