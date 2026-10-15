/** 配置与诊断采集隔离（SRP）：缓存上限不截断数据库，真实回退与请求配置分开追溯。 */
import { describe, expect, it } from 'vitest';
import { DecisionEngineManager, DecisionLogger } from '@yaozifen/ai-core/engines/index';
import { captureConfiguration, captureEvaluation } from '@yaozifen/history-core/capture';
import { GameSession } from '@yaozifen/match-runtime/session';
import { HistoryRecorder } from '@yaozifen/history-core/autosave';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import { createGame, currentSeat } from '@yaozifen/game-core';
import { observeDecision, inputVisibility } from '@yaozifen/game-view/decisionObservation';
import { historyPlayingState } from './fixtures/history';

function manager() { return new DecisionEngineManager({defaultType:'llm',useServerDecision:false,llmOptions:{model:'private-model',apiKey:'sk-private-secret',baseUrl:'http://private.test/v1'}}); }
describe('历史诊断与信息边界',()=>{
  it('记录请求配置和 Bridge 回退配置的独立版本，密钥与服务地址不入快照',()=>{
    const configuration=captureConfiguration(manager(),false);
    expect(configuration.profiles.map(profile=>profile.type)).toEqual(['llm','bridge']);
    expect(configuration.profiles[0].parameters).toMatchObject({options:{model:'private-model',promptVersion:'2.0.0'}});
    expect(JSON.stringify(configuration)).not.toContain('sk-private-secret'); expect(JSON.stringify(configuration)).not.toContain('http://private.test');
    expect(configuration.seats[1].kind).toBe('human');
  });
  it('100 分成功扣底后的观察同步公开手牌，原始请求中的全局状态和凭据不会随诊断落库',()=>{
    const state=historyPlayingState(100); const seat=currentSeat(state); const logger=new DecisionLogger();
    const record=logger.record({seat,engineType:'bridge',roundNumber:1,trickNumber:1,ownHand:state.hands[seat],currentRound:[],candidates:state.hands[seat],latencyMs:0,action:{kind:'play',seat,card:state.hands[seat][0]},context:{sessionId:'s',nodeId:'n',epoch:0,configRevision:0,requestId:'r',purpose:'hint'},requestPayload:{state,apiKey:'sk-test-secret'},errorDetails:'http://private.test Bearer secret'});
    const evaluation=captureEvaluation(record,state)!;
    expect(evaluation.observation).toMatchObject({revealedHand:{seat:(state.declarer!+2)%4,cards:state.hands[(state.declarer!+2)%4]}});
    expect(JSON.stringify(evaluation)).not.toMatch(/sk-test-secret|http:\/\/private|Bearer secret|"seed"|"hands"/);
  });
  it('实时日志超过 200 条后，SQLite 仍保存全部评估且未采用建议不进入动作链',async()=>{
    const repo=new SqliteHistoryRepository({path:':memory:'});const session=new GameSession(createGame(731));const logger=new DecisionLogger(200);const engineManager=manager();
    const save=new HistoryRecorder(session,{write:async packet=>{repo.writeHistory(packet);},configuration:()=>captureConfiguration(engineManager,false)});
    const {game,cursor}=session.getSnapshot();const seat=currentSeat(game);
    const unsubscribe=logger.subscribe(()=>{const record=logger.getRecords().at(-1)!; const captured=captureEvaluation(record,game); if(captured) save.recordEvaluation(cursor.nodeId,captured);});
    for(let index=0;index<205;index++)logger.record({seat,engineType:'bridge',roundNumber:1,trickNumber:1,ownHand:game.hands[seat],currentRound:[],candidates:[],latencyMs:0,action:{kind:'bid',seat,bid:70},inputVisibility:inputVisibility(observeDecision(game,seat)),context:{...cursor,requestId:`r${index}`,purpose:'hint'}});
    await save.flush();expect(logger.getRecords()).toHaveLength(200);
    const hand=repo.listHands(repo.listMatches()[0].matchId)[0];const branch=repo.listBranches(hand.handId)[0];
    expect(repo.listEvaluations(`root:${branch.branchId}`)).toHaveLength(205);expect(repo.listActionNodes(branch.branchId)).toHaveLength(0);
    unsubscribe();save.dispose();repo.close();
  },15000);
});
