import { describe, expect, it } from 'vitest';
import { safeAnySignal } from '../src/ai/engines/engineTypes';

describe('安全信号组合工具 (safeAnySignal & Abort Context Preservation)', () => {
  it('单信号 abort 时保留完整 reason，不丢失原因', () => {
    const parentController = new AbortController();
    const { signal } = safeAnySignal([parentController.signal]);

    expect(signal.aborted).toBe(false);

    const customReason = new DOMException('Laya 决策超时 (1500ms)', 'TimeoutError');
    parentController.abort(customReason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(customReason);
    expect(signal.reason.message).toContain('Laya 决策超时');
  });

  it('两个信号中任意一个先 abort 时立即触发，且原因不变成 "signal is aborted without reason"', () => {
    const userCancel = new AbortController();
    const timeoutCancel = new AbortController();

    const { signal, cleanup } = safeAnySignal([userCancel.signal, timeoutCancel.signal]);

    const timeoutReason = new DOMException('请求超时 (2000ms)', 'TimeoutError');
    timeoutCancel.abort(timeoutReason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(timeoutReason);
    expect(signal.reason.message).toBe('请求超时 (2000ms)');

    cleanup();
  });

  it('先已处于 aborted 状态的信号传入时，新信号立即带有相同原因', () => {
    const abortedController = new AbortController();
    const priorReason = new Error('用户手动重开对局');
    abortedController.abort(priorReason);

    const { signal } = safeAnySignal([abortedController.signal]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(priorReason);
  });
});
