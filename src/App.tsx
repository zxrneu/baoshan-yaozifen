/** 牌桌与阶段操作分区；对局状态和规则仍由 useGame 编排。 */
import { revealedPartnerSeat, sideOf, SEAT_NAMES, type GameState } from './engine';
import { SUIT_NAME, SUIT_SYMBOL } from './cards';
import { useGame } from './hooks/useGame';
import SquareTable from './components/SquareTable';
import DebugSidePanel from './components/DebugSidePanel';
import Scoreboard from './components/Scoreboard';
import GameTools from './components/GameTools';
import OpponentSeat from './components/OpponentSeat';
import TrickArea from './components/TrickArea';
import HumanHand from './components/HumanHand';
import ControlPanel from './components/ControlPanel';
import GameLog from './components/GameLog';
import RulesModal from './components/RulesModal';
import LastTrickModal from './components/LastTrickModal';
import PointsTrackerModal from './components/PointsTrackerModal';
import PlayHistoryModal from './components/PlayHistoryModal';
import HandResultModal from './components/HandResultModal';
import KittyRevealBanner from './components/KittyRevealBanner';
import EngineSettingsModal from './components/EngineSettingsModal';
import GameHistoryModal from './components/GameHistoryModal';
import DecisionLogModal from './components/DecisionLogModal';
import { useEffect, useState } from 'react';
import { useSkin } from './hooks/useSkin';
import SkinPicker from './components/SkinPicker';
import styles from './App.module.css';

function findLatestBid(bidding: GameState['bidding'], seat: number): number | null | undefined {
  for (let i = bidding.length - 1; i >= 0; i--) {
    if (bidding[i].seat === seat) return bidding[i].bid;
  }
  return undefined;
}

