/** 短教学仅管理独立题目与反馈；遵循单一职责，不接收活动牌局或决策配置。 */
import { useEffect, useRef, useState } from 'react';
import { cardId, cardLabel, cardPoints, type Card } from '@yaozifen/game-core/cards';
import { legalFollowCards } from '@yaozifen/game-core';
import CardView from '../CardView';
import { CardInspectionContext } from './cardInspection';
import Modal from './Modal';
import styles from './TutorialModal.module.css';

const pointHand: readonly Card[] = [
  { suit: 'S', rank: 'A' }, { suit: 'H', rank: '10' },
  { suit: 'D', rank: '5' }, { suit: 'C', rank: 'K' },
];
const followHand: readonly Card[] = [
  { suit: 'H', rank: '7' }, { suit: 'H', rank: 'Q' },
  { suit: 'C', rank: '8' }, { suit: 'D', rank: '2' },
];
const ledCard: Card = { suit: 'H', rank: '9' };
type Stage = 'points' | 'follow' | 'void' | 'complete';
type Feedback = { correct: boolean; text: string };
const lessons = {
  points: {
    title: '认分牌', instruction: '选出所有分牌，再确认答案',
    explanation: 'A 和 10 各 10 分，5 为 5 分；其余牌没有分。牌大不代表有分。',
    hand: pointHand, next: 'follow', nextLabel: '下一段',
  },
  follow: {
    title: '跟门', instruction: '有红桃时，选一张同门牌跟出',
    explanation: '本题主牌是梅花。东家领出红桃 9；你有红桃，必须跟红桃，不能改出主牌。',
    hand: followHand, next: 'void', nextLabel: '继续：缺门时',
  },
  void: {
    title: '跟门', instruction: '没有红桃时，杀或垫都可以',
    explanation: '换一个题目：东家仍领出红桃 9，主牌仍是梅花；这次你的手牌只有梅花 8 和方块 2，没有红桃。选一张，再确认。',
    hand: followHand.filter(card => card.suit !== 'H'), next: 'complete', nextLabel: '完成教学',
  },
} as const;

export default function TutorialModal({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('points');
  const [skipped, setSkipped] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
    if (body.current) body.current.scrollTop = 0;
  }, [stage]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => { feedbackElement.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [feedback]);
  const lesson = stage === 'complete' ? null : lessons[stage];
  const title = lesson?.title ?? (skipped ? '教学已结束' : '基础练习完成');
  const hand = lesson?.hand ?? [];
  const legal = new Set(legalFollowCards(hand, ledCard.suit).map(cardId));
  function goTo(next: Stage) { setStage(next); setSelected(new Set()); setFeedback(null); }
  function select(card: Card) {
    const next = new Set(stage === 'points' ? selected : []);
    if (next.has(cardId(card))) next.delete(cardId(card)); else next.add(cardId(card));
    setSelected(next); setFeedback(null);
  }
  function checkPoints() {
    const correct = pointHand.every(card => selected.has(cardId(card)) === (cardPoints(card) > 0));
    setFeedback({ correct, text: correct
      ? '答对了！A 和 10 各 10 分，5 为 5 分，这三张合计 25 分。全副四门花色共有 100 分。'
      : '再看看：A、10、5 才是分牌，K 没有分。请补齐漏选的分牌或取消非分牌，再确认。' });
  }
  function checkFollow() {
    const card = hand.find(card => selected.has(cardId(card)));
    if (!card) return;
    const correct = legal.has(cardId(card));
    const explanation = stage === 'void'
      ? `你出了 ${cardLabel(card)}。没有红桃时可以用梅花主牌杀，也可以垫方块；规则不强制用主牌。`
      : `你跟出了 ${cardLabel(card)}。手里有红桃就必须跟红桃，大小都可以，不要求压过领牌。`;
    setFeedback({ correct, text: correct ? explanation
      : '手里有红桃，必须跟红桃。请重新选择。' });
  }
  return <Modal label="新手教学" onClose={onClose} className="modal-box">
    <div className="modal-header">
      <h2 ref={heading} tabIndex={-1}>新手教学 · {title}</h2>
      <span aria-label="教学进度" aria-live="polite">{stage === 'points' ? '1' : stage === 'follow' ? '2' : '3'} / 3</span>
    </div>
    <div ref={body} className={`modal-body ${styles.body}`}>
      <p className={styles.note}>固定公开题目 · 原对局已暂停，随时退出即可返回。</p>
      {lesson && <>
        <h3>{lesson.instruction}</h3>
        <p>{lesson.explanation}</p>
        <CardInspectionContext.Provider value={null}>
          <div className={styles.question}>
          {stage !== 'points' && <section><p className={styles.note}>东家领牌</p><div role="group" aria-label="公开领牌" className={styles.cards}><CardView card={ledCard} /></div></section>}
          <section><p className={styles.note}>{stage === 'points' ? '示例牌张' : '你的全部手牌'}</p>
          <div role="group" aria-label="题目手牌" className={styles.cards}>
            {hand.map(card => {
              const forbidden = stage !== 'points' && !legal.has(cardId(card));
              return <CardView key={cardId(card)} card={card} playable selected={selected.has(cardId(card))}
                isTrump={stage !== 'points' && card.suit === 'C'} disabled={forbidden || feedback?.correct}
                disabledReason={forbidden ? '手里有红桃，必须跟红桃' : undefined}
                onClick={forbidden || feedback?.correct ? undefined : () => select(card)} />;
            })}
          </div>
          </section>
          </div>
        </CardInspectionContext.Provider>
        <button type="button" className="primary-btn" disabled={!selected.size || feedback?.correct} onClick={stage === 'points' ? checkPoints : checkFollow}>{stage === 'points' ? '确认分牌' : '确认出牌'}</button>
      </>}
      {stage === 'complete' && <>
        <p>{skipped ? '已跳过部分题目，随时可以重新进入教学练习。' : '你已练习认分牌、跟同门和缺门时的选择。'}</p>
        <ul><li>A / 10 各 10 分，5 为 5 分；全副 100 分。</li><li>有同门必须跟同门，不要求出更大的牌。</li><li>缺门可以出主牌，也可以垫其他花色。</li></ul>
        <p>返回后可继续原局，或从顶栏开始「单副练习」。</p>
      </>}
      {feedback && <p ref={feedbackElement} role={feedback.correct ? 'status' : 'alert'} className={styles.feedback}>{feedback.text}</p>}
    </div>
    <div className={`modal-footer ${styles.footer}`}>
      <button type="button" onClick={onClose}>{stage === 'complete' ? '返回牌桌' : '退出教学'}</button>
      {stage !== 'complete' && <button type="button" onClick={() => { setSkipped(true); goTo(stage === 'points' ? 'follow' : 'complete'); }}>跳过本段</button>}
      {lesson && <button type="button" disabled={!feedback?.correct} onClick={() => goTo(lesson.next)}>{lesson.nextLabel}</button>}
    </div>
  </Modal>;
}
