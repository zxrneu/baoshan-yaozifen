/**
 * LLM 消息列表 Markdown 展示组件 (SOLID - SRP 原则)。
 * 负责将发送给大模型的多角色消息流 (System, User) 与模型响应 (Assistant, Thinking)
 * 进行清晰的美化解析与 Markdown 结构化展示，支持视图切换与一键复制。
 */
import { useMemo, useState } from 'react';
import MarkdownView from './MarkdownView';
import styles from './LlmMessageList.module.css';

export interface DisplayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export interface LlmMessageListProps {
  requestPayload?: unknown;
  promptPayload?: unknown;
  rawResponse?: string;
  thinking?: string;
  modelName?: string;
}

export default function LlmMessageList({
  requestPayload,
  promptPayload,
  rawResponse,
  thinking,
  modelName,
}: LlmMessageListProps) {
  const [activeTab, setActiveTab] = useState<'markdown' | 'raw'>('markdown');
  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // 解析出结构化消息列表
  const messages: DisplayMessage[] = useMemo(() => {
    const list: DisplayMessage[] = [];
    const source = requestPayload ?? promptPayload;

    if (source) {
      let payloadObj = source;
      if (typeof source === 'string') {
        try {
          payloadObj = JSON.parse(source);
        } catch {
          payloadObj = { prompt: source };
        }
      }

      if (typeof payloadObj === 'object' && payloadObj !== null) {
        const obj = payloadObj as any;
        if (Array.isArray(obj.messages)) {
          for (const m of obj.messages) {
            if (m && typeof m === 'object' && typeof m.content === 'string') {
              list.push({
                role: m.role || 'user',
                content: m.content,
              });
            }
          }
        } else if (Array.isArray(obj)) {
          for (const m of obj) {
            if (m && typeof m === 'object' && typeof m.content === 'string') {
              list.push({
                role: m.role || 'user',
                content: m.content,
              });
            }
          }
        } else if (typeof obj.prompt === 'string') {
          list.push({
            role: 'user',
            content: obj.prompt,
          });
        }
      }
    }

    // 若存在模型响应或思考链，追加 Assistant 消息卡片
    if (rawResponse || thinking) {
      list.push({
        role: 'assistant',
        content: rawResponse || '(模型响应)',
        thinking: thinking,
      });
    }

    return list;
  }, [requestPayload, promptPayload, rawResponse, thinking]);

  // 默认对超长的 System Prompt 设为折叠，优化首屏阅读
  const isCollapsed = (idx: number, role: string, length: number) => {
    if (collapsedMap[idx] !== undefined) return collapsedMap[idx];
    return role === 'system' && length > 500;
  };

  const toggleCollapse = (idx: number, role: string, length: number) => {
    const current = isCollapsed(idx, role, length);
    setCollapsedMap((prev) => ({ ...prev, [idx]: !current }));
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(`✅ ${label} 已复制`);
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  };

  const rawJsonString = useMemo(() => {
    const data = {
      model: modelName,
      requestPayload: requestPayload ?? promptPayload,
      rawResponse,
      thinking,
    };
    return JSON.stringify(data, null, 2);
  }, [requestPayload, promptPayload, rawResponse, thinking, modelName]);

  const getRoleDesc = (role: string) => {
    switch (role) {
      case 'system':
        return '系统设定 · 规则底层与专家经验基准';
      case 'user':
        return '用户提示 · 实时局势快照与决策目标';
      case 'assistant':
        return `模型回复 · ${modelName || '大语言模型'}`;
      default:
        return '对话消息';
    }
  };

  return (
    <div className={styles.container}>
      {/* 顶部选项卡切换 */}
      <div className={styles.tabBar}>
        <div className={styles.tabGroup}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'markdown' ? styles.active : ''}`}
            onClick={() => setActiveTab('markdown')}
          >
            💬 消息流 Markdown ({messages.length} 条)
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'raw' ? styles.active : ''}`}
            onClick={() => setActiveTab('raw')}
          >
            {'{ }'} 原始 JSON 报文
          </button>
        </div>

        {copyFeedback && (
          <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>
            {copyFeedback}
          </span>
        )}
      </div>

      {/* 视图 1：Markdown 格式化消息卡片列表 */}
      {activeTab === 'markdown' && (
        <div className={styles.messagesList}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <span>(暂无记录到结构化 LLM 会话入参或响应数据)</span>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const collapsed = isCollapsed(idx, msg.role, msg.content.length);

              return (
                <div
                  key={idx}
                  className={`${styles.messageCard} ${styles[msg.role] || ''}`}
                >
                  <div className={styles.messageHeader}>
                    <div className={styles.roleGroup}>
                      <span className={`${styles.roleBadge} ${styles[msg.role] || ''}`}>
                        {msg.role === 'system'
                          ? '🤖 System'
                          : msg.role === 'user'
                          ? '👤 User'
                          : '🧠 Assistant'}
                      </span>
                      <span className={styles.roleDesc}>{getRoleDesc(msg.role)}</span>
                    </div>

                    <div className={styles.headerActions}>
                      <span className={styles.charCount}>
                        {msg.content.length.toLocaleString()} 字符
                      </span>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => handleCopyText(msg.content, `${msg.role} 消息`)}
                      >
                        📋 复制
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => toggleCollapse(idx, msg.role, msg.content.length)}
                      >
                        {collapsed ? '▼ 展开' : '▲ 收起'}
                      </button>
                    </div>
                  </div>

                  {!collapsed && (
                    <div className={styles.messageBody}>
                      {/* 若 Assistant 包含思维链 (<think>)，单独以紫色框折叠展示 */}
                      {msg.role === 'assistant' && msg.thinking && msg.thinking.trim() !== '' && (
                        <details className={styles.thinkingCollapse} open>
                          <summary>🧠 推理思考链 (Reasoning / Thinking Content)</summary>
                          <div className={styles.thinkingInner}>
                            <MarkdownView content={msg.thinking} />
                          </div>
                        </details>
                      )}

                      <MarkdownView content={msg.content} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 视图 2：原始 JSON 报文展示 */}
      {activeTab === 'raw' && (
        <div className={styles.rawJsonContainer}>
          <div className={styles.rawJsonHeader}>
            <span>Request Payload & Raw Response (完整技术报文)</span>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => handleCopyText(rawJsonString, '原始 JSON')}
            >
              📋 复制完整 JSON
            </button>
          </div>
          <pre className={styles.rawJsonCode}>
            <code>{rawJsonString}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
