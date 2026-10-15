/**
 * 验证服务端默认 LLM 引擎读取 token 预算与思考链档位环境变量。
 * 采用依赖注入隔离网络，断言引擎选项而非真实请求（DIP）。
 */
import { describe, expect, it } from 'vitest';
import { ServerEngineRegistry } from '../server/engines/serverEngineRegistry';
import { LlmEngine } from '../src/ai/engines/llmEngine';

function llmOptions(env: Record<string, string | undefined>) {
  const registry = new ServerEngineRegistry({ env });
  const engine = registry.get('llm');
  expect(engine).toBeInstanceOf(LlmEngine);
  return (engine as LlmEngine).getOptions();
}

describe('服务端 LLM 引擎环境变量', () => {
  it('LLM_MAX_TOKENS 注入引擎的 maxTokens，缺省时保持未设置', () => {
    expect(llmOptions({ LLM_MAX_TOKENS: '8192' }).maxTokens).toBe(8192);
    expect(llmOptions({}).maxTokens).toBeUndefined();
  });

  it('LLM_REASONING_EFFORT 注入引擎的 reasoningEffort，缺省回落 low', () => {
    expect(llmOptions({ LLM_REASONING_EFFORT: 'none' }).reasoningEffort).toBe('none');
    expect(llmOptions({}).reasoningEffort).toBe('low');
  });

  it('非法 LLM_MAX_TOKENS 与非白名单档位被忽略，不产生无效请求参数', () => {
    expect(llmOptions({ LLM_MAX_TOKENS: 'abc' }).maxTokens).toBeUndefined();
    expect(llmOptions({ LLM_MAX_TOKENS: '0' }).maxTokens).toBeUndefined();
    expect(llmOptions({ LLM_REASONING_EFFORT: 'ultra' }).reasoningEffort).toBe('low');
  });

  it('default-llm 引擎配置档案同样带上补全参数，保证走档案路由时行为一致', () => {
    const registry = new ServerEngineRegistry({ env: { LLM_MAX_TOKENS: '8192', LLM_REASONING_EFFORT: 'none' } });
    const profile = registry.getProfile('default-llm');
    expect(profile.parameters.options).toMatchObject({ maxTokens: 8192, reasoningEffort: 'none' });
  });

  it('单次请求覆盖档位时，maxTokens 仍从服务端默认继承', () => {
    const registry = new ServerEngineRegistry({ env: { LLM_MAX_TOKENS: '8192' } });
    const perRequest = registry.forRequest('llm', { model: 'other-model', reasoningEffort: 'high' });
    expect((perRequest as LlmEngine).getOptions()).toMatchObject({
      model: 'other-model', reasoningEffort: 'high', maxTokens: 8192,
    });
  });
});
