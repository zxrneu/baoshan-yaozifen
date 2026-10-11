/** Decode SSE incrementally, including UTF-8 and event boundaries split across reads. */
export async function* readEventStream(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error('流式响应缺失可读内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines: string[] = [];
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('已取消流式请求', 'AbortError'); };
  try {
    while (true) {
      check();
      const { done, value } = await reader.read();
      check();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Retain a trailing CR until the next read, in case it belongs to CRLF.
      const parts = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = parts.pop() ?? '';
      if (done && buffer) { parts.push(buffer.replace(/\r$/, '')); buffer = ''; }
      for (const line of parts) {
        if (line === '') {
          if (lines.length) { yield lines.join('\n'); lines = []; }
        } else if (line.startsWith('data:')) {
          lines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (done) { if (lines.length) yield lines.join('\n'); break; }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
