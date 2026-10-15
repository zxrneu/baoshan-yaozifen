/** 复盘样本（SRP）：真实规则完整走过四阶段、提前结算与跨副。 */
import { cardPoints } from '@yaozifen/game-core/cards';
import { createGame, currentSeat, legalMoves } from '@yaozifen/game-core';
import { GameSession, type SessionCommand } from '@yaozifen/match-runtime/session';
import { HistoryRecorder } from '@yaozifen/history-core/autosave';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import { historyDetail } from '@yaozifen/server/history/http';
export async function replayFixture(amount = 70, targetWins = 5) {
  const repo = new SqliteHistoryRepository({ path:':memory:' }); const session = new GameSession(createGame(731, { targetWins }));
  const recorder = new HistoryRecorder(session, { write:async packet => repo.writeHistory(packet), configuration:() => ({ profiles:[], seats:[] }) });
  const states = [session.getSnapshot().game];
  while (!['handEnd','matchEnd'].includes(session.getSnapshot().game.phase)) {
    const state = session.getSnapshot().game; const seat = currentSeat(state); let command: SessionCommand;
    switch (state.phase) {
      case 'bidding': command = { kind:'bid', seat, bid:state.bidding.length === 0 ? amount : null }; break;
      case 'trump': command = { kind:'trump', seat, trump:'S' }; break;
      case 'bury': command = { kind:'bury', seat, cards:state.hands[seat].filter(card => cardPoints(card) === 0).slice(0,4) }; break;
      case 'playing': command = { kind:'play', seat, card:legalMoves(state,seat)[0] }; break;
      default: throw new Error('样本阶段错误');
    }
    session.commit(command, session.getSnapshot().cursor); states.push(session.getSnapshot().game);
  }
  if(session.getSnapshot().game.phase==='handEnd') { session.commit({ kind:'nextHand' }, session.getSnapshot().cursor); states.push(session.getSnapshot().game); }
  await recorder.flush(); const hand = repo.listHands(repo.listMatches()[0].matchId)[0];
  recorder.dispose();
  return { repo, detail:historyDetail(repo, hand.handId), states };
}
