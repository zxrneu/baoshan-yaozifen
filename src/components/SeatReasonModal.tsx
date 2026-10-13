/** 决策理由视图按单一职责读取当前分支的真实记录，拒绝把其他对局或撤销分支的理由混入。 */
import { SEAT_NAMES } from '../engine';
import type { DecisionRecord } from '../ai/engines/engineTypes';
import { actionLabel } from '../workbench/actions';
import Modal from './Modal';
import MarkdownView from './MarkdownView';
import styles from './SeatReasonModal.module.css';

export default function SeatReasonModal({ seat, record, onClose }: { seat: number; record?: DecisionRecord; onClose: () => void }) {
  const reason = record?.conclusion || record?.thinking || record?.diagnostic;
  return <Modal label={`${SEAT_NAMES[seat]}家决策原因`} onClose={onClose} className={styles.dialog} backdropClassName={`modal-backdrop ${styles.backdrop}`}>
    <div className={styles.heading}><h2>{SEAT_NAMES[seat]}家 · 决策原因</h2><button className={styles.close} type="button" aria-label="关闭决策原因" onClick={onClose}>×</button></div>
    {record && <p className={styles.meta}>{record.action ? actionLabel(record.action) : '最近一次决策'} · {record.status === 'applied' ? '已执行' : '已决定，尚未执行'}</p>}
    <div className={styles.body}>
      {reason ? <MarkdownView content={reason} /> : <p>暂无决策记录。继续对局后可再次查看。</p>}
      {record?.thinking && record.thinking !== reason && <><h3>决策过程</h3><MarkdownView content={record.thinking} /></>}
      {record?.fallbackReason && <p>降级原因：{record.fallbackReason}</p>}
    </div>
    <div className={styles.footer}><button type="button" className="primary-btn" onClick={onClose}>返回牌桌</button></div>
  </Modal>;
}
