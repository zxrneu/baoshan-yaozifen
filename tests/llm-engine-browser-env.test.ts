/**
 * 浏览器环境安全回归：`LlmEngine` 构造期不得引用 Node 的 `process` 全局。
 *
 * 背景（路线图 §1.4）：`src/ai/engines/llmEngine.ts` 曾在构造函数里直读
 * `process.env.LLM_MAX_CONCURRENCY`，浏览器没有 `process` 对象，构造即抛
 * `ReferenceError: process is not defined`，导致整局白屏，并阻断所有浏览器端人工验收。
 * `tsc` 因为 `vite/client` 提供了宽松的 `process` 声明而完全放行，所以这里用
 * **源码静态断言 + 删除 process 全局后的构造** 两层守护，不依赖类型检查。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LlmEngine, readDefaultMaxConcurrency } from '../src/ai/engines/llmEngine';

const LLM_ENGINE_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/ai/engines/llmEngine.ts', import.meta.url)),
  'utf8',
);

/**
 * 去掉注释与字符串/模板字面量后，再判断是否残留标识符级 `process` 引用。
 *
 * 必须逐字符扫描而不是用正则整段替换：正则的惰性量词会遇到未配对的引号（例如中文
 * 注释里的撇号）而跨行吞掉真实代码，使断言静默失效——本测试首版就栽在这里。
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i++; continue; }
      if (ch === '/' && next === '*') { state = 'block'; i++; continue; }
      if (ch === "'") { state = 'single'; continue; }
      if (ch === '"') { state = 'double'; continue; }
      if (ch === '`') { state = 'template'; continue; }
      out += ch;
      continue;
    }
    if (state === 'line') { if (ch === '\n') { state = 'code'; out += ch; } continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { state = 'code'; i++; } continue; }
    if (ch === '\\') { i++; continue; }
    if (state === 'single' && ch === "'") { state = 'code'; continue; }
    if (state === 'double' && ch === '"') { state = 'code'; continue; }
    if (state === 'template' && ch === '`') { state = 'code'; continue; }
  }
  return out;
}

/** 在「没有 process 全局」的环境下执行，模拟浏览器运行时。 */
function withoutProcessGlobal<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  // 测试需要真实删除该全局以复现浏览器运行时
  delete (globalThis as { process?: unknown }).process;
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'process', descriptor);
  }
}

describe('LlmEngine · 浏览器环境安全', () => {
  it('源码不出现裸 process 全局引用（tsc 抓不到，只能静态断言）', () => {
    const code = stripCommentsAndStrings(LLM_ENGINE_SOURCE);
    // 先确认剥壳器本身没把代码吃掉：构造逻辑必须仍然可见。
    expect(code).toContain('readDefaultMaxConcurrency');
    // process 不得作为全局标识符被读取（`x.process` / `process.env` 两种形态都算违规读取）。
    expect(code).not.toMatch(/(^|[^.\w$])process\s*[.[]/);
  });

  it('浏览器环境（无 process 全局）下构造 LlmEngine 不抛错', () => {
    expect(() => withoutProcessGlobal(() => new LlmEngine())).not.toThrow();
  });

  it('默认并发上限回退为 2，且为合法正整数', () => {
    const value = readDefaultMaxConcurrency();
    expect(value).toBe(2);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(1);
  });

  it('显式传入的 maxConcurrency 优先于默认值', () => {
    const engine = withoutProcessGlobal(() => new LlmEngine({ maxConcurrency: 5 }));
    expect(engine.getOptions().maxConcurrency).toBe(5);
  });
});

describe('LlmEngine · 并发上限校验不受本次改动影响', () => {
  it.each([0, -1, 1.5, Number.NaN])('非法并发上限 %p 仍抛中文错误', (bad) => {
    expect(() => new LlmEngine({ maxConcurrency: bad })).toThrow('maxConcurrency 必须为正整数');
  });

  it('合法并发上限 1 可用（下界）', () => {
    expect(new LlmEngine({ maxConcurrency: 1 }).getOptions().maxConcurrency).toBe(1);
  });
});
