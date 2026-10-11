/**
 * AI 决策日志与思考推演大厅（Master-Detail 双栏深度审查器）。
 * 满足：
 * 1. 结构化分离查看出牌结论（Conclusion）与深度思考过程（Thinking）；
 * 2. 候选牌比选高亮与局势快照；
 * 3. 响应式实时监听与 JSON 导出。
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, SUIT_NAME, SUIT_SYMBOL, Suit, cardPoints } from '../cards';
import { SEAT_NAMES } from '../engine';
import { decisionLogger } from '../ai/engines/decisionLogger';
import { DecisionRecord, EngineType } from '../ai/engines/engineTypes';
import CardView from '../CardView';
import { actionLabel } from '../workbench/actions';
import styles from './DecisionLogModal.module.css';

interface Props {
  initialRecordId?: string;
  onClose: () => void;
}

const SEAT_AVATARS: Record<number, { emoji: string; title: string }> = {
  0: { emoji: '🤠', title: '东家' },
  1: { emoji: '👑', title: '南家' },
  2: { emoji: '🎩', title: '西家' },
  3: { emoji: '👲', title: '北家' },
};

const ENGINE_LABELS: Record<EngineType, string> = {
  llm: '大语言模型',
  bridge: '桥牌思考',
  algorithm: '传统算法',
  laya: 'Laya 模型',
};

export default function DecisionLogModal({ initialRecordId, onClose }: Props) {
  const [records, setRecords] = useState<readonly DecisionRecord[]>(() =>
    decisionLogger.getRecords(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialRecordId ?? null);

  // 筛选器状态
  const [seatFilter, setSeatFilter] = useState<string>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [onlyThinking, setOnlyThinking] = useState(false);

  // 复制状态提示
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  // 响应式监听决策日志更新
  useEffect(() => {
    return decisionLogger.subscribe(() => {
      setRecords([...decisionLogger.getRecords()]);
    });
  }, []);

  // 过滤后的记录列表（时间倒序排列，最新决策在最前）
  const filteredRecords = useMemo(() => {
    return [...records].reverse().filter((rec) => {
      if (seatFilter !== 'all' && rec.seat !== Number(seatFilter)) return false;
      if (engineFilter !== 'all' && rec.engineType !== engineFilter) return false;
      if (onlyThinking && (!rec.thinking || rec.thinking.trim() === '')) return false;
      return true;
    });
  }, [records, seatFilter, engineFilter, onlyThinking]);

  // 当前选中的决策记录
  const activeRecord = useMemo(() => {
    if (filteredRecords.length === 0) return null;
    if (selectedId) {
      const found = filteredRecords.find((r) => r.id === selectedId);
      if (found) return found;
    }
    return filteredRecords[0];
  }, [filteredRecords, selectedId]);

  // 导出全部 JSON
  const handleExportJson = () => {
    const jsonStr = decisionLogger.exportJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baoshan-yaozifen-decisions-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 清空记录
  const handleClear = () => {
    if (window.confirm('确定要清空当前所有对局决策记录吗？')) {
      decisionLogger.clear();
      setSelectedId(null);
    }
  };

  // 复制当前思考内容
  const handleCopyThinking = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyNotice('✅ 思考内容已复制到剪贴板');
      setTimeout(() => setCopyNotice(null), 2000);
    });
  };

  const getEngineBadgeClass = (type: EngineType, hasFallback: boolean) => {
    if (hasFallback) return styles.fallbackTag;
    switch (type) {
      case 'llm':
        return styles.badgeLlm;
      case 'bridge':
        return styles.badgeBridge;
      case 'algorithm':
        return styles.badgeAlgo;
      case 'laya':
        return styles.badgeLaya;
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-box ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题栏 */}
        <div className="modal-header">
          <div className={styles.modalHeaderTitle}>
            <span>🧠</span>
            <h2>AI 决策日志与思考推演大厅</h2>
            <span className={styles.recordCountBadge}>共 {records.length} 条记录</span>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* 过滤器工具栏 */}
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>座位:</span>
            <select
              className={styles.filterSelect}
              value={seatFilter}
              onChange={(e) => setSeatFilter(e.target.value)}
            >
              <option value="all">全部座位</option>
              <option value="0">🤠 东家</option>
              <option value="1">👑 南家</option>
              <option value="2">🎩 西家</option>
              <option value="3">👲 北家</option>
            </select>

            <span className={styles.filterLabel}>引擎:</span>
            <select
              className={styles.filterSelect}
              value={engineFilter}
              onChange={(e) => setEngineFilter(e.target.value)}
            >
              <option value="all">全部引擎</option>
              <option value="llm">大语言模型 (LLM)</option>
              <option value="bridge">桥牌深度思考</option>
              <option value="algorithm">传统算法</option>
              <option value="laya">Laya 模型</option>
            </select>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={onlyThinking}
                onChange={(e) => setOnlyThinking(e.target.checked)}
              />
              <span>只看有思考推演</span>
            </label>
          </div>

          <div className={styles.headerActionGroup}>
            <button
              type="button"
              className={styles.actionBtnSmall}
              disabled={records.length === 0}
              onClick={handleExportJson}
            >
              📥 导出 JSON
            </button>
            <button
              type="button"
              className={styles.actionBtnSmall}
              disabled={records.length === 0}
              onClick={handleClear}
            >
              🗑️ 清空
            </button>
          </div>
        </div>

        {/* 双栏主体 */}
        <div className={styles.bodyContainer}>
          {/* 左侧 Master 列表 */}
          <div className={styles.masterList}>
            {filteredRecords.length === 0 ? (
              <div className={styles.emptyList}>
                <span>暂无符合条件的决策记录</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>电脑出牌时将自动记录</span>
              </div>
            ) : (
              filteredRecords.map((rec) => {
                const isSelected = activeRecord?.id === rec.id;
                const avatar = SEAT_AVATARS[rec.seat];
                const card = rec.chosenCard;
                const isRed = card?.suit === 'H' || card?.suit === 'D';
                const pts = card ? cardPoints(card) : 0;

                return (
                  <div
                    key={rec.id}
                    className={`${styles.logCard} ${isSelected ? styles.active : ''}`}
                    onClick={() => setSelectedId(rec.id)}
                  >
                    <div className={styles.logCardHeader}>
                      <span className={styles.cardSeat}>
                        <span>{avatar.emoji}</span>
                        <span>{SEAT_NAMES[rec.seat]}</span>
                      </span>
                      <span className={styles.cardTrickTag}>第 {rec.trickNumber} 轮</span>
                    </div>

                    <div className={styles.cardRow}>
                      <div className={styles.cardPlayPreview}>
                        <span
                          className={`${styles.cardPlayChip} ${isRed ? styles.red : styles.black}`}
                        >
                          {card ? SUIT_SYMBOL[card.suit] + card.rank : actionLabel(rec.action)}
                        </span>
                        {pts > 0 && <span className={styles.cardPointsBadge}>{pts}分</span>}
                      </div>

                      <span
                        className={`${styles.engineBadge} ${getEngineBadgeClass(
                          rec.engineType,
                          Boolean(rec.fallbackReason),
                        )}`}
                      >
                        {rec.fallbackReason
                          ? `${rec.requestedEngine}➔算法`
                          : ENGINE_LABELS[rec.engineType] ?? rec.engineType}
                      </span>
                    </div>

                    <div className={styles.cardConclusionSnippet}>
                      {rec.conclusion ?? rec.diagnostic ?? '正常出牌'}
                    </div>

                    <div className={styles.cardLatency}>
                      耗时 {Math.round(rec.latencyMs)}ms ·{' '}
                      {new Date(rec.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 右侧 Detail 审查面板 */}
          <div className={styles.detailPane}>
            {!activeRecord ? (
              <div className={styles.detailEmpty}>
                <span>👈 请在左侧选择一条决策记录查看详细思考与局势推演</span>
              </div>
            ) : (
              <>
                {/* 模块 1：结论英雄卡片 */}
                <div className={styles.conclusionHeroCard}>
                  <div className={heroStyleGroup(activeRecord.chosenCard)}>
                    <div className={styles.heroCardDisplay}>
                      <>{activeRecord.chosenCard ? <CardView card={activeRecord.chosenCard} size="normal" /> : actionLabel(activeRecord.action)}</>
                    </div>
                    <div className={styles.heroText}>
                      <div className={styles.heroTitleRow}>
                        <span className={styles.heroPlayerName}>
                          {SEAT_AVATARS[activeRecord.seat].emoji}{' '}
                          {SEAT_NAMES[activeRecord.seat]}家决策
                        </span>
                        <span
                          className={`${styles.engineBadge} ${getEngineBadgeClass(
                            activeRecord.engineType,
                            Boolean(activeRecord.fallbackReason),
                          )}`}
                        >
                          {ENGINE_LABELS[activeRecord.engineType] ?? activeRecord.engineType}
                        </span>
                      </div>
                      <div className={styles.heroConclusion}>
                        💡{' '}
                        {activeRecord.conclusion ??
                          activeRecord.diagnostic ??
                          actionLabel(activeRecord.action)}
                      </div>
                    </div>
                  </div>

                  <div className={styles.heroRightMeta}>
                    <span className={styles.metaItem}>
                      耗时: <strong>{Math.round(activeRecord.latencyMs)} ms</strong>
                    </span>
                    {activeRecord.modelName && (
                      <span className={styles.metaItem}>
                        模型: <strong>{activeRecord.modelName}</strong>
                      </span>
                    )}
                    {activeRecord.confidence !== undefined && (
                      <span className={styles.metaItem}>
                        置信度: <strong>{(activeRecord.confidence * 100).toFixed(0)}%</strong>
                      </span>
                    )}
                    {activeRecord.searchWinRate !== undefined && (
                      <span className={styles.metaItem}>
                        估计胜率: <strong>{(activeRecord.searchWinRate * 100).toFixed(1)}%</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* 回退警报提醒 */}
                {activeRecord.fallbackReason && (
                  <div className={styles.fallbackAlert}>
                    <span>⚠️</span>
                    <span>
                      发生降级回退：{activeRecord.fallbackReason}（已自动由备用引擎平滑接管）
                    </span>
                  </div>
                )}

                {/* 模块 2：深度思考流容器 */}
                <div className={styles.thinkingSection}>
                  <div className={styles.thinkingHeader}>
                    <div className={styles.thinkingTitle}>
                      <span>🧠</span>
                      <span>深度思考与思维链推演 (Thinking Process)</span>
                    </div>
                    <div className={styles.thinkingHeaderActions}>
                      {copyNotice && (
                        <span style={{ fontSize: 11.5, color: '#10b981' }}>{copyNotice}</span>
                      )}
                      <span className={styles.wordCountTag}>
                        {activeRecord.thinking?.length ?? 0} 字
                      </span>
                      {activeRecord.thinking && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => handleCopyThinking(activeRecord.thinking!)}
                        >
                          复制思考
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={styles.thinkingContent}>
                    {activeRecord.thinking && activeRecord.thinking.trim() !== ''
                      ? activeRecord.thinking
                      : '(该步决策未输出长思维链或为唯一候选快速打出)'}
                  </div>
                </div>

                {/* 模块 3：候选牌比选展区 */}
                <div className={styles.sectionCard}>
                  <div className={styles.sectionTitle}>
                    <span>🎴</span>
                    <span>当轮可选候选牌对比 ({activeRecord.candidates.length} 张)</span>
                  </div>
                  <div className={styles.candidatesGrid}>
                    {activeRecord.candidates.map((cand, idx) => {
                      const isChosen =
                        cand.rank === activeRecord.chosenCard?.rank &&
                        cand.suit === activeRecord.chosenCard?.suit;
                      return (
                        <div
                          key={idx}
                          className={`${styles.candidateItem} ${
                            isChosen ? styles.isChosen : styles.isEliminated
                          }`}
                        >
                          <CardView card={cand} size="small" />
                          <span
                            className={`${styles.candidateStatusBadge} ${
                              isChosen ? styles.winner : styles.other
                            }`}
                          >
                            {isChosen ? '最终选定' : '放弃'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 模块 4：局面快照 */}
                <div className={styles.sectionCard}>
                  <div className={styles.sectionTitle}>
                    <span>📸</span>
                    <span>决策时对局快照</span>
                  </div>
                  <div className={styles.snapshotGrid}>
                    <div className={styles.snapshotBox}>
                      <span className={styles.snapshotLabel}>当前轮次已出牌</span>
                      <div className={styles.snapshotCardsRow}>
                        {activeRecord.currentRound.length === 0 ? (
                          <span style={{ fontSize: 12, opacity: 0.6 }}>首家主动领出</span>
                        ) : (
                          activeRecord.currentRound.map((t, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <span style={{ fontSize: 11, opacity: 0.8 }}>
                                {SEAT_NAMES[t.seat]}:
                              </span>
                              <CardView card={t.card} size="small" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className={styles.snapshotBox}>
                      <span className={styles.snapshotLabel}>主牌与叫分比分</span>
                      <div className={styles.snapshotValue}>
                        主牌:{' '}
                        {activeRecord.trump
                          ? `${SUIT_SYMBOL[activeRecord.trump as Suit]} ${
                              SUIT_NAME[activeRecord.trump as Suit]
                            }`
                          : '未定'}{' '}
                        · 叫分: {activeRecord.bid ?? 70}分
                      </div>
                      <span style={{ fontSize: 11.5, opacity: 0.75 }}>
                        庄方吃分: {activeRecord.declarerPoints ?? 0} · 闲方吃分:{' '}
                        {activeRecord.defenderPoints ?? 0}
                      </span>
                    </div>

                    <div className={styles.snapshotBox}>
                      <span className={styles.snapshotLabel}>👀 决策时上帝视角 (God Mode)</span>
                      <div className={styles.snapshotValue} style={{ fontSize: 12.5 }}>
                        {activeRecord.godModeState?.enabled ? (
                          <span style={{ color: '#4ade80' }}>
                            ✅ 已开启
                            {activeRecord.godModeState.peekedSeats.length > 0
                              ? ` (透视: ${activeRecord.godModeState.peekedSeats
                                  .map((s) => `${SEAT_NAMES[s]}家`)
                                  .join('、')})`
                              : ' (未翻开单人暗牌)'}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255, 255, 255, 0.55)' }}>
                            🔒 已关闭 (正常公正竞技)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={styles.snapshotBox} style={{ gridColumn: '1 / -1' }}>
                      <span className={styles.snapshotLabel}>
                        当时手中剩余手牌 ({activeRecord.ownHand.length} 张)
                      </span>
                      <div className={styles.snapshotCardsRow}>
                        {activeRecord.ownHand.map((c, i) => (
                          <CardView key={i} card={c} size="small" />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 异常与降级告警通知 */}
                {(activeRecord.fallbackReason || activeRecord.errorDetails) && (
                  <div className={styles.errorNoticeBox}>
                    <div style={{ fontWeight: 800, color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>⚠️</span>
                      <span>模型异常与降级接管记录</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4, fontFamily: 'monospace', lineHeight: 1.4 }}>
                      {activeRecord.errorDetails || activeRecord.fallbackReason}
                    </div>
                  </div>
                )}

                {/* 模块 5：技术审计报文（折叠） */}
                {(activeRecord.requestPayload || activeRecord.promptPayload) && (
                  <details className={styles.debugDetails}>
                    <summary>📤 查看模型请求入参 (Request Payload)</summary>
                    <pre className={styles.debugCode}>
                      {typeof (activeRecord.requestPayload || activeRecord.promptPayload) === 'string'
                        ? (activeRecord.requestPayload || activeRecord.promptPayload)
                        : JSON.stringify(activeRecord.requestPayload || activeRecord.promptPayload, null, 2)}
                    </pre>
                  </details>
                )}
                {activeRecord.rawResponse && (
                  <details className={styles.debugDetails}>
                    <summary>📥 查看模型原始返回数据 (Raw Response Debug)</summary>
                    <pre className={styles.debugCode}>{activeRecord.rawResponse}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="modal-footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function heroStyleGroup(_c?: Card): string {
  return styles.heroLeft;
}
