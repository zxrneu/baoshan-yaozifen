/** 对局日志：滚动显示最近若干条 */
const LINES_SHOWN = 6;

export default function GameLog({ history }: { history: string[] }) {
  const recent = history.slice(-LINES_SHOWN);
  return (
    <footer className="log">
      {recent.map((line, i) => (
        <div key={history.length - recent.length + i} className={i === recent.length - 1 ? 'last' : ''}>
          {line}
        </div>
      ))}
    </footer>
  );
}
