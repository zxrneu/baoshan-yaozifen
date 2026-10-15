/** 游戏图标只负责矢量呈现；语义由旁边的文字或宿主控件提供，遵循单一职责。 */
import type { ReactNode } from 'react';

const shapes = {
  crown: <><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5Z" /><path d="M5 21h14" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  history: <><path d="M4 9a8 8 0 1 1 0 7M4 3v6h6" /><path d="M12 7v5l3 2" /></>,
  coins: <><ellipse cx="10" cy="6" rx="7" ry="3" /><path d="M3 6v5c0 4 14 4 14 0V6M3 11v5c0 3 7 4 11 2M21 10v7c0 3-6 5-10 4" /></>,
  back: <><path d="m9 5-7 7 7 7M3 12h12a6 6 0 0 1 6 6" /></>,
  speed: <><path d="M4 19a9 9 0 1 1 16 0M12 12l5-5" /><circle cx="12" cy="12" r="2" /></>,
  step: <><path d="m5 4 11 8-11 8ZM20 4v16" /></>,
  exit: <><path d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5" /></>,
  check: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="m7 12 3 3 7-7" /></>,
  settings: <><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3M16 8l3-3" /><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></>,
  book: <><path d="M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16" /></>,
  cards: <><rect x="7" y="3" width="13" height="18" rx="2" /><path d="m4 5-2 1 3 15 2-1M13 8l3 4-3 4-3-4Z" /></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  muted: <><path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6" /></>,
  speech: <><path d="M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 0 1-1-5 8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" /><path d="M7 9h10M7 13h7" /></>,
} satisfies Record<string, ReactNode>;

export default function GameIcon({ name, className }: { name: keyof typeof shapes; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
