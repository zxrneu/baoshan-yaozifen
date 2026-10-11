import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import MarkdownView from '../src/components/MarkdownView';
import LlmMessageList from '../src/components/LlmMessageList';

describe('MarkdownView & LlmMessageList Pipeline', () => {
  it('renders markdown headers, bold, inline code, and code blocks cleanly', () => {
    const md = `
# 一级标题
## 二级标题
【核心规则与机制】
普通文本段落包含 **加粗词** 和 \`行内代码\` 以及 *斜体*。
> 这是一个引用提示
- 无序列表项 1
- 无序列表项 2
1. 有序列表 1
2. 有序列表 2

\`\`\`json
{
  "phase": "bidding",
  "seat": 1
}
\`\`\`
    `.trim();

    const html = renderToString(React.createElement(MarkdownView, { content: md }));
    expect(html).toContain('一级标题');
    expect(html).toContain('二级标题');
    expect(html).toContain('【核心规则与机制】');
    expect(html).toContain('加粗词');
    expect(html).toContain('行内代码');
    expect(html).toContain('这是一个引用提示');
    expect(html).toContain('无序列表项 1');
    expect(html).toContain('有序列表 1');
    expect(html).toContain('&quot;phase&quot;: &quot;bidding&quot;');
  });

  it('renders LlmMessageList with system, user, and assistant response in markdown view', () => {
    const payload = {
      model: 'qwen38_27b',
      messages: [
        {
          role: 'system',
          content: '# 系统设定\n你是保山幺子分顶级 AI。',
        },
        {
          role: 'user',
          content: '```json\n{"currentHand": ["AS", "KH"]}\n```\n请做出出牌决策。',
        },
      ],
    };

    const html = renderToString(
      React.createElement(LlmMessageList, {
        requestPayload: payload,
        rawResponse: '{"cardId": "AS", "conclusion": "出牌 黑桃A"}',
        thinking: '手牌有黑桃A控场，先拔大牌',
        modelName: 'qwen38_27b',
      })
    );

    // 检查是否包含各角色徽标与内容
    expect(html).toContain('🤖 System');
    expect(html).toContain('👤 User');
    expect(html).toContain('🧠 Assistant');
    expect(html).toContain('系统设定');
    expect(html).toContain('保山幺子分顶级 AI');
    expect(html).toContain('请做出出牌决策');
    expect(html).toContain('推理思考链');
    expect(html).toContain('手牌有黑桃A控场，先拔大牌');
    expect(html).toContain('&quot;cardId&quot;: &quot;AS&quot;');
  });

  it('handles empty or malformed request payloads gracefully', () => {
    const htmlEmpty = renderToString(React.createElement(LlmMessageList, {}));
    expect(htmlEmpty).toContain('暂无记录到结构化 LLM 会话入参或响应数据');

    const htmlStringPayload = renderToString(
      React.createElement(LlmMessageList, {
        requestPayload: '请直接告诉我叫分',
      })
    );
    expect(htmlStringPayload).toContain('👤 User');
    expect(htmlStringPayload).toContain('请直接告诉我叫分');
  });
});
