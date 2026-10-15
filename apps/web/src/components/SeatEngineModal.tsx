/** 座位引擎选择（SRP）：展示可用配置并保存单座路由，冻结版本由管理器维护。 */
import { useEffect, useState } from 'react';
import type { DecisionEngineManager } from '@yaozifen/ai-core/engines/index';
import { profileLabel } from '@yaozifen/ai-core/engines/engineLabels';
import { saveSeatProfiles } from '@yaozifen/ai-core/engines/profileClient';
import { SEAT_NAMES } from '@yaozifen/game-core';
import Modal from './Modal';
import styles from './EngineSettingsModal.module.css';

export default function SeatEngineModal({ manager, seat, onClose, persistSelection = true }: {
  manager: DecisionEngineManager;
  seat: number;
  onClose: () => void;
  persistSelection?: boolean;
}) {
  const [, update] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => manager.subscribe(() => update(value => value + 1)), [manager]);
  const profiles = manager.getProfiles();
  const route = manager.getSeatRoutes()?.[seat];
  const current = route && route !== 'human' ? manager.getProfileVersion(route.version) : undefined;
  const outdated = current && !profiles.some(profile => profile.version === current.version);
  return <Modal label={`${SEAT_NAMES[seat]}家引擎`} onClose={onClose} className="modal-box">
    <div className="modal-header"><h2>{SEAT_NAMES[seat]}家引擎</h2></div>
    <div className="modal-body">
      <label className={styles.fieldLabel}>玩家与打法
        <select className={styles.fieldSelect} aria-label={`${SEAT_NAMES[seat]}家配置`}
          disabled={!route} value={route === 'human' ? 'human' : outdated ? `pinned:${current.version}` : current?.profileId ?? ''}
          onChange={event => {
            try { manager.assignSeat(seat, event.target.value); if (persistSelection) saveSeatProfiles(manager); onClose(); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '引擎切换失败'); }
          }}>
          <option value="human">Human（人工）</option>
          {profiles.map(profile => <option key={profile.version} value={profile.profileId}>{profileLabel(profile)}</option>)}
          {outdated && <option value={`pinned:${current.version}`}>{profileLabel(current)}（本副原版本）</option>}
        </select>
      </label>
      <p>{route ? '选择后立即应用到本家。对局已暂停，可返回牌桌继续。' : '引擎配置尚未加载，请稍后重试。'}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="primary-btn" onClick={onClose}>返回牌桌</button></div>
  </Modal>;
}
