/**
 * 轻量且安全的 Markdown 渲染器 (纯 React 渲染，无需重型三方依赖，防 XSS)。
 * 支持：代码块语法高亮容器、一键复制、多级标题、列表、引用块、行内代码与加粗。
 */
import React, { useState } from 'react';
import styles from './MarkdownView.module.css';

interface Props {
  content: string;
  className?: string;
}

export default function MarkdownView({ content, className = '' }: Props) {
  if (!content || typeof content !== 'string') {
    return <div className={`${styles.markdownRoot} ${className}`}>&nbsp;</div>;
  }

  // 1. 切分代码块与常规文本块
  const parts = parseCodeBlocks(content);

  return (
    <div className={`${styles.markdownRoot} ${className}`}>
      {parts.map((part, index) => {
        if (part.type === 'code') {
          return (
            <CodeBlockCard
              key={index}
              lang={part.lang}
              code={part.text}
            />
          );
        }
        return <TextBlock key={index} text={part.text} />;
      })}
    </div>
  );
}

/**
 * 代码块卡片 (带语言标签与一键复制代码)
 */
function CodeBlockCard({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  // 尝试自动美化 JSON 代码
  let displayCode = code;
  let detectedLang = lang || 'text';
  if ((!lang || lang.toLowerCase() === 'json') && (code.trim().startsWith('{') || code.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(code);
      displayCode = JSON.stringify(parsed, null, 2);
      detectedLang = 'json';
    } catch {
      // 保持原样
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(displayCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={styles.codeBlockContainer}>
      <div className={styles.codeBlockHeader}>
        <span className={styles.codeLang}>{detectedLang}</span>
        <button type="button" className={styles.codeCopyBtn} onClick={handleCopy}>
          {copied ? '✅ 已复制' : '📋 复制'}
        </button>
      </div>
      <pre className={styles.codeContent}>
        <code>{displayCode}</code>
      </pre>
    </div>
  );
}

/**
 * 解析出普通文本段与 ``` 代码块
 */
function parseCodeBlocks(raw: string): Array<{ type: 'text' | 'code'; text: string; lang: string }> {
  const parts: Array<{ type: 'text' | 'code'; text: string; lang: string }> = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        text: raw.slice(lastIndex, match.index),
        lang: '',
      });
    }
    parts.push({
      type: 'code',
      lang: match[1] || '',
      text: match[2].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    parts.push({
      type: 'text',
      text: raw.slice(lastIndex),
      lang: '',
    });
  }

  return parts;
}

/**
 * 逐行解析常规文本段落（标题、列表、引用、分段）
 */
function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    const ListTag = currentList.type;
    const listKey = elements.length;
    elements.push(
      <ListTag key={listKey} className={styles.list}>
        {currentList.items.map((item, idx) => (
          <li key={idx} className={styles.listItem}>
            {renderInlineMarkdown(item)}
          </li>
        ))}
      </ListTag>
    );
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行：刷新列表并产生自然间隙
    if (trimmed === '') {
      flushList();
      continue;
    }

    // 分隔线 --- / ***
    if (/^([-*_]){3,}$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={elements.length} className={styles.hr} />);
      continue;
    }

    // 标题 # ~ ####
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h2 key={elements.length} className={styles.h1}>{renderInlineMarkdown(trimmed.slice(2))}</h2>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={elements.length} className={styles.h2}>{renderInlineMarkdown(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={elements.length} className={styles.h3}>{renderInlineMarkdown(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushList();
      elements.push(<h5 key={elements.length} className={styles.h4}>{renderInlineMarkdown(trimmed.slice(5))}</h5>);
      continue;
    }

    // 中文系统提示词常见段落标题：【...】
    if (/^【.+】$/.test(trimmed)) {
      flushList();
      elements.push(
        <div key={elements.length} className={styles.sectionBracketTitle}>
          {trimmed}
        </div>
      );
      continue;
    }

    // 引用块 >
    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote key={elements.length} className={styles.blockquote}>
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      continue;
    }

    // 无序列表 - 或 *
    if (/^[-*]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*]\s+/, '');
      if (currentList && currentList.type === 'ul') {
        currentList.items.push(itemText);
      } else {
        flushList();
        currentList = { type: 'ul', items: [itemText] };
      }
      continue;
    }

    // 有序列表 1. 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+\.\s+/, '');
      if (currentList && currentList.type === 'ol') {
        currentList.items.push(itemText);
      } else {
        flushList();
        currentList = { type: 'ol', items: [itemText] };
      }
      continue;
    }

    // 普通段落行
    flushList();
    elements.push(
      <p key={elements.length} className={styles.paragraph}>
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  flushList();
  return <>{elements}</>;
}

/**
 * 行内解析 (内联代码 `code`, 加粗 **bold**, 斜体 *italic*)
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  // 正则切分行内元素：`code` 或 **bold** 或 *italic*
  const tokens: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = tokens.length;

    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code key={key} className={styles.inlineCode}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={key} className={styles.bold}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={key} className={styles.italic}>
          {token.slice(1, -1)}
        </em>
      );
    } else {
      tokens.push(token);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens.length === 0 ? text : <>{tokens}</>;
}
