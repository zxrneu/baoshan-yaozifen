/**
 * AI 决策引擎配置弹窗：
 * - 支持在设置中配置：
 *   1. vLLM 部署的 qwen38_27b (openai_api_base 与 model_name)
 *   2. TypeSafe /v1/systemone 的 API 地址与模型名称
 *   3. 本地代理转发 vs 浏览器直连
 * - 支持配置持久化（localStorage）、连通性测试与决策日志导出。
 */
import { useEffect, useState } from 'react';
import { EngineType } from '../ai/engines/engineTypes';
import { decisionLogger } from '../ai/engines/decisionLogger';
import {
  DEFAULT_ENGINE_SETTINGS,
  EngineSettings,
  applySettingsToManager,
  loadEngineSettings,
  saveEngineSettings,
} from '../ai/engines/engineSettings';
import { defaultEngineManager } from '../ai/engines';
import { SEAT_NAMES } from '../engine';
import styles from './EngineSettingsModal.module.css';

interface Props {
  activeType: EngineType;
  onSelectType: (type: EngineType) => void;
  onClose: () => void;
  onOpenDecisionLog?: (recordId?: string) => void;
  onGodModeChange?: (enabled: boolean) => void;
}

export default function EngineSettingsModal({
  activeType,
  onSelectType,
  onClose,
  onOpenDecisionLog,
  onGodModeChange,
}: Props) {
  const [settings, setSettings] = useState<EngineSettings>(() => loadEngineSettings());
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // 连通性测试状态
  const [llmTestStatus, setLlmTestStatus] = useState<string | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);

  const [layaTestStatus, setLayaTestStatus] = useState<string | null>(null);
  const [isTestingLaya, setIsTestingLaya] = useState(false);

  const [proxyTestStatus, setProxyTestStatus] = useState<string | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);

  const [logs, setLogs] = useState(() => decisionLogger.getRecords());

  useEffect(() => {
    return decisionLogger.subscribe(() => {
      setLogs([...decisionLogger.getRecords()]);
    });
  }, []);

  // 保存并应用配置
  const handleSaveSettings = () => {
    const updatedSettings: EngineSettings = {
      ...settings,
      activeType,
    };
    saveEngineSettings(updatedSettings);
    applySettingsToManager(updatedSettings, defaultEngineManager);
    onGodModeChange?.(updatedSettings.godMode ?? false);
    setSaveStatus('✅ 配置已保存并应用到当前牌局！');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // 恢复默认配置
  const handleResetDefaults = () => {
    setSettings({
      ...DEFAULT_ENGINE_SETTINGS,
      activeType,
    });
    setSaveStatus('已重置为默认配置，点击“保存并应用”生效');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // 测试 LLM 连通性
  const handleTestLlm = async () => {
    setIsTestingLlm(true);
    setLlmTestStatus('正在测试 LLM (vLLM) 连通性...');
    const start = performance.now();
    try {
      const targetUrl = settings.useProxy
        ? '/api/llm/models'
        : `${settings.llm.baseUrl.replace(/\/+$/, '')}/models`;

      const headers: Record<string, string> = {};
      if (settings.llm.apiKey) {
        headers['Authorization'] = `Bearer ${settings.llm.apiKey}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(targetUrl, {
        headers,
        signal: controller.signal,
      }).catch((e) => {
        throw new Error(e.name === 'AbortError' ? '请求超时 (5s)' : `网络异常或跨域受阻: ${e.message}`);
      });
      clearTimeout(timer);

      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const modelList = Array.isArray(data?.data)
          ? data.data.map((m: any) => m.id).join(', ')
          : settings.llm.model;
        setLlmTestStatus(`✅ 连接成功 (${elapsed}ms) · 模型服务在线 [${modelList || settings.llm.model}]`);
      } else {
        setLlmTestStatus(`⚠️ 服务响应错误 HTTP ${res.status}: ${res.statusText}（若跨域请开启“本地代理转发”）`);
      }
    } catch (e: any) {
      setLlmTestStatus(`❌ 连接失败: ${e.message}`);
    } finally {
      setIsTestingLlm(false);
    }
  };

  // 测试 TypeSafe / Laya 连通性
  const handleTestLaya = async () => {
    setIsTestingLaya(true);
    setLayaTestStatus('正在测试 TypeSafe / Laya 连通性...');
    const start = performance.now();
    try {
      const targetUrl = settings.useProxy
        ? '/api/laya/api/version'
        : `${settings.laya.baseUrl.replace(/\/+$/, '')}/api/version`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
      }).catch(async () => {
        // 尝试 fallback 到 /v1/systemone options 测试
        const optUrl = settings.useProxy
          ? '/api/laya/v1/systemone'
          : `${settings.laya.baseUrl.replace(/\/+$/, '')}/v1/systemone`;
        return fetch(optUrl, { method: 'OPTIONS', signal: controller.signal });
      });
      clearTimeout(timer);

      const elapsed = Math.round(performance.now() - start);
      if (res && (res.ok || res.status === 404)) {
        setLayaTestStatus(`✅ 连接成功 (${elapsed}ms) · TypeSafe 接口已就绪`);
      } else {
        setLayaTestStatus(`⚠️ 连通异常 (HTTP ${res?.status})`);
      }
    } catch (e: any) {
      setLayaTestStatus(`❌ 连接失败: ${e.message}`);
    } finally {
      setIsTestingLaya(false);
    }
  };

  // 测试本地 Node 代理
  // 测试本地 Node 代理与 /api/decision 决策接口
  const handleTestProxy = async () => {
    setIsTestingProxy(true);
    setProxyTestStatus('正在检测 Node 模型代理及 /api/decision 接口...');
    try {
      const [resEngines, resDecision] = await Promise.all([
        fetch('/api/engines').catch(() => null),
        fetch('/api/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seat: 0,
            phase: 'playing',
            engineType: settings.activeType,
            candidates: [{ rank: 'A', suit: 'D' }],
          }),
        }).catch(() => null),
      ]);

      if (!resEngines || !resEngines.ok) {
        setProxyTestStatus('❌ 代理未响应（可在终端运行 pnpm proxy 启动服务）');
        return;
      }
      const data = await resEngines.json();
      const layaState = data.engines?.laya?.available ? '在线' : '离线';
      const llmState = data.engines?.llm?.available ? '在线' : '离线';
      const decisionOk = resDecision && resDecision.ok ? '正常' : '异常';
      setProxyTestStatus(`✅ 本地代理就绪 · 决策接口: ${decisionOk} · Laya: ${layaState} · LLM: ${llmState}`);
    } catch (e: any) {
      setProxyTestStatus(`❌ 检测失败: ${e.message}`);
    } finally {
      setIsTestingProxy(false);
    }
  };

  // 导出决策 JSON
  const handleExportLogs = () => {
    const jsonStr = decisionLogger.exportRecords();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baoshan-yaozifen-decisions-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    decisionLogger.clear();
    setLogs([]);
  };

  return (
    <div className="modal-backdrop">
      <div className={`modal-box ${styles.modal}`}>
        <div className="modal-header">
          <h2>🤖 AI 决策引擎与模型服务配置</h2>
        </div>

        <div className="modal-body">
          {/* 1. 当前引擎模式选择 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>牌桌当前激活引擎（三个自动座位统一切换）</span>
            </div>
            <div className={styles.engineGrid}>
              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'bridge' ? styles.active : ''}`}
                onClick={() => onSelectType('bridge')}
              >
                <div className={styles.cardTitle}>桥牌深度思考 (推荐)</div>
                <span className={`${styles.cardBadge} ${styles.badgeAlgo}`}>DDS + PIMC · 无模型</span>
                <div className={styles.cardDesc}>
                  桥牌专家技法（拔主/兑现/喂分/第二手出小）+ 位棋盘双明手 Alpha-Beta 搜索与 PIMC 深度思考。
                </div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'algorithm' ? styles.active : ''}`}
                onClick={() => onSelectType('algorithm')}
              >
                <div className={styles.cardTitle}>传统算法</div>
                <span className={`${styles.cardBadge} ${styles.badgeAlgo}`}>Worker · 250ms</span>
                <div className={styles.cardDesc}>
                  启发式规则 + 约束采样 + 配对胜率搜索 + 残局精确求解。
                </div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'laya' ? styles.active : ''}`}
                onClick={() => onSelectType('laya')}
              >
                <div className={styles.cardTitle}>非自回归模型</div>
                <span className={`${styles.cardBadge} ${styles.badgeLaya}`}>TypeSafe / Laya</span>
                <div className={styles.cardDesc}>
                  TypeSafe 接口，超低延迟（~200ms），单步快速概率选择。
                </div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'llm' ? styles.active : ''}`}
                onClick={() => onSelectType('llm')}
              >
                <div className={styles.cardTitle}>大语言模型</div>
                <span className={`${styles.cardBadge} ${styles.badgeLlm}`}>vLLM / qwen38_27b</span>
                <div className={styles.cardDesc}>
                  OpenAI 兼容 Chat Completions，严格 JSON 结构化出牌输出。
                </div>
              </button>
            </div>
          </div>

          {/* 2. 模型服务地址配置区 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>⚙️ 模型服务端点与参数配置</span>
              {saveStatus && <span className={styles.saveNotice}>{saveStatus}</span>}
            </div>

            {/* 大语言模型 (vLLM) 配置 */}
            <div className={styles.configBox}>
              <div className={styles.configBoxTitle}>
                <span>🌟 vLLM / 大语言模型配置 (qwen38_27b)</span>
                <button
                  type="button"
                  className="action-btn"
                  disabled={isTestingLlm}
                  onClick={handleTestLlm}
                >
                  {isTestingLlm ? '测试中...' : '测试 LLM 连通性'}
                </button>
              </div>

              <div className={styles.configGrid}>
                <div className={`${styles.field} ${styles.fullWidth}`}>
                  <label className={styles.fieldLabel}>API 地址 (openai_api_base):</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={settings.llm.baseUrl}
                    placeholder="http://211.141.18.165:6195/v1/"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, baseUrl: e.target.value },
                      })
                    }
                  />
                  <span className={styles.fieldNote}>
                    支持 vLLM、DeepSeek 或 OpenAI 兼容端点，例如 <code>http://211.141.18.165:6195/v1/</code>
                  </span>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>模型名称 (model_name):</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={settings.llm.model}
                    placeholder="qwen38_27b"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, model: e.target.value },
                      })
                    }
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>请求协议 (Protocol):</label>
                  <select
                    className={styles.fieldSelect}
                    value={settings.llm.protocol}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, protocol: e.target.value as any },
                      })
                    }
                  >
                    <option value="chat">Chat Completions (/chat/completions)</option>
                    <option value="completion">Completions (/completions)</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>思考等级 (reasoning_effort):</label>
                  <select
                    className={styles.fieldSelect}
                    value={settings.llm.reasoningEffort}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, reasoningEffort: e.target.value as any },
                      })
                    }
                  >
                    <option value="default">默认 (按模型自身策略)</option>
                    <option value="none">关闭 (none - 无深度思考/极速)</option>
                    <option value="low">低 (low - 轻度思考)</option>
                    <option value="medium">中 (medium - 平衡思考深度)</option>
                    <option value="high">高 (high - 深度推演)</option>
                  </select>
                  <span className={styles.fieldNote}>
                    调节 OpenAI / vLLM 推理模型的思考链深度与 token 开销
                  </span>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>API 密钥 (API Key，可选):</label>
                  <input
                    type="password"
                    className={styles.fieldInput}
                    value={settings.llm.apiKey}
                    placeholder="sk-..."
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, apiKey: e.target.value },
                      })
                    }
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>超时上限 (毫秒，默认 8000):</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    value={settings.llm.timeoutMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, timeoutMs: Number(e.target.value) || 8000 },
                      })
                    }
                  />
                </div>
              </div>

              {llmTestStatus && (
                <div
                  className={`${styles.statusText} ${
                    llmTestStatus.startsWith('✅')
                      ? styles.statusOk
                      : llmTestStatus.startsWith('❌')
                      ? styles.statusErr
                      : styles.statusTesting
                  }`}
                >
                  {llmTestStatus}
                </div>
              )}
            </div>

            {/* 非自回归模型 (TypeSafe / Laya) 配置 */}
            <div className={styles.configBox}>
              <div className={styles.configBoxTitle}>
                <span>⚡ TypeSafe / Laya 模型配置 (/v1/systemone)</span>
                <button
                  type="button"
                  className="action-btn"
                  disabled={isTestingLaya}
                  onClick={handleTestLaya}
                >
                  {isTestingLaya ? '测试中...' : '测试 TypeSafe 连通性'}
                </button>
              </div>

              <div className={styles.configGrid}>
                <div className={`${styles.field} ${styles.fullWidth}`}>
                  <label className={styles.fieldLabel}>TypeSafe API 服务地址:</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={settings.laya.baseUrl}
                    placeholder="http://127.0.0.1:11435"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        laya: { ...settings.laya, baseUrl: e.target.value },
                      })
                    }
                  />
                  <span className={styles.fieldNote}>
                    本地 Ollaya 默认为 <code>http://127.0.0.1:11435</code>；支持配置远程 TypeSafe API 地址
                  </span>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>模型名称 (model):</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={settings.laya.model}
                    placeholder="laya:multilingual"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        laya: { ...settings.laya, model: e.target.value },
                      })
                    }
                  />
                  <span className={styles.fieldNote}>
                    默认 <code>laya:multilingual</code> 开启中文多语言支持
                  </span>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>超时上限 (毫秒，默认 1500):</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    value={settings.laya.timeoutMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        laya: { ...settings.laya, timeoutMs: Number(e.target.value) || 1500 },
                      })
                    }
                  />
                </div>
              </div>

              {layaTestStatus && (
                <div
                  className={`${styles.statusText} ${
                    layaTestStatus.startsWith('✅')
                      ? styles.statusOk
                      : layaTestStatus.startsWith('❌')
                      ? styles.statusErr
                      : styles.statusTesting
                  }`}
                >
                  {layaTestStatus}
                </div>
              )}
            </div>

            {/* 转发路由选项与控制 */}
            <div className={styles.actionRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="useServerDecisionCheck"
                  checked={settings.useServerDecision}
                  onChange={(e) => setSettings({ ...settings, useServerDecision: e.target.checked })}
                />
                <label htmlFor="useServerDecisionCheck" style={{ fontSize: 13, cursor: 'pointer', fontWeight: 'bold', color: '#16a34a' }}>
                  🚀 全阶段服务端决策 (Client/Server 架构 · 推荐：叫分/定主/扣底/出牌全走服务端，彻底避免浏览器中断)
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="useProxyCheck"
                  checked={settings.useProxy}
                  onChange={(e) => setSettings({ ...settings, useProxy: e.target.checked })}
                />
                <label htmlFor="useProxyCheck" style={{ fontSize: 13, cursor: 'pointer' }}>
                  通过本地 Node 代理转发 (解决外网 vLLM / 本地 Ollaya 跨域与网络保护)
                </label>
              </div>

              <div className={styles.btnGroup}>
                <button
                  type="button"
                  className="action-btn"
                  disabled={isTestingProxy}
                  onClick={handleTestProxy}
                >
                  {isTestingProxy ? '检测中...' : '检测 Node 代理'}
                </button>
                <button type="button" className="action-btn" onClick={handleResetDefaults}>
                  恢复默认地址
                </button>
                <button type="button" className="primary-btn" onClick={handleSaveSettings}>
                  💾 保存并应用配置
                </button>
              </div>
            </div>

            {proxyTestStatus && (
              <div
                className={`${styles.statusText} ${
                  proxyTestStatus.startsWith('✅')
                    ? styles.statusOk
                    : proxyTestStatus.startsWith('❌')
                    ? styles.statusErr
                    : styles.statusTesting
                }`}
              >
                {proxyTestStatus}
              </div>
            )}
          </div>

          {/* 3. 开发者上帝模式 (God Mode) */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>👀 开发者上帝模式 (God Mode)</span>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontWeight: 600,
                  background: settings.godMode ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: settings.godMode ? '#4ade80' : 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {settings.godMode ? '已开启' : '默认关闭'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 4 }}>
              <input
                type="checkbox"
                id="godModeCheck"
                checked={Boolean(settings.godMode)}
                onChange={(e) => setSettings({ ...settings, godMode: e.target.checked })}
              />
              <label htmlFor="godModeCheck" style={{ fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                开启上帝模式透视（允许点击电脑玩家头像看牌与一键全明手）
              </label>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>
              默认关闭以保证普通牌局的公平对抗体验。在 <code>run dev</code> 阶段排查 AI 决策或手牌合法性时可在此开启；亦支持在项目 <code>.env</code> 或构建环境变量中设置 <code>VITE_ENABLE_GOD_MODE=true</code> 控制默认开启。
            </div>
          </div>

          {/* 4. 自训 RL 规划 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>自博弈强化学习 (RL) 研发规划</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>规划中 / TODO</span>
            </div>
            <div className={styles.rlNotice}>
              自训强化学习方案参考 PerfectDou 与 Team-PSRO：设计团队吃分奖励与胜负稀疏奖励，构建合法动作掩码与信息隔离，通过历史策略池消除策略循环。详见项目 <code>TODO.md</code> 与研究文档。
            </div>
          </div>

          {/* 5. 决策日志与导出 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>近期 AI 决策记录 ({logs.length})</span>
              <div className={styles.btnGroup}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    onClose();
                    onOpenDecisionLog?.();
                  }}
                  title="打开 Master-Detail 决策日志与思考链审查大厅"
                >
                  🔍 深度审查大厅
                </button>
                <button
                  type="button"
                  className="action-btn"
                  disabled={logs.length === 0}
                  onClick={handleExportLogs}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="action-btn"
                  disabled={logs.length === 0}
                  onClick={handleClearLogs}
                >
                  清空记录
                </button>
              </div>
            </div>

            <div className={styles.logTableContainer}>
              {logs.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', opacity: 0.6 }}>
                  暂无决策记录（对局出牌后将自动记录）
                </div>
              ) : (
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th>座位</th>
                      <th>引擎</th>
                      <th>出牌</th>
                      <th>耗时</th>
                      <th>结论 / 说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.slice(-15).reverse().map((rec, i) => (
                      <tr
                        key={i}
                        style={{ cursor: 'pointer' }}
                        title="点击打开此步决策的深度思考与局势推演大厅"
                        onClick={() => {
                          onClose();
                          onOpenDecisionLog?.(rec.id);
                        }}
                      >
                        <td>{SEAT_NAMES[rec.seat]}</td>
                        <td>
                          <span
                            className={
                              rec.engineType === 'algorithm'
                                ? styles.tagSuccess
                                : rec.fallbackReason
                                ? styles.tagFallback
                                : styles.tagSuccess
                            }
                          >
                            {rec.fallbackReason ? `${rec.requestedEngine}➔算法` : rec.engineType}
                          </span>
                        </td>
                        <td><strong>{rec.chosenCard.rank}{rec.chosenCard.suit}</strong></td>
                        <td>{Math.round(rec.latencyMs)}ms</td>
                        <td>{rec.fallbackReason ? `回退: ${rec.fallbackReason}` : rec.conclusion ?? rec.diagnostic ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
