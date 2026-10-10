/** 对局日志：滚动显示最近若干条 */
import styles from './GameLog.module.css';

const LINES_SHOWN = 6;

export default function GameLog({ history }: { history: string[] }) {
  const recent = history.slice(-LINES_SHOWN);
  return (
    <details className={styles.log}>
      <summary className={styles.last}>{recent[recent.length - 1] ?? '对局记录'}</summary>
      {recent.slice(0, -1).map((line, i) => (
        <div key={history.length - recent.length + i}>
          {line}
        </div>
      ))}
    </details>
  );
}
