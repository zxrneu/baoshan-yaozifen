/** 历史 JSON 编码与 SHA-256（SRP）：统一持久化内容和跨运行时指纹。 */
import { HISTORY_PROTOCOL_VERSION, versioned } from './contracts';
import { fail, isRecord, parseJson } from './errors';

/** 规范化 JSON：对象键排序、剔除 undefined，作为内容指纹与落库文本的统一形式。 */
export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const canonical = (input: unknown): unknown => {
    if (input === null || input === undefined || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) return fail('历史 JSON 不允许非有限数字');
      return input;
    }
    if (typeof input !== 'object') return fail('历史 JSON 不允许函数、符号或 bigint');
    if (ancestors.has(input)) return fail('历史 JSON 不允许循环引用');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) return input.map(canonical);
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== null && prototype !== Object.prototype) return fail('历史 JSON 只允许普通对象或数组');
      return Object.fromEntries(Object.entries(input)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]));
    } finally { ancestors.delete(input); }
  };
  const text = JSON.stringify(canonical(value));
  return text === undefined ? 'null' : text;
}

/** 同步纯 JS SHA-256：不读取 crypto/WebCrypto，跨浏览器、Node 与离线环境使用唯一指纹算法。 */
export function contentDigest(value: unknown): string {
  return 'sha256:' + sha256Hex(canonicalJson(value));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 同步 SHA-256：用于节点/快照指纹，避免协议层引入异步签名或新增依赖。 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[words.length - 1] = bytes.length * 8;
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < words.length; offset += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[offset + i];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) >>> 0;
  }
  return Array.from(h, word => word.toString(16).padStart(8, '0')).join('');
}

export function writeVersioned<T>(data: T): string {
  return canonicalJson(versioned(data));
}

export function readVersioned<T>(text: string | null | undefined, what: string): T | null {
  if (text === null || text === undefined) return null;
  const parsed: unknown = parseJson(text, what);
  if (!isRecord(parsed) || typeof parsed.v !== 'number') return fail(`${what} 缺少版本号`);
  if (parsed.v !== HISTORY_PROTOCOL_VERSION) {
    const legacy = parsed.v === 1 ? '；旧版 seed/history 持久化不完整，不能安全恢复，请重新导入完整状态' : '';
    fail(`${what} 版本 ${parsed.v} 不受支持（当前 ${HISTORY_PROTOCOL_VERSION}）${legacy}`);
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'data')) return fail(`${what} 缺少 data 字段`);
  return parsed.data as T;
}
