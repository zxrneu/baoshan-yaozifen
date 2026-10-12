/** 历史错误与基础解析（SRP）：统一可识别错误，不依赖存储实现。 */
export class HistoryProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryProtocolError';
  }
}

export class HistoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryUnavailableError';
  }
}

export const fail = (message: string): never => {
  throw new HistoryProtocolError(message);
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}


export function parseJson(text: string, what: string): unknown {
  try { return JSON.parse(text); }
  catch { return fail(`${what} JSON 解析失败`); }
}
