import type { LlmCompletionResponse } from './llmClient';

export type LlmStreamSnapshot = Pick<LlmCompletionResponse, 'rawText' | 'reasoningContent'>;

/** Only the first choice belongs to this decision; ignore usage-only chunks. */
export function appendLlmChunk(snapshot: LlmStreamSnapshot, chunk: any): boolean {
  if (chunk.error) throw new Error(chunk.error.message ?? 'LLM 流式请求失败');
  const choice = chunk.choices?.find((item: any) => (item.index ?? 0) === 0);
  if (!choice) return false;
  const delta = choice.delta ?? choice.message;
  const content = delta?.content ?? choice.text;
  const reasoning = delta?.reasoning ?? delta?.reasoning_content ?? choice.reasoning_content;
  if (typeof content === 'string') snapshot.rawText += content;
  if (typeof reasoning === 'string') snapshot.reasoningContent = (snapshot.reasoningContent ?? '') + reasoning;
  if (choice.finish_reason && !['stop', 'length'].includes(choice.finish_reason)) {
    throw new Error(`LLM 流式输出中止: ${choice.finish_reason}`);
  }
  if (choice.finish_reason === 'length') throw new Error('LLM 流式输出达到长度限制，决策未完成');
  return choice.finish_reason === 'stop';
}

/** Read a JSON string value before the full decision is complete, without executing partial JSON. */
function partialString(json: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!match) return '';
  let text = '';
  for (let i = match.index + match[0].length; i < json.length; i++) {
    const char = json[i];
    if (char === '"') break;
    if (char !== '\\') { text += char; continue; }
    const escaped = json[++i];
    if (!escaped) break;
    if (escaped === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      text += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else {
      text += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escaped] ?? escaped;
    }
  }
  return text;
}

export function streamDisplay(snapshot: LlmStreamSnapshot): { text: string; conclusion?: string } {
  const think = /<think>([\s\S]*?)(?:<\/think>|$)/i.exec(snapshot.rawText);
  // Withhold a split closing tag while it is still arriving.
  const embedded = think?.[1].replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '') ?? '';
  const json = think ? snapshot.rawText.slice((think.index ?? 0) + think[0].length) : snapshot.rawText;
  const text = [snapshot.reasoningContent, embedded, partialString(json, 'thinking') || partialString(json, 'thought')]
    .filter(Boolean).join('\n\n');
  return { text: text || '正在接收模型输出…', conclusion: partialString(json, 'conclusion') || partialString(json, 'reason') || undefined };
}
