/** 牌桌与阶段操作分区；对局状态和规则仍由 useGame 编排。 */
import { revealedPartnerSeat, sideOf, SEAT_NAMES, type GameState } from './engine';
import { sortHand, type Card } from './cards';
import { decisionLogger } from './ai/engines/decisionLogger';
import { seatEngineLabel } from './ai/engines/engineLabels';
import type { DecisionRecord } from './ai/engines/engineTypes';
import { seatDecision } from './hooks/seatDecision';
import { presentationDelay } from './hooks/actionPresentation';
import ActionPresentation from './components/ActionPresentation';
import SpectatorControls from './components/SpectatorControls';
import SeatReasonModal from './components/SeatReasonModal';
import CardInspectModal from './components/CardInspectModal';
import { CardInspectionContext } from './components/cardInspection';
import { useGame, type GameController } from './hooks/useGame';
import { DecisionEngineManager } from './ai/engines';
import SquareTable from './components/SquareTable';
import DebugSidePanel from './components/DebugSidePanel';
import Scoreboard from './components/Scoreboard';
import HandScoreboard from './components/HandScoreboard';
import TrumpBadge from './components/TrumpBadge';
import AudioControls from './components/AudioControls';
import GameTools from './components/GameTools';
import OpponentSeat from './components/OpponentSeat';
import TrickArea from './components/TrickArea';
import HumanHand from './components/HumanHand';
import ControlPanel from './components/ControlPanel';
import GameLog from './components/GameLog';
import RulesModal from './components/RulesModal';
import TutorialModal from './components/TutorialModal';
import LastTrickModal from './components/LastTrickModal';
import PointsTrackerModal from './components/PointsTrackerModal';
import PlayHistoryModal from './components/PlayHistoryModal';
import HandResultModal from './components/HandResultModal';
import KittyRevealBanner from './components/KittyRevealBanner';
import EngineSettingsModal from './components/EngineSettingsModal';
import SeatEngineModal from './components/SeatEngineModal';
import GameHistoryModal from './components/GameHistoryModal';
import CurrentHandReplayModal from './components/CurrentHandReplayModal';
import DecisionLogModal from './components/DecisionLogModal';
import { useEffect, useState } from 'react';
import { useSkin } from './hooks/useSkin';
import SkinPicker from './components/SkinPicker';
import styles from './App.module.css';
import Modal from './components/Modal';
import LandscapeViewport from './components/LandscapeViewport';

function findLatestBid(bidding: GameState['bidding'], seat: number): number | null | undefined {
  for (let i = bidding.length - 1; i >= 0; i--) {
    if (bidding[i].seat === seat) return bidding[i].bid;
  }
  return undefined;
}

export default function App() {
  const g = useGame();
  const [practiceManager, setPracticeManager] = useState<DecisionEngineManager | null>(null);
  function startPractice() {
    g.pause();
    const source = g.engineManager;
    const manager = new DecisionEngineManager({ defaultType: source.getActiveType(), useServerDecision: source.isUseServerDecision(), llmOptions: source.getLlmOptions(), layaOptions: source.getLayaOptions() });
    manager.setProfiles(source.getProfiles());
    const routes = source.getSeatRoutes();
    if (routes) manager.restoreProfiles(source.getHistoryProfiles().flatMap(profile => source.getProfileVersion(profile.version) ?? []), routes);
    setPracticeManager(manager);
  }
  return practiceManager
    ? <PracticeGame manager={practiceManager} onExit={confirm => { g.syncPlayerPreferences(confirm); setPracticeManager(null); }}/>
    : <GameView g={g} onStartPractice={startPractice}/>;
}

function PracticeGame({ manager, onExit }: { manager: DecisionEngineManager; onExit: (confirmBeforePlay: boolean) => void }) {
  const g = useGame({ engineManager: manager, singleHand: true });
  return <GameView g={g} onExitPractice={() => { g.pause(); onExit(g.confirmPreference); }}/>;
}