export default function App() {
  const g = useGame();
  const [showSavedHistory, setShowSavedHistory] = useState(false);
  const [pendingHistoryExport, setPendingHistoryExport] = useState('');
  const { skin, setSkin } = useSkin();
  const { game, seat, humanSeat } = g;
  const humanBid = findLatestBid(game.bidding, humanSeat);
  const revealedSeat = revealedPartnerSeat(game);
  const showRevealedHand =
    (revealedSeat !== null && revealedSeat !== humanSeat) ||
    (g.godModeEnabled && g.devPeekSeats.size > 0);

  /**
   * 设置弹窗的初始层级。
   * 工具栏「⚙️ 设置」按玩家层打开；调试工作台的参数入口直接落到开发者选项层。
   * 用局部状态而非 useGame：这是纯 UI 视图细节，不应进入对局状态契约。
   */
  const [settingsLayer, setSettingsLayer] = useState<'player' | 'developer'>('player');
  const openSettings = (layer: 'player' | 'developer') => {
    setSettingsLayer(layer);
    g.setShowEngineSettings(true);
  };

  // 全局键盘快捷键 (Space -> Next/出牌, Enter -> 出牌/Next, Esc -> 关闭弹窗)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.key === 'Escape') {
        setShowSavedHistory(false);
        setPendingHistoryExport('');
        g.setShowRulesModal(false);
        g.setShowLastTrickModal(false);
        g.setShowPointsLedger(false);
        g.setShowHistoryModal(false);
        g.setShowEngineSettings(false);
        g.setShowDecisionLogModal(false);
      } else if (target?.isContentEditable || target?.closest('input, textarea, select, button, [role=dialog]')) {
        return;
      } else if (g.showRulesModal || g.showLastTrickModal || g.showPointsLedger || g.showHistoryModal || g.showEngineSettings || g.showDecisionLogModal || g.kittyRevealed || showSavedHistory || pendingHistoryExport) {
        return;
      } else if (g.isDebugMode && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey) g.redo(); else g.undo();
      } else if (g.isDebugMode && e.key.toLowerCase() === 'h') {
        e.preventDefault(); void g.triggerAiHint();
      } else if (g.isDebugMode && e.key.toLowerCase() === 'r') {
        e.preventDefault(); g.restart();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (g.isDebugMode) {
          void g.stepNext();
        } else if (g.selectedPlayCard) {
          g.confirmPlayCard();
        } else if (g.humanTurn && g.game.phase === 'playing') {
          g.flash('先点一张牌，再按空格出牌');
        }
      } else if (e.key === 'Enter') {
        if (g.selectedPlayCard) {
          g.confirmPlayCard();
        } else if (g.isDebugMode) {
          void g.stepNext();
        } else if (g.humanTurn && g.game.phase === 'playing') {
          g.flash('先点一张牌，再按回车出牌');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [g, showSavedHistory, pendingHistoryExport]);

  const seatPoints = (s: number) =>
    game.completedTricks.filter((t) => t.winner === s).reduce((sum, t) => sum + t.points, 0);
  const myTurn = g.humanTurn;
  const actor = myTurn ? '你' : `${SEAT_NAMES[seat]}家`;
  const actionPrompt = game.phase === 'bidding' ? `${myTurn ? '轮到' : '等待'}${actor}叫分`
    : game.phase === 'trump' ? `${myTurn ? '请' : '等待'}${actor}定主`
    : game.phase === 'bury' ? `${myTurn ? '请' : '等待'}${actor}扣底`
    : game.phase === 'handEnd' || game.phase === 'matchEnd' ? '本副已结束' : '';

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <Scoreboard game={game} humanSeat={humanSeat} />
        <div className={styles.headerControls}>
          <span role="status" aria-label="对局保存状态">{g.saveState.status === 'unsupported' ? '离线模式暂不支持历史' : g.saveState.status === 'saved' ? '已保存' : g.saveState.status === 'saving' ? `保存中 · ${g.saveState.pending}` : '未保存'}</span>
          {g.saveState.status === 'error' && <><button className="ghost-btn" onClick={() => void g.retrySave()}>重试保存</button><button className="ghost-btn" onClick={() => setPendingHistoryExport(g.exportPendingHistory())}>导出待保存记录</button></>}
          <button className="ghost-btn" onClick={() => setShowSavedHistory(true)}>对局历史</button>
          <SkinPicker skin={skin} onChange={setSkin} />
        </div>
      </div>
      {g.isDebugMode ? (
        <div className={styles.workspaceDebug}>
          <SquareTable
            game={game}
            humanSeat={humanSeat}
            seat={seat}
            isThinking={g.isThinking}
            hasReadyDecision={Boolean(g.pendingAiAction || g.aiHintAction)}
            decisionNotice={g.decisionNotice}
            onDismissDecision={g.dismissDecisionNotice}
            selectedPlayCard={g.selectedPlayCard}
            aiHintCard={g.aiHintAction?.kind === 'play' ? g.aiHintAction.card : null}
            selectedBuryCards={g.selected}
            bidOptions={g.bidOptions}
            confirmBeforePlay={g.confirmBeforePlay}
            onHumanCardClick={g.onCardClick}
            onManualPlaySeat={g.manualPlaySeatCard}
            confirmPlayCard={g.confirmPlayCard}
            doBid={g.doBid}
            doTrump={g.doTrump}
            doBury={g.doBury}
            autoSelectBury={g.autoSelectBury}
            clearSelectedBury={g.clearSelectedBury}
            goNextHand={g.goNextHand}
            restart={g.restart}
          />
          <DebugSidePanel
            game={game}
            seat={seat}
            engineType={g.engineType}
            setEngineType={g.setEngineType}
            isStepMode={g.isStepMode}
            setIsStepMode={g.setIsStepMode}
            isThinking={g.isThinking}
            pendingAiAction={g.pendingAiAction}
            aiHintAction={g.aiHintAction}
            stepNext={g.stepNext}
            triggerAiHint={g.triggerAiHint}
            manualPlaySeat={g.manualPlaySeatCard}
            undo={g.undo}
            canUndo={g.canUndo}
            redo={g.redo}
            canRedo={g.canRedo}
            saveSnapshot={g.saveSnapshot}
            loadSnapshot={g.loadSnapshot}
            rewind={g.rewind}
            applyHint={g.applyHint}
            pause={g.pause}
            sessionMode={g.sessionMode}
            sessionCursor={g.sessionCursor}
            restart={g.restart}
            soundMuted={g.soundMuted}
            toggleSoundMute={g.toggleSoundMute}
            onOpenEngineSettings={() => openSettings('developer')}
            onOpenDecisionLog={() => g.setShowDecisionLogModal(true)}
          />
        </div>
      ) : (
        <div className={styles.workspace}>
          <main className={`${styles.table} ${showRevealedHand ? styles.hasRevealedHand : ''}`} aria-label="对局牌桌" data-phase={game.phase} data-revealed-seat={showRevealedHand ? revealedSeat : undefined}>
            <div className={styles.tableBrand} aria-hidden="true">保山幺子分<span>四人搭档 · 百分争先</span></div>
            <div className={styles.tableHud}>
              <span className={styles.trumpLabel}>
                {game.trump ? `主牌 ${SUIT_SYMBOL[game.trump]} ${SUIT_NAME[game.trump]}` : '尚未定主'}
              </span>
              {game.phase === 'bidding' ? (
                <span className={styles.tableMeta}>
                  {game.highestBidder !== null ? `当前最高 ${SEAT_NAMES[game.highestBidder]} · ${game.highestBid} 分` : '起叫 70 分'}
                </span>
              ) : game.declarer !== null ? (
                <div className={styles.roundScores}>
                  <span>庄 {SEAT_NAMES[game.declarer]} · 叫 {game.highestBid} 分</span>
                  {(game.phase === 'playing' || game.result) && (
                    <span>庄方 <strong>{game.declarerTrickPoints + game.buriedPoints}</strong> / {game.highestBid} · 闲方 <strong>{game.defenderTrickPoints}</strong></span>
                  )}
                </div>
              ) : null}
            </div>

            {[0, 1, 2, 3].filter(s => s !== humanSeat).map((s) => (
              <OpponentSeat
                key={s}
                seat={s}
                displaySeat={(s - humanSeat + 5) % 4}
                cardCount={game.hands[s]?.length ?? 0}
                isTurn={seat === s}
                isDeclarer={game.declarer === s}
                isPartner={game.declarer !== null && game.declarer !== s && sideOf(s) === sideOf(game.declarer)}
                hasDeclarer={game.declarer !== null}
                isTeammate={sideOf(s) === sideOf(humanSeat)}
                isRevealed={revealedSeat === s}
                isPeeked={g.godModeEnabled && g.devPeekSeats.has(s)}
                revealedCards={revealedSeat === s || (g.godModeEnabled && g.devPeekSeats.has(s)) ? game.hands[s] : undefined}
                trump={game.trump}
                points={seatPoints(s)}
                biddingNote={game.phase === 'bidding' ? findLatestBid(game.bidding, s) : undefined}
                isBiddingPhase={game.phase === 'bidding'}
                onTogglePeek={g.godModeEnabled ? () => g.toggleDevPeek(s) : undefined}
              />
            ))}

            <TrickArea
              viewSeat={humanSeat}
              trick={game.trick}
              lastTrick={game.lastTrick}
              lastWinner={game.lastWinner}
              lastPoints={game.lastPoints}
              kitty={game.kitty}
              phase={game.phase}
              compact={showRevealedHand}
              prompt={actionPrompt}
            />

            <div className={styles.tableActions} aria-label="对局操作">
              <ControlPanel
                seat={seat}
                humanSeat={g.engineManager.isHumanSeat(humanSeat) ? humanSeat : -1}
                phase={game.phase}
                highestBid={game.highestBid}
                bidOptions={g.bidOptions}
                kittySize={game.kitty.length}
                selected={g.selected}
                humanHand={g.humanHand}
                selectedPlayCard={g.selectedPlayCard}
                trick={game.trick}
                result={game.result}
                confirmBeforePlay={g.confirmBeforePlay}
                doBid={g.doBid}
                doTrump={g.doTrump}
                doBury={g.doBury}
                autoSelectBury={g.autoSelectBury}
                clearSelectedBury={g.clearSelectedBury}
                confirmPlayCard={g.confirmPlayCard}
                goNextHand={g.goNextHand}
                restart={g.restart}
              />
            </div>

            <div className={styles.playerArea}>
              <div className={`${styles.southSeat} ${myTurn ? styles.turn : ''}`}>
                <div className={styles.avatarFrame} aria-hidden="true">{SEAT_NAMES[humanSeat]}</div>
                <div className={styles.seatName}>{SEAT_NAMES[humanSeat]}（{g.engineManager.isHumanSeat(humanSeat) ? '人工' : '观战'}）</div>
                <span className={styles.seatMeta}>{sideOf(humanSeat) === 0 ? '东西队' : '南北队'} · {g.humanHand.length} 张</span>
                <span className={styles.southCompactMeta}>{g.humanHand.length}张 {seatPoints(humanSeat)}分</span>
                {revealedSeat === humanSeat && <span className={styles.bidNote}>明牌 · 所有人可见</span>}
                {game.declarer !== null && (
                  <span className={styles.seatMeta}>
                    {game.declarer === humanSeat ? '庄家' : sideOf(humanSeat) === sideOf(game.declarer) ? '庄家搭档' : '闲家'} · 吃分 {seatPoints(humanSeat)}
                  </span>
                )}
                {game.phase === 'bidding' && humanBid !== undefined && (
                  <span className={styles.bidNote}>{humanBid === null ? '不叫' : `叫 ${humanBid} 分`}</span>
                )}
              </div>
              <div className={styles.handsArea}>
                <HumanHand
                  cards={g.humanHand}
                  phase={game.phase}
                  humanTurn={g.humanTurn}
                  legalIds={g.humanLegal}
                  selected={g.selected}
                  selectedPlayCard={g.selectedPlayCard}
                  trump={game.trump}
                  kittyIds={g.humanKittyIds}
                  ledSuit={game.trick.length > 0 ? game.trick[0].card.suit : null}
                  confirmBeforePlay={g.confirmBeforePlay}
                  onCardClick={g.onCardClick}
                />
              </div>
            </div>
          </main>

          <aside className={styles.toolbar} aria-label="对局工具栏">
            <span className={styles.tableCaption}>四人搭档 · 一副好牌，一桌老友</span>
            <GameTools
              phase={game.phase}
              completedTricks={game.completedTricks.length}
              speed={g.speed}
              confirmBeforePlay={g.confirmPreference}
              isConfirmForced={g.isDebugMode && !g.confirmPreference}
              onToggleConfirmBeforePlay={() => g.setConfirmBeforePlay(!g.confirmPreference)}
              onSpeedChange={g.setSpeed}
              onOpenRules={() => g.setShowRulesModal(true)}
              onOpenLedger={() => g.setShowPointsLedger(true)}
              onOpenLastTrick={() => g.setShowLastTrickModal(true)}
              onOpenHistory={() => g.setShowHistoryModal(true)}
              onOpenSettings={() => openSettings('player')}
            />
          </aside>
        </div>
      )}

      {g.saveState.status === 'error' && <p role="alert">{g.saveState.error}</p>}
      {showSavedHistory && <GameHistoryModal onClose={() => setShowSavedHistory(false)} onResume={g.resumeHistory} />}
      {pendingHistoryExport && <div className="modal-backdrop"><section className="modal-box" role="dialog" aria-label="待保存历史导出" style={{padding:20}}><h2>待保存记录</h2><p>保留完整对局与原始错误日志，可复制保存后排查。</p><textarea readOnly aria-label="待保存历史 JSON" value={pendingHistoryExport} style={{width:'100%',height:240}}/><button className="ghost-btn" onClick={() => setPendingHistoryExport('')}>关闭导出</button></section></div>}
      {g.toast && <div role={g.toast.bad ? 'alert' : 'status'} className={`${styles.toast} ${g.toast.bad ? styles.bad : ''}`}>{g.toast.text}</div>}
      <GameLog history={game.history} />
      {g.kittyRevealed && <KittyRevealBanner kittyCards={g.kittyRevealed} onDismiss={g.dismissKittyRevealed} />}
      {g.showHistoryModal && <PlayHistoryModal game={game} humanSeat={humanSeat} onClose={() => g.setShowHistoryModal(false)} />}
      {g.showRulesModal && <RulesModal onClose={() => g.setShowRulesModal(false)} />}
      {g.showLastTrickModal && <LastTrickModal lastTrick={game.lastTrick} lastWinner={game.lastWinner} lastPoints={game.lastPoints} onClose={() => g.setShowLastTrickModal(false)} />}
      {g.showPointsLedger && <PointsTrackerModal game={game} humanSeat={humanSeat} onClose={() => g.setShowPointsLedger(false)} />}
      {g.showEngineSettings && (
        <EngineSettingsModal
          manager={g.engineManager}
          activeType={g.engineType}
          onSelectType={g.setEngineType}
          onClose={() => g.setShowEngineSettings(false)}
          onGodModeChange={g.setGodModeEnabled}
          isDebugMode={g.isDebugMode}
          onToggleDebugMode={() => g.setIsDebugMode(!g.isDebugMode)}
          godModeEnabled={g.godModeEnabled}
          isAllPeeked={g.isAllPeeked}
          onToggleAllPeek={g.toggleAllPeek}
          initialLayer={settingsLayer}
          onOpenDecisionLog={(recordId) => {
            g.setSelectedDecisionId(recordId);
            g.setShowDecisionLogModal(true);
          }}
        />
      )}
      {g.showDecisionLogModal && (
        <DecisionLogModal
          initialRecordId={g.selectedDecisionId}
          onClose={() => {
            g.setShowDecisionLogModal(false);
            g.setSelectedDecisionId(undefined);
          }}
        />
      )}
      {!g.isDebugMode && (game.phase === 'handEnd' || game.phase === 'matchEnd') && game.result && (
        <HandResultModal result={game.result} kitty={game.kitty} scores={game.scores} targetWins={game.targetWins} matchEnded={game.phase === 'matchEnd'} humanSeat={humanSeat} goNextHand={g.goNextHand} restart={g.restart} />
      )}
    </div>
  );
}
