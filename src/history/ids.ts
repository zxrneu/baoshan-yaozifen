/**
 * 历史记录稳定 ID 生成（SRP）。
 * 运行时的 `game-1` 序号只在进程内有效，不能作为跨重启主键；
 * 这里用「类型前缀 + 加密随机熵」生成稳定唯一 ID，与内容指纹配合实现重试幂等。
 */

export type IdKind =
  | 'match'
  | 'hand'
  | 'branch'
  | 'node'
  | 'evaluation'
  | 'profileVersion'
  | 'assignment'
  | 'run'
  | 'board'
  | 'checkpoint';

const PREFIXES: Record<IdKind, string> = {
  match: 'm',
  hand: 'h',
  branch: 'b',
  node: 'n',
  evaluation: 'e',
  profileVersion: 'pv',
  assignment: 'sa',
  run: 'r',
  board: 'bd',
  checkpoint: 'cp',
};

import { contentDigest } from './protocol';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  throw new Error('当前运行环境缺少加密随机源，无法生成历史记录 ID');
}

/** 生成 `前缀_32位十六进制` ID：128 位均匀加密随机熵；创建后由调用方留存。 */
export function newHistoryId(kind: IdKind): string {
  const out = Array.from(randomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${PREFIXES[kind]}_${out}`;
}

/** 完整 SHA-256 身份，不截断算法前缀或摘要；同一次提交重试得到相同 ID。 */
export function derivedHistoryId(kind: IdKind, digest: string): string {
  const hash = /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : contentDigest(digest).slice(7);
  return `${PREFIXES[kind]}_${hash}`;
}
