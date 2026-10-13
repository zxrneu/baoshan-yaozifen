/** 四座配置与参数编辑界面（SRP）：名字用于玩家选择，参数编辑创建新版本。 */
import { useEffect, useState } from 'react';
import type { DecisionEngineManager } from '../ai/engines';
import { SEAT_NAMES } from '../engine';
import { requestProfiles, saveSeatProfiles } from '../ai/engines/profileClient';
import styles from './EngineSettingsModal.module.css';
export default function ProfileSettings({ manager, developer }: { manager: DecisionEngineManager; developer: boolean }) {
  const [, update] = useState(0); const profiles = manager.getProfiles(); const routes = manager.getSeatRoutes();
  const [a, setA] = useState(profiles[0]?.profileId ?? ''); const [b, setB] = useState(profiles[1]?.profileId ?? profiles[0]?.profileId ?? '');
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
  const options = profiles.map(profile => <option key={profile.version} value={profile.profileId}>{profile.name}</option>);
  return <section className={styles.section} aria-label="四座配置">
    <h3 className={styles.sectionTitle}>四座玩家与打法</h3>
    {!routes && <p>连接配置服务后可按座位选择打法。</p>}
    {routes && <>
      {routes.map((route, seat) => {
        const current = route === 'human' ? undefined : manager.getProfileVersion(route.version);
        const outdated = current && !profiles.some(profile => profile.version === current.version);
        return <div className={styles.field} key={seat}><label className={styles.fieldLabel}>{SEAT_NAMES[seat]}家
          <select className={styles.fieldSelect} aria-label={`${SEAT_NAMES[seat]}家配置`} value={route === 'human' ? 'human' : outdated ? `pinned:${route.version}` : route.profileId} onChange={event => { manager.assignSeat(seat, event.target.value); saveSeatProfiles(manager); }}>
            <option value="human">Human（人工）</option>{options}
            {outdated && <option value={`pinned:${current.version}`}>{current.name}（本副原版本）</option>}
          </select></label></div>;
      })}
      <div className={styles.field}><label>南北队 <select className={styles.fieldSelect} aria-label="南北队配置" value={a} onChange={event => setA(event.target.value)}>{options}</select></label>
        <label>东西队 <select className={styles.fieldSelect} aria-label="东西队配置" value={b} onChange={event => setB(event.target.value)}>{options}</select></label>
        <button className="ghost-btn" disabled={!a || !b} onClick={() => { manager.assignTeams(a, b); saveSeatProfiles(manager); }}>应用两队配置</button></div>
    </>}
    {developer && <>
      <button className="ghost-btn" disabled={busy} onClick={() => void changeFile(false)}>重新加载配置文件</button>
      {!!profiles.length && <><label>编辑配置 <select className={styles.fieldSelect} aria-label="编辑配置" value={editing} onChange={event => setEditing(event.target.value)}>{options}</select></label>
        <label className={styles.field}>名称 <input className={styles.fieldInput} aria-label="配置名称" value={name} onChange={event => setName(event.target.value)}/></label>
        <label className={styles.field}>参数（JSON）<textarea className={styles.fieldInput} aria-label="配置参数" rows={10} value={parameters} onChange={event => setParameters(event.target.value)}/></label>
        <p>端点与密钥使用环境变量引用。System One 扣底、Bridge/Algorithm 前三阶段使用启发式规则。</p>
        <button className="ghost-btn" disabled={busy || !selected} onClick={() => void changeFile(true)}>保存配置新版本</button></>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
