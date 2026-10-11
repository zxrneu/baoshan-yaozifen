/**
 * DebugSidePanel：全功能上帝调试控制台（更宽面板 + 5 大专业诊断选项卡）。
 * 选项卡架构：
 * 1. 🧠 思维推演 (Think & Diagnostics)：实时流式思考、结论、诊断指标与请求审查
 * 2. 🎯 候选比选 (Candidate Moves Breakdown)：所有合法走法胜率、期望分、战术标签比对与强制代打
 * 3. 📊 绝门与记牌 (Ledger & Void Suits Matrix)：四方绝门红绿灯矩阵 + 100 分分牌盘点 + 大牌存活
 * 4. 📜 决策追溯 (History Trace)：逐轮决策时间线与原地展开审查
 * 5. 🛠️ 沙盒工具 (Sandbox & Cheats)：撤销上一手 (Undo)、种子重开、快速切换引擎、导出快照
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, cardId, cardLabel, cardPoints, SUIT_SYMBOL, Suit } from '../cards';
import { GameState, SEAT_NAMES, legalMoves } from '../engine';
import { AiAction, EngineType } from '../ai';
import { thinkingService, ThinkingState } from '../ai/engines/thinkingService';
import { decisionLogger } from '../ai/engines/decisionLogger';
import { DecisionRecord, CandidateMoveEvaluation } from '../ai/engines/engineTypes';
import { inferVoidSuits } from '../ai/optimized/observation';
import styles from './DebugSidePanel.module.css';

interface Props {
  game: GameState;
  seat: number;
  engineType: EngineType;
  setEngineType: (type: EngineType) => void;
  isStepMode: boolean;
  setIsStepMode: (v: boolean) => void;
  isThinking: boolean;
  pendingAiAction: AiAction | null;
  aiHintAction: AiAction | null;
  stepNext: () => Promise<void>;
  triggerAiHint: () => Promise<void>;
  manualPlaySeat: (seat: number, card: Card) => void;
  undo: () => boolean;
  canUndo: boolean;
  restart: (seed?: number) => void;
  soundMuted: boolean;
  toggleSoundMute: () => void;
  onOpenEngineSettings: () => void;
  onOpenDecisionLog: () => void;
}

type DebugTab = 'think' | 'candidates' | 'ledger' | 'history' | 'sandbox';

const ALL_SUITS: Suit[] = ['S', 'H', 'C', 'D'];
const POINT_RANKS = ['A', '10', '5'] as const;

export default function DebugSidePanel({
  game,
  seat,
  engineType,
  setEngineType,
  isStepMode,
  setIsStepMode,
  isThinking,
  pendingAiAction,
  aiHintAction,
  stepNext,
  triggerAiHint,
  manualPlaySeat,
  undo,
  canUndo,
  restart,
  soundMuted,
  toggleSoundMute,
  onOpenEngineSettings,
  onOpenDecisionLog,
}: Props) {
  const [activeTab, setActiveTab] = useState<DebugTab>('think');
  const [thinkingState, setThinkingState] = useState<ThinkingState>(() =>
    thinkingService.getState(),
  );
  const [records, setRecords] = useState<readonly DecisionRecord[]>(() => decisionLogger.getRecords());
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [customSeed, setCustomSeed] = useState<string>('12345');
  const [showPayloadDrawer, setShowPayloadDrawer] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    return thinkingService.subscribe((s) => {
      setThinkingState(s);
    });
  }, []);

  useEffect(() => {
    return decisionLogger.subscribe(() => {
      setRecords([...decisionLogger.getRecords()]);
    });
  }, []);

  const latestRecord = records[records.length - 1];
  const actorName = seat >= 0 ? SEAT_NAMES[seat] : '无';

  // 计算 Next 按钮文案
  let nextButtonText = '下一步 (Next · Space)';
  if (isThinking) {
    nextButtonText = 'AI 正在深度思考...';
  } else if (pendingAiAction) {
    if (pendingAiAction.kind === 'play') {
      nextButtonText = `执行: ${SEAT_NAMES[pendingAiAction.seat]} 出 ${cardLabel(pendingAiAction.card)}`;
    } else if (pendingAiAction.kind === 'bid') {
      nextButtonText = `执行: ${SEAT_NAMES[pendingAiAction.seat]} 叫 ${pendingAiAction.bid ?? '不叫'}`;
    } else {
      nextButtonText = `执行: ${SEAT_NAMES[pendingAiAction.seat]} 下一步`;
    }
  } else if (game.phase === 'handEnd' || game.phase === 'matchEnd') {
    nextButtonText = '进入下一副 (Next Hand)';
  }

  // 复制辅助
  const copyToClipboard = (text: string, notice: string) => {
    void navigator.clipboard.writeText(text);
    setCopyNotice(notice);
    setTimeout(() => setCopyNotice(null), 2000);
  };

  // 1. 思考推演展示
  const activeThinkText =
    thinkingState.text ||
    (latestRecord ? latestRecord.thinking : '等待动作发起思考推演...');
  const activeConclusion =
    thinkingState.conclusion ||
    (latestRecord ? latestRecord.conclusion : undefined);
  const activeChosenCard =
    thinkingState.chosenCard ||
    (latestRecord ? latestRecord.chosenCard : undefined);

  // 2. 候选走法列表
  const currentCandidates = useMemo((): CandidateMoveEvaluation[] => {
    if (seat >= 0 && game.phase === 'playing') {
      const legals = legalMoves(game, seat);
      const evalMap = new Map<string, CandidateMoveEvaluation>();
      if (latestRecord?.candidateEvaluations && latestRecord.seat === seat) {
        for (const ev of latestRecord.candidateEvaluations) {
          evalMap.set(cardId(ev.card), ev);
        }
      }
      return legals.map((card) => {
        const id = cardId(card);
        const existing = evalMap.get(id);
        const isChosen =
          (latestRecord?.chosenCard && cardId(latestRecord.chosenCard) === id) ||
          (pendingAiAction?.kind === 'play' && cardId(pendingAiAction.card) === id) ||
          (aiHintAction?.kind === 'play' && cardId(aiHintAction.card) === id);

        return {
          card,
          winRate: existing?.winRate,
          expectedPoints: existing?.expectedPoints,
          probability: existing?.probability,
          isChosen,
        };
      });
    }
    if (latestRecord?.candidateEvaluations) {
      return latestRecord.candidateEvaluations;
    }
    return [];
  }, [game, seat, latestRecord, pendingAiAction, aiHintAction]);

  // 3. 绝门与记牌
  const voidMatrix = useMemo(() => {
    return inferVoidSuits(game.completedTricks, game.trick);
  }, [game.completedTricks, game.trick]);

  const declarerPts = game.declarerTrickPoints + game.buriedPoints;
  const defenderPts = game.defenderTrickPoints;
  const remainingPts = Math.max(0, 100 - declarerPts - defenderPts);

  const playedCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of game.completedTricks) {
      for (const c of t.cards) ids.add(cardId(c.card));
    }
    for (const t of game.trick) ids.add(cardId(t.card));
    return ids;
  }, [game.completedTricks, game.trick]);

  return (
    <aside className={styles.panel} aria-label="全功能上帝调试控制台">
      {/* 顶部常驻：Next 推进与节奏控制 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>节奏控制与推演</span>
          <span className={styles.turnHighlight}>轮到: {actorName}</span>
        </div>

        <button
          type="button"
          className={styles.nextBtn}
          onClick={() => void stepNext()}
          disabled={isThinking}
          title="推进下一步 (快捷键 Space)"
        >
          <span>⏭️</span>
          <span>{nextButtonText}</span>
        </button>

        <div className={styles.subControlRow}>
          <button
            type="button"
            className={`${styles.subBtn} ${isStepMode ? styles.subBtnActive : ''}`}
            onClick={() => setIsStepMode(true)}
            title="单步推进（逐张推演观察）"
          >
            ⏸️ 单步推进
          </button>
          <button
            type="button"
            className={`${styles.subBtn} ${!isStepMode ? styles.subBtnActive : ''}`}
            onClick={() => setIsStepMode(false)}
            title="自动连打"
          >
            ▶️ 自动连打
          </button>
          <button
            type="button"
            className={styles.subBtn}
            onClick={toggleSoundMute}
            title={soundMuted ? '开启音效' : '静音'}
          >
            {soundMuted ? '🔇 静音' : '🔊 音效'}
          </button>
          <select
            className={styles.engineSelect}
            value={engineType}
            onChange={(e) => setEngineType(e.target.value as EngineType)}
            title="快速切换当前出牌 AI 决策引擎"
          >
            <option value="bridge">桥牌 DDS (深度)</option>
            <option value="algorithm">传统算法 (Worker)</option>
            <option value="llm">大模型 LLM</option>
            <option value="laya">Laya 策略</option>
          </select>
        </div>

        <div className={styles.subControlRow}>
          <button
            type="button"
            className={styles.subBtn}
            onClick={() => void triggerAiHint()}
            disabled={isThinking || seat < 0}
            title="计算当前最优牌"
          >
            💡 AI 出牌提示
          </button>
          <button
            type="button"
            className={styles.subBtn}
            onClick={undo}
            disabled={!canUndo}
            title="撤销上一手操作"
          >
            ↩️ 撤销一步
          </button>
          <button
            type="button"
            className={styles.subBtn}
            onClick={onOpenDecisionLog}
            title="打开全量决策弹窗"
          >
            📜 全量弹窗
          </button>
        </div>
      </section>

      {/* 提示信息栏 */}
      {aiHintAction && aiHintAction.kind === 'play' && (
        <div className={styles.hintBanner}>
          <span>💡 推荐打出: <strong>{cardLabel(aiHintAction.card)}</strong></span>
          <button
            type="button"
            className={styles.subBtn}
            style={{ minHeight: '24px', padding: '0 8px' }}
            onClick={() => manualPlaySeat(seat, aiHintAction.card)}
          >
            立即执行
          </button>
        </div>
      )}

      {copyNotice && <div className={styles.hintBanner}>{copyNotice}</div>}

      {/* 5 大专业诊断选项卡 */}
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'think' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('think')}
        >
          🧠 思维推演
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'candidates' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('candidates')}
        >
          🎯 候选比选 ({currentCandidates.length})
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'ledger' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('ledger')}
        >
          📊 绝门记牌
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'history' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📜 历史追溯 ({records.length})
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'sandbox' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('sandbox')}
        >
          🛠️ 沙盒工具
        </button>
      </div>

      {/* 选项卡容器内容 */}
      <div className={styles.tabContent}>
        {/* Tab 1: 🧠 思维推演 */}
        {activeTab === 'think' && (
          <section className={styles.thinkSection}>
            <div className={styles.thinkHeader}>
              <div className={styles.thinkTitle}>
                <span className={styles.pulseDot} />
                <span>实时 AI Think 思维链</span>
              </div>
              <span className={styles.engineBadge}>引擎: {engineType}</span>
            </div>

            <div className={styles.thinkBody}>{activeThinkText}</div>

            {activeConclusion && (
              <div className={styles.thinkConclusion}>
                <span>结论: {activeConclusion}</span>
                {activeChosenCard && (
                  <span className={styles.thinkChosenCard}>
                    {cardLabel(activeChosenCard)}
                  </span>
                )}
              </div>
            )}

            {/* 诊断指标卡片 */}
            <div className={styles.diagGrid}>
              <div className={styles.diagCard}>
                <span className={styles.lbl}>计算耗时</span>
                <span className={styles.val}>{latestRecord ? `${Math.round(latestRecord.latencyMs)} ms` : '--'}</span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.lbl}>预估胜率 / 置信度</span>
                <span className={styles.val}>
                  {latestRecord?.searchWinRate !== undefined
                    ? `${(latestRecord.searchWinRate * 100).toFixed(1)}%`
                    : latestRecord?.confidence !== undefined
                    ? `${(latestRecord.confidence * 100).toFixed(0)}%`
                    : '--'}
                </span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.lbl}>调用的模型</span>
                <span className={styles.val}>{latestRecord?.modelName ?? engineType}</span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.lbl}>回退状态</span>
                <span className={styles.val} style={{ color: latestRecord?.fallbackReason ? '#f87171' : '#4ade80' }}>
                  {latestRecord?.fallbackReason ? '⚠️ 触发降级' : '正常无降级'}
                </span>
              </div>
            </div>

            {latestRecord?.fallbackReason && (
              <div className={styles.hintBanner} style={{ color: '#fca5a5', borderColor: '#f87171' }}>
                降级原因: {latestRecord.fallbackReason}
              </div>
            )}

            {/* 原始请求与 JSON 审查折叠 */}
            {(latestRecord?.requestPayload || latestRecord?.rawResponse) && (
              <div>
                <button
                  type="button"
                  className={styles.subBtn}
                  onClick={() => setShowPayloadDrawer(!showPayloadDrawer)}
                >
                  {showPayloadDrawer ? '收起原始 JSON 审查' : '展开原始 Prompt 与响应 JSON'}
                </button>
                {showPayloadDrawer && (
                  <div className={styles.codeDrawer}>
                    {latestRecord.requestPayload && (
                      <div>
                        <strong>[Request Payload]:</strong>
                        <pre>{JSON.stringify(latestRecord.requestPayload, null, 2)}</pre>
                      </div>
                    )}
                    {latestRecord.rawResponse && (
                      <div style={{ marginTop: '8px' }}>
                        <strong>[Raw Response]:</strong>
                        <pre>{latestRecord.rawResponse}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: 🎯 候选比选 */}
        {activeTab === 'candidates' && (
          <section className={styles.thinkSection}>
            <div className={styles.sectionTitle}>
              <span>当前所有合法候选牌 ({currentCandidates.length})</span>
              <span className={styles.turnHighlight}>座位: {actorName}</span>
            </div>

            {currentCandidates.length === 0 ? (
              <div className={styles.thinkBody}>当前暂无合法候选牌信息（非出牌阶段或已出牌完毕）。</div>
            ) : (
              <div className={styles.candidateTableWrapper}>
                <table className={styles.candidateTable}>
                  <thead>
                    <tr>
                      <th>手牌</th>
                      <th>分值</th>
                      <th>胜率评估</th>
                      <th>期望得分</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentCandidates.map((c) => {
                      const id = cardId(c.card);
                      const pts = cardPoints(c.card);
                      const winRateStr = c.winRate !== undefined ? `${(c.winRate * 100).toFixed(0)}%` : '--';
                      const expPtsStr = c.expectedPoints !== undefined ? c.expectedPoints.toFixed(1) : '--';

                      return (
                        <tr
                          key={id}
                          className={`${styles.candidateRow} ${c.isChosen ? styles.candidateRowChosen : ''}`}
                        >
                          <td>
                            <strong>{cardLabel(c.card)}</strong>
                            {c.isChosen && <span className={styles.chosenBadge}>采纳</span>}
                          </td>
                          <td>
                            {pts > 0 ? (
                              <span style={{ color: '#facc15', fontWeight: 800 }}>+{pts}</span>
                            ) : (
                              <span style={{ color: '#64748b' }}>0</span>
                            )}
                          </td>
                          <td>
                            <div className={styles.winRateBar}>
                              <div className={styles.barTrack}>
                                <div
                                  className={styles.barFill}
                                  style={{ width: `${Math.max(5, (c.winRate ?? 0.5) * 100)}%` }}
                                />
                              </div>
                              <span>{winRateStr}</span>
                            </div>
                          </td>
                          <td>{expPtsStr}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.subBtn}
                              style={{ minHeight: '22px', padding: '0 6px', fontSize: '11px' }}
                              onClick={() => manualPlaySeat(seat, c.card)}
                              title="强制以当前座位出此牌"
                            >
                              ⚡ 出牌
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab 3: 📊 绝门与记牌 */}
        {activeTab === 'ledger' && (
          <section className={styles.thinkSection}>
            <div className={styles.sectionTitle}>
              <span>四方绝门侦测矩阵 (Void Suits)</span>
              <span>根据垫牌实时推断</span>
            </div>

            <table className={styles.voidTable}>
              <thead>
                <tr>
                  <th>座位</th>
                  <th>♠ 黑桃</th>
                  <th>♥ 红心</th>
                  <th>♣ 梅花</th>
                  <th>♦ 方块</th>
                </tr>
              </thead>
              <tbody>
                {[3, 1, 2, 0].map((s) => {
                  const voids = voidMatrix[s] ?? [];
                  return (
                    <tr key={s}>
                      <td style={{ fontWeight: 700 }}>{SEAT_NAMES[s]}</td>
                      {ALL_SUITS.map((suit) => {
                        const isVoid = voids.includes(suit);
                        return (
                          <td
                            key={suit}
                            className={isVoid ? styles.voidCellActive : styles.voidCellNormal}
                          >
                            {isVoid ? '❌ 绝门' : '✅ 有牌'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 100 分分牌记账 */}
            <div className={styles.sectionTitle} style={{ marginTop: '8px' }}>
              <span>100 分分牌追踪盘点</span>
              <span>合计 100 分</span>
            </div>

            <div className={styles.ptsTrackerGrid}>
              <div className={`${styles.ptsCard} ${styles.gold}`}>
                <span className={styles.lbl}>庄家方吃分</span>
                <span className={styles.val}>{declarerPts} 分</span>
              </div>
              <div className={`${styles.ptsCard} ${styles.blue}`}>
                <span className={styles.lbl}>闲家方吃分</span>
                <span className={styles.val}>{defenderPts} 分</span>
              </div>
              <div className={`${styles.ptsCard} ${styles.green}`}>
                <span className={styles.lbl}>场上剩余未出</span>
                <span className={styles.val}>{remainingPts} 分</span>
              </div>
            </div>

            {/* 16 张分牌明细 (A=10, 10=10, 5=5) */}
            <div className={styles.pointCardsList}>
              {ALL_SUITS.flatMap((suit) =>
                POINT_RANKS.map((rank) => {
                  const id = `${rank}${suit}`;
                  const isPlayed = playedCardIds.has(id);
                  const isTrump = game.trump === suit;
                  return (
                    <span
                      key={id}
                      className={`${styles.pointChip} ${isPlayed ? styles.pointChipPlayed : styles.pointChipAlive}`}
                      title={`${cardLabel({ rank: rank as any, suit })}${isPlayed ? ' (已打出)' : ' (在场未出)'}`}
                    >
                      {SUIT_SYMBOL[suit]}{rank}
                      {isTrump && '★'}
                    </span>
                  );
                }),
              )}
            </div>
          </section>
        )}

        {/* Tab 4: 📜 历史追溯 */}
        {activeTab === 'history' && (
          <section className={styles.thinkSection}>
            <div className={styles.sectionTitle}>
              <span>本局历史决策时间线 ({records.length})</span>
              <button
                type="button"
                className={styles.subBtn}
                style={{ minHeight: '22px', padding: '0 6px' }}
                onClick={() => copyToClipboard(decisionLogger.exportJson(), '✅ 全局决策日志已复制')}
              >
                复制全量 JSON
              </button>
            </div>

            {records.length === 0 ? (
              <div className={styles.thinkBody}>当前暂无历史出牌决策记录。</div>
            ) : (
              <div className={styles.historyTimeline}>
                {[...records].reverse().map((rec) => {
                  const isExpanded = expandedRecordId === rec.id;
                  return (
                    <div key={rec.id} className={styles.historyItemBox}>
                      <div
                        className={styles.historyHeader}
                        onClick={() => setExpandedRecordId(isExpanded ? null : rec.id)}
                      >
                        <div>
                          <strong>第 {rec.trickNumber} 轮 · {SEAT_NAMES[rec.seat]}家</strong>
                          <span style={{ marginLeft: '8px', color: '#38bdf8' }}>
                            出牌: {rec.chosenCard ? cardLabel(rec.chosenCard) : '-'}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8' }}>
                          <span>{rec.engineType}</span>
                          <span style={{ marginLeft: '6px' }}>{Math.round(rec.latencyMs)}ms</span>
                          <span style={{ marginLeft: '6px' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className={styles.historyDetail}>
                          {rec.conclusion && (
                            <div>
                              <strong style={{ color: '#38bdf8' }}>结论: </strong>
                              <span>{rec.conclusion}</span>
                            </div>
                          )}
                          {rec.thinking && (
                            <div className={styles.codeDrawer}>{rec.thinking}</div>
                          )}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button
                              type="button"
                              className={styles.subBtn}
                              style={{ minHeight: '22px', padding: '0 6px' }}
                              onClick={() => copyToClipboard(JSON.stringify(rec, null, 2), '✅ 单步决策 JSON 已复制')}
                            >
                              复制此步 JSON
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 5: 🛠️ 沙盒工具 */}
        {activeTab === 'sandbox' && (
          <section className={styles.thinkSection}>
            <div className={styles.sectionTitle}>
              <span>沙盒调试与作弊工具</span>
              <span>调试增强</span>
            </div>

            <div className={styles.sandboxGrid}>
              {/* 撤销上一步 */}
              <div className={styles.sandboxBox}>
                <span style={{ fontWeight: 700 }}>↩️ 单步撤销回退 (Undo)</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  调试 AI 时若走法不符合预期，可随时撤销回退并单步重新推演。
                </span>
                <button
                  type="button"
                  className={styles.nextBtn}
                  style={{ minHeight: '36px', fontSize: '13px' }}
                  onClick={undo}
                  disabled={!canUndo}
                >
                  ↩️ 撤销上一手操作
                </button>
              </div>

              {/* 种子重开 */}
              <div className={styles.sandboxBox}>
                <span style={{ fontWeight: 700 }}>🎲 指定种子发牌 (Deterministic Seed)</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  输入特定牌局种子，精确复现牌局与 AI 分支策略。
                </span>
                <div className={styles.seedInputGroup}>
                  <input
                    type="number"
                    className={styles.seedInput}
                    value={customSeed}
                    onChange={(e) => setCustomSeed(e.target.value)}
                    placeholder="输入整数种子 (如 12345)"
                  />
                  <button
                    type="button"
                    className={styles.subBtn}
                    onClick={() => restart(Number(customSeed) || 12345)}
                  >
                    重开此副
                  </button>
                </div>
              </div>

              {/* 导出当前局势快照 */}
              <div className={styles.sandboxBox}>
                <span style={{ fontWeight: 700 }}>📋 导出完整 GameState 快照</span>
                <button
                  type="button"
                  className={styles.subBtn}
                  onClick={() =>
                    copyToClipboard(
                      JSON.stringify(
                        {
                          phase: game.phase,
                          trump: game.trump,
                          declarer: game.declarer,
                          highestBid: game.highestBid,
                          hands: game.hands,
                          kitty: game.kitty,
                          trick: game.trick,
                          completedTricks: game.completedTricks,
                          voidSuits: voidMatrix,
                        },
                        null,
                        2,
                      ),
                      '✅ 牌局完整快照已复制到剪贴板',
                    )
                  }
                >
                  复制对局调试 JSON 快照
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* 底部功能配置入口 */}
      <div className={styles.subControlRow} style={{ marginTop: 'auto' }}>
        <button
          type="button"
          className={styles.subBtn}
          onClick={onOpenEngineSettings}
        >
          ⚙️ 引擎参数设置
        </button>
        <button
          type="button"
          className={styles.subBtn}
          onClick={onOpenDecisionLog}
        >
          📜 独立弹窗大厅
        </button>
      </div>
    </aside>
  );
}
