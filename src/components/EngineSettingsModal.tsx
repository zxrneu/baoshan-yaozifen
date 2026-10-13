/**
 * 设置弹窗（玩家层 + 开发者选项层）：
 *
 * 信息架构（T1.2）：
 * - 玩家层（默认视图）：批量选择两队打法与默认引擎；逐座选择由牌桌入口承担。
 * - 开发者选项层：vLLM / TypeSafe 端点、API 密钥、协议与响应格式、思考等级、超时、
 *   代理转发、服务端决策、调试座位看牌说明、RL 规划、决策日志表格与导出。
 *
 * 调试模式、连接参数、座位看牌说明等工程配置集中于开发者选项；
 * 顶栏与工具栏不再暴露工程入口（玩家工具栏仅保留 ⚙️ 设置）。
 *
 * 原则：编排层（App.tsx）持有调试状态，本组件通过 props 接收——组件不自行读取全局调试状态。
 */
import Modal from './Modal';
import { useEffect, useState } from 'react';
import { EngineType } from '../ai/engines/engineTypes';
import { ENGINE_LABELS } from '../ai/engines/engineLabels';
import { decisionLogger } from '../ai/engines/decisionLogger';
import {
  DEFAULT_ENGINE_SETTINGS,
  EngineSettings,
  applySettingsToManager,
  loadEngineSettings,
  saveEngineSettings,
} from '../ai/engines/engineSettings';
import ProfileSettings from './ProfileSettings';
import { defaultEngineManager, type DecisionEngineManager } from '../ai/engines';
import { SEAT_NAMES } from '../engine';
import { actionLabel } from '../workbench/actions';
import styles from './EngineSettingsModal.module.css';

/** 弹窗层级：玩家设置 / 开发者选项 */
type SettingsLayer = 'player' | 'developer';

interface Props {
  manager?: DecisionEngineManager;
  activeType: EngineType;
  onSelectType: (type: EngineType) => void;
  onClose: () => void;
  onOpenDecisionLog?: (recordId?: string) => void;
  /** 当前是否处于调试模式（由编排层单一来源提供） */
  isDebugMode: boolean;
  /** 切换调试牌桌与普通牌桌 */
  onToggleDebugMode: () => void;
  /** 初始展示层级；调试工作台参数入口直接打开开发者选项层，默认进入玩家层 */
  initialLayer?: SettingsLayer;
}

