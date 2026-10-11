/**
 * 服务端决策控制器 (SOLID - SRP / DIP 原则)。
 * 负责 HTTP 请求解析、路由校验、调用 DecisionService 并输出结构化 JSON 响应。
 * 依赖抽象接口 HttpLikeRequest / HttpLikeResponse，完全解耦底层环境。
 */
import { DecisionService } from '../services/decisionService';
import { DecisionRequest } from '../types';
import type { DecisionStreamEvent } from '../../src/ai/engines/decisionProtocol';

export interface HttpLikeRequest {
  method?: string;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

export interface HttpLikeResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(data?: string | Uint8Array): void;
  write?(data: string | Uint8Array): unknown;
  flushHeaders?(): void;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

export class DecisionController {
  private readonly decisionService: DecisionService;

  constructor(decisionService: DecisionService) {
    this.decisionService = decisionService;
  }

  async handleDecision(req: HttpLikeRequest, res: HttpLikeResponse, bodyStr: string): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: '只支持 POST 请求' }));
      return;
    }

    let requestPayload: DecisionRequest;
    try {
      requestPayload = JSON.parse(bodyStr);
    } catch (e: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `无效的 JSON 请求体: ${e.message}` }));
      return;
    }

    if (requestPayload.seat === undefined || !requestPayload.phase || !requestPayload.engineType) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: '缺失必要字段: seat, phase, engineType 均为必填项',
        }),
      );
      return;
    }

    const controller = new AbortController();
    const disconnected = () => controller.abort(new DOMException('客户端已取消决策', 'AbortError'));
    req.on?.('aborted', disconnected);
    res.on?.('close', disconnected);
    const streaming = requestPayload.stream === true && typeof res.write === 'function';
    const send = (event: DecisionStreamEvent) => {
      if (!controller.signal.aborted) res.write?.(`data: ${JSON.stringify(event)}\n\n`);
    };
    if (streaming) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      send({ type: 'progress', progress: { seat: requestPayload.seat, phase: 'thinking', text: '正在连接模型，等待首段输出…' } });
    }
    try {
      const response = await this.decisionService.processDecision(requestPayload, controller.signal,
        streaming ? progress => send({ type: 'progress', progress }) : undefined);

      if (controller.signal.aborted) return;
      if (streaming) { send({ type: 'result', response }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(response));
    } catch (e: any) {
      if (controller.signal.aborted) return;
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[DecisionController] 决策执行异常:', e);
      if (streaming) { send({ type: 'error', error: `服务端决策失败: ${errorMsg}` }); res.end(); return; }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: `服务端决策失败: ${errorMsg}`,
          executionEnvironment: 'server',
        }),
      );
    } finally {
      req.off?.('aborted', disconnected);
      res.off?.('close', disconnected);
    }
  }
}
