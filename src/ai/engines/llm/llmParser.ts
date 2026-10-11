/**
 * LLM 响应解析与思考链提取服务 (SOLID - SRP 原则)。
 * 负责清洗 Markdown 代码块、提取推理模型思考链 (<think> / reasoning_content)，
 * 以及针对 4 个决策阶段的强类型安全校验。
 */
import { Card, cardId, cardLabel, cardPoints, Suit, SUITS } from '../../../cards';

export interface ParsedLlmContent {
  cleanJsonText: string;
  embeddedThinking: string;
}

export class LlmResponseParser {
  /**
   * 从返回文本中剥离并提取思考链（适配 DeepSeek-R1 / Qwen-Thinking / vLLM）
   */
  static extractThinkingAndJson(rawContent: string): ParsedLlmContent {
    let content = rawContent.trim();
    let embeddedThinking = '';

    // 1. 匹配并提取 <think>...</think> 标签
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      embeddedThinking = thinkMatch[1].trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    }

    // 2. 清理可能的 Markdown 代码块包裹 (```json ... ```)
    const cleanJsonText = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return { cleanJsonText, embeddedThinking };
  }

  /**
   * 安全解析 JSON 对象
   */
  static safeParseJson<T = any>(cleanJsonText: string): T {
    try {
      return JSON.parse(cleanJsonText);
    } catch (err: any) {
      // 容错：尝试截取首个 { 与末个 }
      const start = cleanJsonText.indexOf('{');
      const end = cleanJsonText.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleanJsonText.slice(start, end + 1));
        } catch {
          // 忽略二次尝试错误
        }
      }
      throw new Error(`LLM 响应无法解析为合法 JSON: ${err.message} (内容: "${cleanJsonText.slice(0, 80)}")`);
    }
  }

  /**
   * 解析叫分决策
   */
  static parseBid(
    rawContent: string,
    legalBids: number[],
    reasoningContent?: string,
  ): {
    bid: number | null;
    thinking: string;
    conclusion: string;
  } {
    const { cleanJsonText, embeddedThinking } = this.extractThinkingAndJson(rawContent);
    const parsed = this.safeParseJson(cleanJsonText);

    let targetBid: number | null = null;
    if (parsed.bid === null || parsed.bid === 'pass' || parsed.bid === 0) {
      targetBid = null;
    } else if (typeof parsed.bid === 'number' && legalBids.includes(parsed.bid)) {
      targetBid = parsed.bid;
    } else if (typeof parsed.bid === 'string' && legalBids.includes(Number(parsed.bid))) {
      targetBid = Number(parsed.bid);
    } else {
      throw new Error(`LLM 返回非法叫分档位: ${parsed.bid} (合法档位: ${legalBids.join(', ')} 或 null)`);
    }

    const rawThinking = parsed.thinking || parsed.thought || '';
    const thinking = [reasoningContent, embeddedThinking, rawThinking].filter(Boolean).join('\n\n')
      || (targetBid === null ? '经手牌牌力与成局风险评估，选择不叫。' : `评估手牌大牌控制力充沛，决定叫 ${targetBid} 分。`);
    const conclusion = parsed.conclusion || (targetBid === null ? '不叫' : `叫 ${targetBid} 分`);

    return { bid: targetBid, thinking, conclusion };
  }

  /**
   * 解析定主决策
   */
  static parseTrump(
    rawContent: string,
    reasoningContent?: string,
  ): {
    trump: Suit;
    thinking: string;
    conclusion: string;
  } {
    const { cleanJsonText, embeddedThinking } = this.extractThinkingAndJson(rawContent);
    const parsed = this.safeParseJson(cleanJsonText);

    const trumpStr = String(parsed.trump ?? '').toUpperCase() as Suit;
    if (!SUITS.includes(trumpStr)) {
      throw new Error(`LLM 返回非法主牌花色: ${parsed.trump} (必须为 S, H, C, D 之一)`);
    }

    const rawThinking = parsed.thinking || parsed.thought || '';
    const thinking = [reasoningContent, embeddedThinking, rawThinking].filter(Boolean).join('\n\n')
      || `综合评估四门花色长度与控场牌力，选定 ${trumpStr} 为主牌。`;
    const conclusion = parsed.conclusion || `定主: ${trumpStr}`;

    return { trump: trumpStr, thinking, conclusion };
  }

  /**
   * 解析扣底决策 (严格拦截 A/10/5 分牌)
   */
  static parseBury(
    rawContent: string,
    hand: Card[],
    reasoningContent?: string,
  ): {
    cards: Card[];
    thinking: string;
    conclusion: string;
  } {
    const { cleanJsonText, embeddedThinking } = this.extractThinkingAndJson(rawContent);
    const parsed = this.safeParseJson(cleanJsonText);

    if (!Array.isArray(parsed.cards) || parsed.cards.length !== 4) {
      throw new Error(`LLM 扣底张数非法：期望恰好 4 张牌，实际返回 ${Array.isArray(parsed.cards) ? parsed.cards.length : typeof parsed.cards}`);
    }

    const chosenCards: Card[] = [];
    const handCopy = [...hand];

    for (const id of parsed.cards) {
      const cardStr = String(id).toUpperCase().trim();
      const idx = handCopy.findIndex((c) => cardId(c).toUpperCase() === cardStr);
      if (idx === -1) {
        throw new Error(`LLM 扣底牌不在手牌中: ${cardStr}`);
      }
      const targetCard = handCopy[idx];
      if (cardPoints(targetCard) > 0) {
        throw new Error(`LLM 违规扣留分牌: ${cardLabel(targetCard)} (分牌 A/10/5 严禁扣底！)`);
      }
      chosenCards.push(targetCard);
      handCopy.splice(idx, 1);
    }

    const rawThinking = parsed.thinking || parsed.thought || '';
    const thinking = [reasoningContent, embeddedThinking, rawThinking].filter(Boolean).join('\n\n')
      || `优先扣除副牌短门小牌造成绝门，保留长套与主牌控制张。`;
    const conclusion = parsed.conclusion || `扣底 ${chosenCards.map((c) => cardLabel(c)).join(' ')}`;

    return { cards: chosenCards, thinking, conclusion };
  }

  /**
   * 解析出牌决策
   */
  static parsePlay(
    rawContent: string,
    candidates: readonly Card[],
    reasoningContent?: string,
  ): {
    card: Card;
    thinking: string;
    conclusion: string;
    confidence?: number;
  } {
    const { cleanJsonText, embeddedThinking } = this.extractThinkingAndJson(rawContent);
    const parsed = this.safeParseJson(cleanJsonText);

    const chosenId = parsed.cardId || parsed.card;
    if (!chosenId || typeof chosenId !== 'string') {
      throw new Error('LLM 输出缺失 cardId 字段');
    }

    const cleanId = chosenId.toUpperCase().trim();
    const matched = candidates.find((c) => cardId(c).toUpperCase() === cleanId);
    if (!matched) {
      throw new Error(`LLM 返回非法候选牌: ${chosenId}，不在当前可选范围内 (${candidates.map((c) => cardId(c)).join(', ')})`);
    }

    const rawThinking = parsed.thinking || parsed.thought || '';
    const rawConclusion = parsed.conclusion || parsed.reason || `出牌 ${cardLabel(matched)}`;
    const thinking = [reasoningContent, embeddedThinking, rawThinking].filter(Boolean).join('\n\n')
      || `根据盘面局面，选择打出 ${cardLabel(matched)}。`;
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence)) : undefined;

    return { card: matched, thinking, conclusion: rawConclusion, confidence };
  }
}
