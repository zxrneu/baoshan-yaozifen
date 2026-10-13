/** 对局日志：滚动显示最近若干条 */
import styles from './GameLog.module.css';
import type { ObservedAction } from '../hooks/actionPresentation';

const LINES_SHOWN = 6;

export default function GameLog({ history, actions = [] }: { history: string[]; actions?: ObservedAction[] }) {
  const recent = history.slice(-LINES_SHOWN);
  return (
    <details className={styles.log}>
      <summary className={styles.last}>{recent[recent.length - 1] ?? '对局记录'}</summary>
      {actions.length > 0 && <><strong>已观察动作 · {actions.length} 步</strong><ol className={styles.actions}>{actions.map((action, i) => <li key={i}><b>{action.title}</b><span>{action.detail}</span></li>)}</ol></>}
      {recent.slice(0, -1).map((line, i) => (
        <div key={history.length - recent.length + i}>
          {line}
        </div>
      ))}
    </details>
  );
}
