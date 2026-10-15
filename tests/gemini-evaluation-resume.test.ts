/** 实验续跑的限流与证据保护回归；验证服务响应及持久化边界，不修改游戏规则。 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleRetryPolicy, saveCheckpoint } from '../experiments/gemini-flash-20261015/resume-support';

describe('Gemini 实验限流与断点保护', () => {
  it('识别数组错误中的日配额与长等待，不作为短退避反复重试', () => {
    const body = [{ error: { code: 429, details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '60455s' },
    ] } }];
    expect(googleRetryPolicy(body, new Headers())).toEqual({ daily: true, retryDelayMs: 60455000 });
  });
  it('正文分钟限流等待长于响应头时遵循较长时间', () => {
    const body = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '9.5s' }] } };
    expect(googleRetryPolicy(body, new Headers({ 'retry-after': '2' }))).toEqual({ daily: false, retryDelayMs: 9500 });
  });
  it('同一题检查点只落盘一次，续跑不能改写之前取得的模型结果', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gemini-checkpoint-'));
    try {
      expect(saveCheckpoint(directory, 'bid-weak', { passed: false, response: 'pass' })).toBe(true);
      expect(saveCheckpoint(directory, 'bid-weak', { passed: true, response: 'raise' })).toBe(false);
      expect(JSON.parse(readFileSync(join(directory, 'bid-weak.json'), 'utf8'))).toEqual({ passed: false, response: 'pass' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
