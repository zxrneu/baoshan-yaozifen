/** 看牌上下文按接口隔离共享只读查看入口，观战时点击牌不会提交动作。 */
import { createContext } from 'react';
import type { Card } from '../cards';
export const CardInspectionContext = createContext<{ inspectOnly: boolean; inspect: (card: Card) => void } | null>(null);