export default function EngineSettingsModal({
  manager = defaultEngineManager,
  activeType,
  onSelectType,
  onClose,
  onOpenDecisionLog,
  isDebugMode,
  onToggleDebugMode,
  initialLayer = 'player',
}: Props) {
  /** 默认进入玩家层；开发者选项须显式切换，避免普通玩家误入工程配置 */
  const [layer, setLayer] = useState<SettingsLayer>(initialLayer);

  /**
   * 两层共用明确的计算术语名称；连接参数与协议配置仍放在开发者层。
   */
  const isPlayerLayer = layer === 'player';
  const engineCards: Record<EngineType, { title: string; badge: string; desc: string }> = {
    bridge: {
      title: ENGINE_LABELS.bridge,
      badge: 'DDS + PIMC · 无模型',
      desc: isPlayerLayer
        ? '通过牌局推演选择动作，结合拔主、兑现和搭档配合等规则。'
        : '桥牌专家技法（拔主/兑现/喂分/第二手出小）+ 位棋盘双明手 Alpha-Beta 搜索与 PIMC 深度思考。',
    },
    algorithm: {
      title: ENGINE_LABELS.algorithm,
      badge: '蒙特卡洛采样 · Worker',
      desc: isPlayerLayer
        ? '结合手牌结构、出牌记录和残局搜索选择动作。'
        : '启发式规则 + 约束采样 + 配对胜率搜索 + 残局精确求解。',
    },
    laya: {
      title: ENGINE_LABELS.laya,
      badge: isPlayerLayer ? '模型选择 · 需连接服务' : 'TypeSafe / Laya',
      desc: isPlayerLayer
        ? '由策略模型选择动作，需要先在开发者选项中连接模型服务。'
        : 'TypeSafe 接口，超低延迟（~200ms），单步快速概率选择。',
    },
    llm: {
      title: ENGINE_LABELS.llm,
      badge: isPlayerLayer ? '牌局分析 · 需连接服务' : 'vLLM / qwen38_27b',
      desc: isPlayerLayer
        ? '由模型分析牌局并选择动作，需要先在开发者选项中连接模型服务。'
        : 'OpenAI 兼容 Chat Completions，严格 JSON 结构化出牌输出。',
    },
  };
  const card = (type: EngineType) => engineCards[type];

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
    applySettingsToManager(updatedSettings, manager);
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
        setProxyTestStatus('❌ 服务未响应（可在终端运行 pnpm server 启动服务）');
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
    <Modal label="设置" onClose={onClose} className={`modal-box ${styles.modal}`}>
        <div className="modal-header">
          <h2>⚙️ 设置</h2>
        </div>

        <div className={styles.layerTabs} role="tablist" aria-label="设置分层">
          <button
            type="button"
            role="tab"
            aria-selected={layer === 'player'}
            className={`${styles.layerTab} ${layer === 'player' ? styles.layerTabActive : ''}`}
            onClick={() => setLayer('player')}
          >
            玩家设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layer === 'developer'}
            className={`${styles.layerTab} ${layer === 'developer' ? styles.layerTabActive : ''}`}
            onClick={() => setLayer('developer')}
          >
            🛠️ 开发者选项
          </button>
        </div>

        <div className="modal-body">
          <ProfileSettings manager={manager} developer={layer === 'developer'} />
          {/* 1. 当前引擎模式选择（玩家层：打法；开发者层：工程引擎） */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>
                {layer === 'player'
                  ? '电脑对手打法'
                  : '牌桌当前统一引擎（调试模式可代走四个座位）'}
              </span>
            </div>
            <div className={styles.engineGrid}>
              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'bridge' ? styles.active : ''}`}
                onClick={() => onSelectType('bridge')}
              >
                <div className={styles.cardTitle}>{card('bridge').title}</div>
                <span className={`${styles.cardBadge} ${styles.badgeAlgo}`}>{card('bridge').badge}</span>
                <div className={styles.cardDesc}>{card('bridge').desc}</div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'algorithm' ? styles.active : ''}`}
                onClick={() => onSelectType('algorithm')}
              >
                <div className={styles.cardTitle}>{card('algorithm').title}</div>
                <span className={`${styles.cardBadge} ${styles.badgeAlgo}`}>{card('algorithm').badge}</span>
                <div className={styles.cardDesc}>{card('algorithm').desc}</div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'laya' ? styles.active : ''}`}
                onClick={() => onSelectType('laya')}
              >
                <div className={styles.cardTitle}>{card('laya').title}</div>
                <span className={`${styles.cardBadge} ${styles.badgeLaya}`}>{card('laya').badge}</span>
                <div className={styles.cardDesc}>{card('laya').desc}</div>
              </button>

              <button
                type="button"
                className={`${styles.engineCard} ${activeType === 'llm' ? styles.active : ''}`}
                onClick={() => onSelectType('llm')}
              >
                <div className={styles.cardTitle}>{card('llm').title}</div>
                <span className={`${styles.cardBadge} ${styles.badgeLlm}`}>{card('llm').badge}</span>
                <div className={styles.cardDesc}>{card('llm').desc}</div>
              </button>
            </div>
          </div>

          {layer === 'player' && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>玩家选项</span>
              </div>
              <div className={styles.playerHint}>
                桥牌 Bridge（DDS）与推演算法（Worker）可直接使用。System One（Laya）与大模型 LLM 需先在
                <strong> 开发者选项 </strong>中连接模型服务。
              </div>
            </div>
          )}

          {layer === 'developer' && (
          <>
          {/* 2. 调试模式（工程入口总开关） */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>🎮 调试模式</span>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontWeight: 600,
                  background: isDebugMode ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: isDebugMode ? '#4ade80' : 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {isDebugMode ? '已开启' : '已关闭'}
              </span>
            </div>
            <div className="actionRow">
              <button type="button" className="action-btn" onClick={onToggleDebugMode}>
                {isDebugMode ? '🛠️ 关闭调试模式' : '🎮 开启调试模式'}
              </button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>
              开启后进入调试牌桌，可在侧栏工作台查看决策日志、切换引擎与单步推进；
              同时强制出牌二次确认。关闭后恢复普通牌桌，并收起临时透视的手牌。
            </div>
          </div>

          {/* 3. 模型服务地址配置区 */}
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
                    placeholder="http://127.0.0.1:8000/v1/"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, baseUrl: e.target.value },
                      })
                    }
                  />
                  <span className={styles.fieldNote}>
                    支持 vLLM、DeepSeek 或 OpenAI 兼容端点，例如 <code>http://127.0.0.1:8000/v1/</code>
                  </span>
                  {settings.useServerDecision && <span className={styles.fieldNote}>服务端决策模式的地址与鉴权由服务端环境提供；模型、协议、响应格式、思考等级和超时在此设置。</span>}
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
                    aria-label="LLM 请求协议"
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
                  <label className={styles.fieldLabel}>响应格式 (response_format):</label>
                  <select className={styles.fieldSelect} aria-label="LLM 响应格式"
                    value={settings.llm.responseFormat ?? 'json_object'}
                    onChange={e => setSettings({ ...settings, llm: { ...settings.llm, responseFormat: e.target.value as 'json_object' | 'json_schema' | 'text' } })}>
                    <option value="json_object">JSON 对象</option>
                    <option value="json_schema">JSON Schema（阶段字段与候选约束）</option>
                    <option value="text">文本（由客户端解析 JSON）</option>
                  </select>
                  <span className={styles.fieldNote}>JSON Schema 需模型服务支持；返回动作仍须通过游戏规则校验。</span>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>思考等级 (reasoning_effort):</label>
                  <select
                    className={styles.fieldSelect}
                    aria-label="LLM 思考等级"
                    value={settings.llm.reasoningEffort}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, reasoningEffort: e.target.value as any },
                      })
                    }
                  >
                    <option value="default">默认 (按模型自身策略)</option>
                    <option value="none">none (模型支持时关闭推理)</option>
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
                  <label className={styles.fieldLabel}>超时上限 (毫秒，默认 60000):</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    value={settings.llm.timeoutMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        llm: { ...settings.llm, timeoutMs: Number(e.target.value) || 60000 },
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

          {/* 座位看牌入口由调试牌桌提供，无需额外授权或保存。 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}><span>👀 调试看牌</span></div>
            <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
              开启调试模式后，四家座位信息条末尾各有「看牌／关牌」按钮，可独立显示或收起本家手牌，包括人工玩家。
              默认只展示自己的手牌；叫满 100 分且成功扣底后，搭档按规则明牌，不能关闭。退出调试后清理临时看牌状态。头像仍用于查看决策原因。
            </p>
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
                            {rec.fallbackReason ? `${rec.requestedEngine}➔${rec.engineType}` : rec.engineType}
                          </span>
                        </td>
                        <td><strong>{rec.chosenCard ? rec.chosenCard.rank + rec.chosenCard.suit : actionLabel(rec.action)}</strong></td>
                        <td>{Math.round(rec.latencyMs)}ms</td>
                        <td>{rec.fallbackReason ? `回退: ${rec.fallbackReason}` : rec.conclusion ?? rec.diagnostic ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            完成
          </button>
        </div>
    </Modal>
  );
}