/** 两类会话复用同一牌桌；原标准编排持续挂载，练习退出仅切回原控制器。 */
function GameView({ g, onStartPractice, onExitPractice }: { g: GameController; onStartPractice?: () => void; onExitPractice?: () => void }) {
  const [inspectCard, setInspectCard] = useState<Card | null>(null);
  const [engineSeat, setEngineSeat] = useState<number | null>(null);
  const openSeatEngine = (seat: number) => { g.pause(); setEngineSeat(seat); };
  const [inspectSeat, setInspectSeat] = useState<number | null>(null);
  const [inspectRecord, setInspectRecord] = useState<DecisionRecord | undefined>();
  const openSeatReason = (seat: number) => {
    setInspectRecord(seatDecision(seat, g.sessionCursor, decisionLogger.getRecords(), decisionLogger.getCommits()));
    g.pause(); setInspectSeat(seat);
  };
  const openCard = (card: Card) => { g.pause(); setInspectCard(card); };
  const [showSavedHistory, setShowSavedHistory] = useState(false);
  const [showCurrentReplay, setShowCurrentReplay] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [pendingHistoryExport, setPendingHistoryExport] = useState('');
  const [dismissedResult, setDismissedResult] = useState<GameState['result']>(null);
  const { skin, setSkin } = useSkin();
  const { seat, humanSeat } = g;
  const game = g.presentation?.game ?? g.game;
  const humanHand = sortHand(game.hands[humanSeat] ?? []);
  const actionOverlay = g.presentation ? <ActionPresentation key={`${g.sessionCursor.nodeId}:${g.presentation.index}`} action={{...g.presentation, duration: presentationDelay(g.presentation, g.speed)}} automatic={g.sessionMode === 'auto'} viewSeat={g.isDebugMode || g.isSpectating ? 1 : humanSeat} playerFacing={g.isDebugMode || g.isSpectating} onNext={g.isSpectating ? () => void g.stepNext() : g.advancePresentation} onPause={g.pause} /> : undefined;
  const humanBid = findLatestBid(game.bidding, humanSeat);
  const revealedSeat = revealedPartnerSeat(game);
  const showRevealedHand = revealedSeat !== null && revealedSeat !== humanSeat;

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
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.defaultPrevented || target?.isContentEditable || target?.closest('input, textarea, select, button, summary, a[href], dialog, [role=dialog], [role=button]') || document.querySelector('dialog[open]')) {
        return;
      } else if (g.showRulesModal || g.showLastTrickModal || g.showPointsLedger || g.showHistoryModal || g.showEngineSettings || g.showDecisionLogModal || g.kittyRevealed || showSavedHistory || showTutorial || pendingHistoryExport || inspectCard || inspectSeat !== null || engineSeat !== null) {
        return;
      } else if ((g.presentation || g.isSpectating) && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
        e.preventDefault(); if (g.isSpectating) void g.stepNext(); else g.advancePresentation();
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
  }, [g, showSavedHistory, showTutorial, pendingHistoryExport, inspectCard, inspectSeat, engineSeat]);

  const seatPoints = (s: number) =>
    game.completedTricks.filter((t) => t.winner === s).reduce((sum, t) => sum + t.points, 0);
  const revealedPosition = showRevealedHand
    ? revealedSeat === null ? 'multiple' : ['right', 'bottom', 'left', 'top'][(revealedSeat - humanSeat + 5) % 4]
    : undefined;
  const myTurn = g.humanTurn;
  const actor = myTurn ? '你' : `${SEAT_NAMES[seat]}家`;
  const actionPrompt = game.phase === 'bidding' ? `${myTurn ? '轮到' : '等待'}${actor}叫分`
    : game.phase === 'trump' ? `${myTurn ? '请' : '等待'}${actor}定主`
    : game.phase === 'bury' ? `${myTurn ? '请' : '等待'}${actor}扣底`
    : game.phase === 'handEnd' || game.phase === 'matchEnd' ? '本副已结束' : '';

  return (
    <CardInspectionContext.Provider value={{inspectOnly: g.isSpectating, inspect: openCard}}><LandscapeViewport><div className={`${styles.app} game-content`}>
      <div className={styles.header}>
        <Scoreboard game={game} humanSeat={g.isSpectating ? -1 : humanSeat} />
        <div className={styles.headerControls}>
          {onExitPractice ? <><span role="status" aria-label="练习模式">单副练习 · 打完本副即结束</span><button type="button" className="ghost-btn" onClick={onExitPractice}>退出练习</button></> : <button type="button" className="ghost-btn" onClick={onStartPractice}>单副练习</button>}
          <button type="button" className="ghost-btn" onClick={() => { g.pause(); setShowTutorial(true); }}>新手教学</button>
          <AudioControls soundMuted={g.soundMuted} speechEnabled={g.speechEnabled} speechAvailable={g.speechAvailable} onToggleSound={g.toggleSoundMute} onToggleSpeech={g.toggleSpeech} />
          <span role="status" aria-label="对局保存状态">{g.saveState.status === 'unsupported' ? '离线模式暂不支持历史' : g.saveState.status === 'saved' ? '已保存' : g.saveState.status === 'saving' ? `保存中 · ${g.saveState.pending}` : '未保存'}</span>
          {g.saveState.status === 'error' && <><button className="ghost-btn" onClick={() => void g.retrySave()}>重试保存</button><button className="ghost-btn" onClick={() => setPendingHistoryExport(g.exportPendingHistory())}>导出待保存记录</button></>}
          {!g.isSpectating && <button className="ghost-btn" onClick={g.startSpectating}>观看 AI 对局</button>}
          {!g.isSpectating && <button type="button" className={`ghost-btn ${g.isDebugMode ? styles.debugActive : ''}`} aria-pressed={g.isDebugMode} onClick={() => g.setIsDebugMode(!g.isDebugMode)}>{g.isDebugMode ? '退出 Debug' : '进入 Debug'}</button>}
          <button className="ghost-btn" onClick={() => setShowSavedHistory(true)}>对局历史</button>
          <SkinPicker skin={skin} onChange={setSkin} />
        </div>
      </div>
      {g.isDebugMode || g.isSpectating ? (
        <div className={`${styles.workspaceDebug} ${g.isSpectating ? styles.workspaceSpectator : ''}`}>
          <SquareTable
            actionOverlay={actionOverlay}
            interactive={!g.isSpectating}
            visibleHandSeats={g.isDebugMode ? g.devPeekSeats : undefined}
            onToggleHand={g.isDebugMode ? g.toggleDevPeek : undefined}
            activePresentation={g.presentation}
            pickedKitty={g.pickedKitty}
            seatEngineLabels={[0,1,2,3].map(s => seatEngineLabel(g.engineManager, s, true))}
            onInspectSeat={openSeatReason}
            onChangeSeatEngine={openSeatEngine}
            game={game}
            humanSeat={g.isSpectating ? -1 : humanSeat}
            seat={g.presentation?.seat ?? seat}
            isThinking={g.isThinking}
            hasReadyDecision={Boolean(g.pendingAiAction || g.aiHintAction)}
            decisionNotice={g.presentation ? null : g.decisionNotice}
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
            onExitPractice={onExitPractice}
            saveState={g.saveState}
            onReplay={() => setShowCurrentReplay(true)}
            restart={g.restart}
          />
          {g.isSpectating ? <SpectatorControls game={g} onExitPractice={onExitPractice} onReplay={() => setShowCurrentReplay(true)}/> : <DebugSidePanel
            visibleHandSeats={g.devPeekSeats}
            game={game}
            seat={seat}
            engineType={g.engineType}
            setEngineType={g.setEngineType}
            isStepMode={g.isStepMode}
            setIsStepMode={g.setIsStepMode}
            isThinking={g.isThinking}
            presentationTitle={g.presentation?.title}
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
          />}
        </div>
      ) : (
        <div className={styles.workspace}>
          <main className={`${styles.table} ${showRevealedHand ? styles.hasRevealedHand : ''}`} aria-label="对局牌桌" data-phase={game.phase} data-revealed-seat={showRevealedHand ? revealedSeat : undefined} data-revealed-position={revealedPosition}>
            {actionOverlay}
            <div className={styles.tableBrand} aria-hidden="true">保山幺子分<span>四人搭档 · 百分争先</span></div>
            <div className={styles.tableHud}>
              <span className={styles.actorStatus} role="status">{g.presentation ? g.presentation.title : seat < 0 ? '本副结束' : `${seat === humanSeat ? '轮到你' : SEAT_NAMES[seat] + '家行动'}${g.isThinking ? ' · 思考中' : ''}`}</span>
              <TrumpBadge trump={game.trump} />
              {game.phase === 'bidding' ? (
                <span className={styles.tableMeta}>
                  {game.highestBidder !== null ? `当前最高 ${SEAT_NAMES[game.highestBidder]} · ${game.highestBid} 分` : '起叫 70 分'}
                </span>
              ) : game.declarer !== null ? (
                <div className={styles.roundScores}>
                  <span>庄 {SEAT_NAMES[game.declarer]} · 叫 {game.highestBid} 分</span>
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
                revealedCards={revealedSeat === s ? game.hands[s] : undefined}
                trump={game.trump}
                points={seatPoints(s)}
                biddingNote={game.phase === 'bidding' ? findLatestBid(game.bidding, s) : undefined}
                isBiddingPhase={game.phase === 'bidding'}
                engineLabel={seatEngineLabel(g.engineManager, s, false)}
                onChangeEngine={() => openSeatEngine(s)}
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

            <div inert={Boolean(g.presentation)} className={styles.tableActions} aria-label="对局操作">
              {g.sessionMode === 'paused' && game.phase !== 'handEnd' && game.phase !== 'matchEnd' && (
                <div className={styles.pauseNotice} role="status">
                  <span>{g.saveState.status === 'error' ? '保存失败，恢复保存后可继续' : '对局已暂停'}</span>
                  <button type="button" className="primary-btn" disabled={g.saveState.status === 'error'} onClick={() => g.setIsStepMode(false)}>继续对局</button>
                </div>
              )}
              <ControlPanel
                onExitPractice={onExitPractice}
                seat={seat}
                humanSeat={g.engineManager.isHumanSeat(humanSeat) ? humanSeat : -1}
                phase={game.phase}
                highestBid={game.highestBid}
                bidOptions={g.bidOptions}
                kittySize={game.kitty.length}
                selected={g.selected}
                humanHand={humanHand}
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
                saveState={g.saveState}
                onReplay={() => setShowCurrentReplay(true)}
              />
            </div>

            <div inert={Boolean(g.presentation)} className={styles.playerArea}>
              <div className={`${styles.southSeat} ${myTurn ? styles.turn : ''}`}>
                <div className={styles.avatarFrame} aria-hidden="true">{SEAT_NAMES[humanSeat]}</div>
                <button type="button" className="ghost-btn" aria-label={`${SEAT_NAMES[humanSeat]}家当前引擎`} aria-haspopup="dialog" onClick={() => openSeatEngine(humanSeat)}>{seatEngineLabel(g.engineManager, humanSeat, false)}</button>
                <div className={styles.seatName}>{SEAT_NAMES[humanSeat]}（{g.engineManager.isHumanSeat(humanSeat) ? '人工' : '观战'}）</div>
                <span className={styles.seatMeta}>{sideOf(humanSeat) === 0 ? '东西队' : '南北队'} · {humanHand.length} 张</span>
                <span className={styles.southCompactMeta}>{humanHand.length}张 {seatPoints(humanSeat)}分</span>
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
                  cards={humanHand}
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
            <HandScoreboard game={game} humanSeat={humanSeat} />
            <span className={styles.tableCaption}>查看与设置</span>
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

      {engineSeat !== null && <SeatEngineModal manager={g.engineManager} seat={engineSeat} persistSelection={!onExitPractice} onClose={() => setEngineSeat(null)} />}
      {inspectCard && <CardInspectModal card={inspectCard} trump={game.trump} onClose={() => setInspectCard(null)} />}
      {inspectSeat !== null && <SeatReasonModal seat={inspectSeat} record={inspectRecord} onClose={() => setInspectSeat(null)} />}
      {g.saveState.status === 'error' && <p role="alert">{g.saveState.error}</p>}
      {showSavedHistory && <GameHistoryModal onClose={() => setShowSavedHistory(false)} onResume={g.resumeHistory} />}
      {showCurrentReplay && <CurrentHandReplayModal load={g.readCurrentHand} onClose={() => setShowCurrentReplay(false)}/>}
      {pendingHistoryExport && <Modal label="待保存历史导出" onClose={() => setPendingHistoryExport('')} className="modal-box history-export"><h2>待保存记录</h2><p>保留完整对局与原始错误日志，可复制保存后排查。</p><textarea readOnly aria-label="待保存历史 JSON" value={pendingHistoryExport} style={{width:'100%',height:240}}/><button className="ghost-btn" onClick={() => setPendingHistoryExport('')}>关闭导出</button></Modal>}
      {g.toast && <div role={g.toast.bad ? 'alert' : 'status'} className={`${styles.toast} ${g.toast.bad ? styles.bad : ''}`}>{g.toast.text}</div>}
      <GameLog history={game.history} actions={g.observedActions} />
      {g.kittyRevealed && <KittyRevealBanner kittyCards={g.kittyRevealed} onDismiss={g.dismissKittyRevealed} />}
      {g.showHistoryModal && <PlayHistoryModal game={game} humanSeat={humanSeat} onClose={() => g.setShowHistoryModal(false)} />}
      {g.showRulesModal && <RulesModal onClose={() => g.setShowRulesModal(false)} />}
      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}
      {g.showLastTrickModal && <LastTrickModal lastTrick={game.lastTrick} lastWinner={game.lastWinner} lastPoints={game.lastPoints} onClose={() => g.setShowLastTrickModal(false)} />}
      {g.showPointsLedger && <PointsTrackerModal game={game} humanSeat={humanSeat} onClose={() => g.setShowPointsLedger(false)} />}
      {g.showEngineSettings && (
        <EngineSettingsModal
          persistSelection={!onExitPractice}
          manager={g.engineManager}
          activeType={g.engineType}
          onSelectType={g.setEngineType}
          onClose={() => g.setShowEngineSettings(false)}
          isDebugMode={g.isDebugMode}
          onToggleDebugMode={() => g.setIsDebugMode(!g.isDebugMode)}
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
      {!showCurrentReplay && !g.presentation && !g.isDebugMode && (game.phase === 'handEnd' || game.phase === 'matchEnd') && game.result && dismissedResult !== game.result && (
        <HandResultModal result={game.result} kitty={game.kitty} scores={game.scores} targetWins={game.targetWins} matchEnded={game.phase === 'matchEnd'} humanSeat={humanSeat} goNextHand={g.goNextHand} restart={g.restart} saveState={g.saveState} onReplay={() => setShowCurrentReplay(true)} onExitPractice={onExitPractice} onClose={() => setDismissedResult(game.result)} />
      )}
    </div></LandscapeViewport></CardInspectionContext.Provider>
  );
}
