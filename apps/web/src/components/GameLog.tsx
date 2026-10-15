/** 对局日志遵循单一职责：直接显示公开记录，独立滚动且不触发牌桌快捷键。 */
import styles from './GameLog.module.css';
import type { ObservedAction } from '../hooks/actionPresentation';

const LINES_SHOWN = 6;

export default function GameLog({ history, actions = [] }: { history: string[]; actions?: ObservedAction[] }) {
  const recent = history.slice(-LINES_SHOWN);
  return (
    <section className={styles.log} aria-label="对局记录" tabIndex={0} onKeyDown={event => event.stopPropagation()}>
      <h3 className={styles.last}>对局记录</h3>
      {actions.length > 0 && <><strong>已观察动作 · {actions.length} 步</strong><ol className={styles.actions}>{actions.map((action, i) => <li key={i}><b>{action.title}</b><span>{action.detail}</span></li>)}</ol></>}
      {[...recent].reverse().map((line, i) => (
        <div key={history.length - recent.length + i}>
          {line}
        </div>
      ))}
    </section>
  );
}
