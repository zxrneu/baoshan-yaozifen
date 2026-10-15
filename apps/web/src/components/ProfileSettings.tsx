/** 引擎参数版本编辑（SRP）：逐座选择由牌桌入口承担，参数编辑创建新版本。 */
import { useEffect, useState } from 'react';
import type { DecisionEngineManager } from '@yaozifen/ai-core/engines/index';
import { requestProfiles } from '@yaozifen/ai-core/engines/profileClient';
import { profileLabel } from '@yaozifen/ai-core/engines/engineLabels';
import styles from './EngineSettingsModal.module.css';
export default function ProfileSettings({ manager, developer }: { manager: DecisionEngineManager; developer: boolean }) {
  const [, update] = useState(0); const profiles = manager.getProfiles();
  const [editing, setEditing] = useState(profiles[0]?.profileId ?? '');
  const selected = profiles.find(profile => profile.profileId === editing);
  const [name, setName] = useState(selected?.name ?? ''); const [parameters, setParameters] = useState('{}');
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => manager.subscribe(() => update(value => value + 1)), [manager]);
  useEffect(() => {
    if (!selected) return;
    setName(selected.name); const { serviceId: _serviceId, ...editable } = selected.parameters.options;
    setParameters(JSON.stringify(editable, null, 2));
  }, [selected?.version]);
  async function changeFile(edit: boolean) {
    setBusy(true); setStatus('');
    try {
      const next = await requestProfiles(edit ? { profileId: editing, expectedVersion: selected?.version, name, options: JSON.parse(parameters) } : { reload: true });
      manager.setProfiles(next); setStatus('配置目录已更新；当前座位保留原版本，重新选择可应用新版本。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '配置保存失败'); }
    finally { setBusy(false); }
  }
  const options = profiles.map(profile => <option key={profile.version} value={profile.profileId}>{profileLabel(profile)}</option>);
  if (!developer) return null;
  return <section className={styles.section} aria-label="引擎配置参数">
    <h3 className={styles.sectionTitle}>引擎配置参数</h3>
      <button className="ghost-btn" disabled={busy} onClick={() => void changeFile(false)}>重新加载配置文件</button>
      {!!profiles.length && <><label>编辑配置 <select className={styles.fieldSelect} aria-label="编辑配置" value={editing} onChange={event => setEditing(event.target.value)}>{options}</select></label>
        <label className={styles.field}>名称 <input className={styles.fieldInput} aria-label="配置名称" value={name} onChange={event => setName(event.target.value)}/></label>
        <label className={styles.field}>参数（JSON）<textarea className={styles.fieldInput} aria-label="配置参数" rows={10} value={parameters} onChange={event => setParameters(event.target.value)}/></label>
        <p>端点与密钥使用环境变量引用。System One 扣底、Bridge/Algorithm 前三阶段使用启发式规则。</p>
        <button className="ghost-btn" disabled={busy || !selected} onClick={() => void changeFile(true)}>保存配置新版本</button></>}
    {status && <p role="status">{status}</p>}
  </section>;
}
