/** 请求遥测收集器（SRP）：按逻辑决策隔离主/备用调用，仅保存传输次数与配置身份。 */
import type { DecisionEngine, ModelRequestEvent } from './engineTypes';
import type { ProfileReference } from './profiles';

export interface ModelRequestInvocation {
  engineType: DecisionEngine['type'];
  profile?: ProfileReference;
  modelRequestCount: number | null;
  modelRetryCount: number | null;
  requests: ModelRequestEvent[];
}
export interface ModelRequestStats {
  protocolVersion: 1;
  logicalDecisionId: string;
  modelRequestCount: number | null;
  modelRetryCount: number | null;
  invocations: ModelRequestInvocation[];
}

export class ModelRequestTracker {
  private invocations: ModelRequestInvocation[] = [];
  private closed = false;

  begin(engine: DecisionEngine, profile?: ProfileReference, deterministic = false) {
    const measured = deterministic || !['llm', 'laya'].includes(engine.type) || engine.supportsModelRequestTelemetry === true;
    const invocation: ModelRequestInvocation = { engineType: engine.type, profile: profile ? { ...profile } : undefined,
      modelRequestCount: measured ? 0 : null, modelRetryCount: measured ? 0 : null, requests: [] };
    this.invocations.push(invocation);
    return (event: ModelRequestEvent) => {
      if (this.closed) return;
      invocation.requests.push({ attempt: event.attempt });
      if (invocation.modelRequestCount !== null) invocation.modelRequestCount++;
      if (invocation.modelRetryCount !== null && event.attempt > 1) invocation.modelRetryCount++;
    };
  }

  finish(logicalDecisionId: string): ModelRequestStats {
    this.closed = true;
    return { protocolVersion: 1, logicalDecisionId,
      modelRequestCount: this.invocations.some(value => value.modelRequestCount === null) ? null
        : this.invocations.reduce((sum, value) => sum + (value.modelRequestCount ?? 0), 0),
      modelRetryCount: this.invocations.some(value => value.modelRetryCount === null) ? null
        : this.invocations.reduce((sum, value) => sum + (value.modelRetryCount ?? 0), 0),
      invocations: structuredClone(this.invocations) };
  }
}
