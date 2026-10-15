/** 规则说明弹窗 */
import Modal from './Modal';
import styles from './RulesModal.module.css';

interface Props {
  onClose: () => void;
}

export default function RulesModal({ onClose }: Props) {
  return (
    <Modal label="游戏规则" onClose={onClose} className="modal-box">
        <div className="modal-header">
          <h2>保山幺子分 · 规则速查</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={`modal-body ${styles.rulesContent}`}>
          <section>
            <h3>👥 基本设定</h3>
            <ul>
              <li><strong>四人搭档</strong>：东西两家一方 vs 南北两家一方，逆时针轮流出牌。</li>
              <li><strong>一副 52 张</strong>：无大小王。每人发 12 张牌，留 4 张底牌。</li>
              <li><strong>分牌</strong>：<code>A</code> 和 <code>10</code> 每张 10 分，<code>5</code> 每张 5 分；全副 4 门花色合计 <strong>100 分</strong>。</li>
              <li><strong>大小顺序</strong>：同花色内 <code>A &gt; K &gt; Q &gt; J &gt; 10 &gt; 9 &gt; … &gt; 2</code>。</li>
            </ul>
          </section>

          <section>
            <h3>🎯 阶段流程</h3>
            <ol>
              <li>
                <strong>叫分</strong>：从发牌者下家开始轮流叫分，<strong>起叫 70 分</strong>，步长 5，最高 100 分。最高叫分者为庄家；四家均不叫则重新发牌。
              </li>
              <li>
                <strong>定主</strong>：庄家从黑桃♠、红桃♥、梅花♣、方块♦中任选一门作为主牌。
              </li>
              <li>
                <strong>拿底 / 扣底</strong>：庄家拿入 4 张底牌（手牌变为 16 张），选 4 张扣回底牌。<strong>分牌（A / 10 / 5）不可扣底</strong>。
                <strong>叫满 100 分时，成功扣底后庄家的搭档明牌，剩余手牌对所有人可见，并随出牌减少。</strong>
              </li>
              <li>
                <strong>出牌</strong>：庄家首先出牌，共打 12 轮。四家各出一张牌算一轮。
                <ul>
                  <li>首家出的花色为领出花色，其余家<strong>有同门必须跟同门</strong>；</li>
                  <li>缺门时可以用主牌“杀”（毙），也可垫其他门非主牌（垫牌不计大）；</li>
                  <li>主牌大于任何非主牌；四家出完后，牌最大的一家收走本轮的牌和分数，并在下一轮首先出牌。</li>
                </ul>
              </li>
              <li>
                <strong>结算</strong>：庄家方吃分（出牌得分 + 最终底牌分）≥ 叫分即<strong>成局</strong>获胜，否则闲家方获胜。先胜目标局数（默认 5 副）获得全场胜利。
              </li>
            </ol>
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>知道了</button>
        </div>
    </Modal>
  );
}
