/** 本地 API 访问边界（SRP）：限制主机与来源，密钥只在服务端使用。 */
import type { HttpLikeReq, HttpLikeRes } from './apiHandler';

function header(req: HttpLikeReq, name: string): string | undefined {
  const value: unknown = req.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}
function isLoopback(address: string): boolean {
  return address === 'localhost' || address === '127.0.0.1' || address === '::1'
    || address === '[::1]' || address === '::ffff:127.0.0.1';
}

export function authorizeApiRequest(req: HttpLikeReq, res: HttpLikeRes, allowedOrigins: readonly string[]): boolean {
  // 无 HTTP 元数据的进程内调用不经过网络；所有真实 HTTP 请求都有 headers。
  if (!req.headers) return true;
  const origin = header(req, 'origin');
  const host = header(req, 'host');
  let localHost = false;
  try { localHost = Boolean(host && isLoopback(new URL(`http://${host}`).hostname)); } catch { /* 非法 Host 拒绝 */ }
  let allowed = false;
  if (origin) {
    try {
      const parsed = new URL(origin);
      allowed = (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && (allowedOrigins.includes(parsed.origin) || (localHost && parsed.host === host
          && (!req.socket || isLoopback(req.socket.remoteAddress ?? ''))));
    } catch { /* 非法 Origin 拒绝 */ }
  } else {
    allowed = localHost && isLoopback(req.socket?.remoteAddress ?? '')
      && header(req, 'sec-fetch-site') !== 'cross-site';
  }
  if (!allowed) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '仅允许本机同源请求；跨源前端须显式配置 API_ALLOWED_ORIGINS。' }));
    return false;
  }
  if (origin) {
    res.setHeader?.('Access-Control-Allow-Origin', origin);
    res.setHeader?.('Vary', 'Origin');
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
  }
  return true;
}
