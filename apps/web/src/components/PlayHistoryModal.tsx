/**
 * 历史出牌回顾弹窗：
 * 满足“历史每位选手的出牌”与“按轮次回看”两大视角，支持分牌高亮与各家吃分盘点。
 */
import Modal from './Modal';
import { useState } from 'react';
import { Card as CardModel, cardPoints } from '@yaozifen/game-core/cards';
import { SEAT_NAMES, GameState, sideOf } from '@yaozifen/game-core';
import CardView from '../CardView';
import styles from './PlayHistoryModal.module.css';

interface Props {
  game: GameState;
  humanSeat: number;
  onClose: () => void;
}

const SEAT_AVATARS: Record<number, { emoji: string; title: string }> = {
  0: { emoji: '🤠', title: '东家' },
  1: { emoji: '👑', title: '南家（你）' },
  2: { emoji: '🎩', title: '西家' },
  3: { emoji: '👲', title: '北家' },
};

export default function PlayHistoryModal({ game, humanSeat, onClose }: Props) {
  const [viewTab, setViewTab] = useState<'byPlayer' | 'byTrick'>('byPlayer');

  // 计算每位选手的历史出牌列表（已结束的轮次 + 当前正在出的这一轮）
  const playerPlayedCards: Record<number, { card: CardModel; trickNum: number }[]> = {
    0: [], 1: [], 2: [], 3: [],
  };

  // 1. 已完结的各轮
  (game.completedTricks || []).forEach((t) => {
    t.cards.forEach((c) => {
      playerPlayedCards[c.seat].push({ card: c.card, trickNum: t.trickNumber });
    });
  });

  // 2. 当前轮中已经出牌的
  (game.trick || []).forEach((c) => {
    playerPlayedCards[c.seat].push({ card: c.card, trickNum: game.trickNumber });
  });

  // 每位选手的吃分总额（从历史轮次中累加）
  const playerPoints: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  (game.completedTricks || []).forEach((t) => {
    playerPoints[t.winner] = (playerPoints[t.winner] || 0) + t.points;
  });

  return (
    <Modal label="对局出牌历史" onClose={onClose} className={`modal-box ${styles.historyModal}`}>
        <div className="modal-header">
          <div className={styles.headerTitleGroup}>
            <span className={styles.headerIcon}>📜</span>
            <h2>对局出牌历史与各家牌谱</h2>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {/* 顶部视角切换 Tab */}
        <div className={styles.historyTabBar}>
          <button
            type="button"
            className={`${styles.historyTabBtn} ${viewTab === 'byPlayer' ? styles.active : ''}`}
            onClick={() => setViewTab('byPlayer')}
          >
            👥 按选手查看（各家出牌）
          </button>
          <button
            type="button"
            className={`${styles.historyTabBtn} ${viewTab === 'byTrick' ? styles.active : ''}`}
            onClick={() => setViewTab('byTrick')}
          >
            🎴 按轮次回顾（第 1~{Math.max(1, game.trickNumber)} 轮）
          </button>
        </div>

        <div className={`modal-body ${styles.historyModalBody}`}>
          {viewTab === 'byPlayer' ? (
            /* ================= 视角 1：各选手历史出牌 ================= */
            <div className={styles.playersHistoryGrid}>
              {[0, 1, 2, 3].map((s) => {
                const avatar = SEAT_AVATARS[s];
                const cards = playerPlayedCards[s];
                const pts = playerPoints[s];
                const isDeclarer = game.declarer === s;
                const isPartner = game.declarer !== null && sideOf(s) === sideOf(game.declarer);
                const totalPtsFromCards = cards.reduce((sum, item) => sum + cardPoints(item.card), 0);

                return (
                  <div key={s} className={`${styles.playerHistoryCard} ${s === humanSeat ? styles.isMe : ''}`}>
                    <div className={styles.playerCardHeader}>
                      <div className={styles.avatarChip}>
                        <span className={styles.avEmoji}>{avatar.emoji}</span>
                        <div className={styles.avText}>
                          <span className={styles.name}>{SEAT_NAMES[s]}{s === humanSeat ? '（你）' : ''}</span>
                          <div className={styles.badgesLine}>
                            {isDeclarer && <span className={`${styles.badge} ${styles.declarer}`}>👑 庄家</span>}
                            {!isDeclarer && isPartner && <span className={`${styles.badge} ${styles.partner}`}>🤝 搭档</span>}
                            {!isDeclarer && !isPartner && game.declarer !== null && <span className={`${styles.badge} ${styles.defender}`}>🛡️ 闲家</span>}
                          </div>
                        </div>
                      </div>

                      <div className={styles.ptsPill}>
                        <span className={styles.pillTitle}>已获吃分</span>
                        <span className={styles.pillNum}>🪙 {pts} 分</span>
                      </div>
                    </div>

                    <div className={styles.playerCardStats}>
                      <span>已出 <strong>{cards.length}</strong> 张牌</span>
                      <span>· 打出分牌值 <strong>{totalPtsFromCards}</strong> 分</span>
                    </div>

                    <div className={styles.playedCardsFan}>
                      {cards.length === 0 ? (
                        <span className={styles.noCardsTip}>（本副尚未出牌）</span>
                      ) : (
                        cards.map((item, idx) => {
                          const cPts = cardPoints(item.card);
                          return (
                            <div key={idx} className={`${styles.fanCardItem} ${cPts > 0 ? styles.hasPoints : ''}`}>
                              <span className={styles.trickTag}>第{item.trickNum}轮</span>
                              <CardView card={item.card} size="small" />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ================= 视角 2：逐轮回看列表 ================= */
            <div className={styles.tricksHistoryList}>
              {(game.completedTricks || []).map((t) => {
                const winnerName = SEAT_NAMES[t.winner];
                return (
                  <div key={t.trickNumber} className={styles.trickHistoryRow}>
                    <div className={styles.trickRowHeader}>
                      <div className={styles.trickTitle}>
                        <span className={styles.trickBadge}>第 {t.trickNumber} 轮</span>
                        <span className={styles.winnerDesc}>
                          赢家：<strong>{winnerName}家</strong>
                          {t.points > 0 ? (
                            <span className={styles.ptsHighlight}>（收分 +{t.points}分）</span>
                          ) : (
                            <span className={styles.noPts}>（本轮无分牌）</span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className={styles.trickCardsFlex}>
                      {t.cards.map((c, idx) => {
                        const isWinCard = c.seat === t.winner;
                        return (
                          <div
                            key={c.seat}
                            className={`${styles.trickCardEntry} ${isWinCard ? styles.winnerEntry : ''}`}
                          >
                            <span className={styles.seatLabel}>
                              {SEAT_NAMES[c.seat]}
                              {idx === 0 && <span className={styles.leadTag}>首出</span>}
                              {isWinCard && <span className={styles.winTag}>赢</span>}
                            </span>
                            <CardView card={c.card} size="small" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* 本轮已有出牌且尚未结束时，显示当前出牌记录 */}
              {game.trick.length > 0 && (
                <div className={`${styles.trickHistoryRow} ${styles.currentTrickRow}`}>
                  <div className={styles.trickRowHeader}>
                    <div className={styles.trickTitle}>
                      <span className={`${styles.trickBadge} ${styles.active}`}>第 {game.trickNumber} 轮（进行中）</span>
                      <span className={styles.winnerDesc}>已出 {game.trick.length}/4 家</span>
                    </div>
                  </div>

                  <div className={styles.trickCardsFlex}>
                    {game.trick.map((c, idx) => (
                      <div key={c.seat} className={styles.trickCardEntry}>
                        <span className={styles.seatLabel}>
                          {SEAT_NAMES[c.seat]}
                          {idx === 0 && <span className={styles.leadTag}>首出</span>}
                        </span>
                        <CardView card={c.card} size="small" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose}>返回对局</button>
        </div>
    </Modal>
  );
}
