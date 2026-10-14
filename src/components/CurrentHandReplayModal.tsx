/** 结算复盘（SRP / DIP）：直达已保存的本副路径，加载失败可重试，关闭隔离迟到响应。 */
import { useEffect, useState } from 'react';
import type { HandDetail } from '../history/transport';
import { historyClient } from '../history/client';
import Modal from './Modal';
import HistoryReplay from './HistoryReplay';
import styles from './GameHistoryModal.module.css';

export interface CurrentHandReplay { detail: HandDetail; branchId: string }
export default function CurrentHandReplayModal({ load, onClose }: {
  load: () => Promise<CurrentHandReplay>;
  onClose: () => void;
}) {
  const [replay, setReplay] = useState<CurrentHandReplay | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReplay(null); setError('');
    void load().then(value => { if (active) setReplay(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '本副记录加载失败，请重试'); });
    return () => { active = false; };
  }, [load, attempt]);
  return <Modal label="本副复盘" onClose={onClose} className={`modal-box ${styles.modal}`}>
    <div className={styles.heading}><h2>本副真实出牌复盘</h2><button type="button" className="ghost-btn" onClick={onClose}>返回结算</button></div>
    <div className={styles.body} aria-busy={!replay && !error}>
      {!replay && !error && <p role="status">正在加载本副真实记录…</p>}
      {error && <><p role="alert">{error}</p><button type="button" className="ghost-btn" onClick={() => setAttempt(value => value + 1)}>重试加载</button></>}
      {replay && <HistoryReplay detail={replay.detail} initialBranchId={replay.branchId} client={historyClient} onUpdated={detail => setReplay({ ...replay, detail })}/>}
    </div>
  </Modal>;
}
