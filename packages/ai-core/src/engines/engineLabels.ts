/** 引擎展示名称（SRP）：统一玩家、调试与日志入口的计算术语，不改变引擎标识。 */
import type { EngineType } from './engineTypes';
import type { DecisionEngineManager } from './index';

export const ENGINE_LABELS: Record<EngineType, string> = {
  llm: '大模型 LLM',
  laya: 'System One（Laya）',
  bridge: '桥牌 Bridge（DDS）',
  algorithm: '推演算法（Worker）',
};

/** 保留用户配置名，同时让自定义名称也能辨认其引擎类型。 */
export function profileLabel(profile: { name: string; type: EngineType }): string {
  const label = ENGINE_LABELS[profile.type];
  return profile.name.includes(label) ? profile.name : `${profile.name} · ${label}`;
}

/** 显示本座冻结版本；人工座位在观战或调试代走时采用与实际路由相同的默认配置。 */
export function seatEngineLabel(manager: DecisionEngineManager, seat: number, forceAI: boolean): string {
  const route = manager.getSeatRoutes()?.[seat];
  if (manager.isHumanSeat(seat) && !forceAI) return 'Human（人工）';
  const profiles = manager.getProfiles();
  const profile = route && route !== 'human' ? manager.getProfileVersion(route.version)
    : profiles.find(value => value.type === manager.getActiveType()) ?? profiles[0];
  return ENGINE_LABELS[profile?.type ?? manager.getActiveType()];
}
