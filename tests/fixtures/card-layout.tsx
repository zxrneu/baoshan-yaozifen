/** 牌面几何验收夹具：复用真实牌张组件，覆盖尺寸、分牌标识与四座旋转。 */
import { createRoot } from 'react-dom/client';
import type { CSSProperties } from 'react';
import CardView from '../../src/CardView';
import type { Suit } from '../../src/cards';
import '../../src/styles/index.css';
interface Example { width: number; angle: number; suit: Suit; size: 'normal' | 'small' | 'mini' }
const examples: Example[] = [48, 54, 72, 92].flatMap(width => ([0, 90, 180, -90]).map((angle, index) => ({ width, angle, suit: (['S', 'H', 'C', 'D'] as Suit[])[index], size: 'normal' as const })));
examples.push({ width: 92, angle: 0, suit: 'H', size: 'small' }, { width: 92, angle: 0, suit: 'D', size: 'mini' });
createRoot(document.getElementById('root')!).render(<div style={{display:'grid', gridTemplateColumns:'repeat(6, 150px)', gap:20, padding:30}}>
  {examples.map((example, i) => <div key={i} data-example={`${example.width}-${example.angle}-${example.size}`} style={{height:180, display:'grid', placeItems:'center'}}>
    <div style={{ '--card-w': `${example.width}px`, '--card-h': `${example.width * 1.4}px`, transform: `rotate(${example.angle}deg)` } as CSSProperties}>
      <CardView card={{rank:'10', suit:example.suit}} size={example.size} isTrump isKitty />
    </div>
  </div>)}
</div>);
