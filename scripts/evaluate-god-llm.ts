/** Live integration assessment, using the same session/agent path as God mode. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGame, bid, declareTrump, bury } from '../src/engine';
import { smartBury } from '../src/ai/smart';
import { GameSession } from '../src/workbench/session';
import { exportSnapshot, importSnapshot } from '../src/workbench/snapshot';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { ThinkingService } from '../src/ai/engines/thinkingService';

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const index = args.indexOf('--' + name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}
const url = option('url', 'http://127.0.0.1:5173/api/decision');
const resume = args.includes('--resume') ? option('resume', '') : null;
const responseFormat = option('format', 'json_object') as 'json_object' | 'json_schema' | 'text';
if (!['json_object', 'json_schema', 'text'].includes(responseFormat)) throw new Error('Invalid response format');
const seed = Number(option('seed', '101'));
const timeoutMs = Number(option('timeout', '60000'));
const reasoningEffort = option('reasoning', 'default') as 'default' | 'none' | 'low' | 'medium' | 'high';
if (!['default', 'none', 'low', 'medium', 'high'].includes(reasoningEffort)) throw new Error('Invalid reasoning effort');
const probePhase = args.includes('--probe-phase') ? option('probe-phase', 'bidding') : null;
if (probePhase && !['bidding', 'trump', 'bury', 'playing'].includes(probePhase)) throw new Error('Invalid probe phase');
const maxActions = Number(option('max-actions', probePhase ? '1' : '100'));
const openingBid = args.includes('--opening-bid') ? Number(option('opening-bid', '70')) : null;
const output = option('output', '/private/tmp/god-llm-v1-assessment.json');
if (![seed, timeoutMs, maxActions].every(Number.isSafeInteger) || seed < 0 || timeoutMs < 1000 || timeoutMs > 120000 || maxActions < 1 || maxActions > 1000) throw new Error('Invalid evaluation options');
const logger = new DecisionLogger(1000);
const thinking = new ThinkingService();
let initial = createGame(seed, { targetWins: 1 });
if (probePhase && probePhase !== 'bidding') {
  for (const seat of [1, 2, 3, 0]) initial = bid(initial, seat, seat === 1 ? 70 : null);
  if (probePhase !== 'trump') initial = declareTrump(initial, 1, 'S');
  if (probePhase === 'playing') initial = bury(initial, 1, smartBury(initial, 1));
}
const resumeData = resume ? JSON.parse(await fs.readFile(resume, 'utf8')) : null;
const imported = resumeData ? importSnapshot(JSON.stringify(resumeData.snapshot ?? resumeData)) : null;
const session = new GameSession(imported?.state ?? initial);
if (imported?.replay) session.restore(imported.replay.initialState, imported.replay.commands);
session.onInvalidate = () => { logger.invalidate(session.getSnapshot().cursor.sessionId); thinking.clear(); };
session.onCommit = commit => logger.recordCommit(commit);
const agent = new EnginePlayerAgent({
  engine: new RemoteDecisionEngine({ baseUrl: url, targetEngineType: 'llm', timeoutMs: timeoutMs + 5000,
    decisionOptions: { timeoutMs, protocol: 'chat', reasoningEffort, responseFormat } }),
  logger, thinkingService: thinking, getGodModeState: () => ({ enabled: true, peekedSeats: [0, 1, 2, 3] }),
});
const started = Date.now();
if (openingBid !== null && !probePhase && !resume) session.commit({ kind: 'bid', seat: 1, bid: openingBid }, session.getSnapshot().cursor, 'manual');
let failure: string | undefined;
const deadline = setTimeout(() => { failure = 'Run exceeded 12 minutes'; session.cancelRequests(); }, 12 * 60 * 1000);
try {
  for (let step = 0; step < maxActions && session.getSnapshot().game.phase !== 'matchEnd' && !failure; step++) {
    if (!await session.step(agent)) { if (!failure) failure = 'No action committed'; break; }
    const record = logger.getRecords().at(-1)!;
    console.log(JSON.stringify({ step: step + 1, phase: record.phase, seat: record.seat,
      requested: record.requestedEngine, actual: record.engineType, model: record.modelName ?? null,
      latencyMs: Math.round(record.latencyMs), fallback: record.fallbackReason ?? null, action: record.action }));
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally { clearTimeout(deadline); session.cancelRequests(); }
const final = session.getSnapshot().game;
const snapshot = exportSnapshot(final, { activeEngine: 'llm' }, session.getReplay());
const restored = importSnapshot(snapshot);
const records = logger.getRecords();
const modelResponses = records.filter(record => record.engineType === 'llm' && record.rawResponse && !record.fallbackReason);
const fallbackRecords = records.filter(record => record.fallbackReason);
const summary = {
  seed: final.seed, timeoutMs, openingBid, reasoningEffort, responseFormat, probePhase, resume, elapsedMs: Date.now() - started, phase: final.phase, result: final.result,
  actions: logger.getCommits().length, phases: [...new Set(records.map(record => record.phase))],
  modelResponses: modelResponses.length, fallbackActions: fallbackRecords.length,
  deterministicActions: records.filter(record => !record.modelName && !record.fallbackReason).length,
  modelLatencyMs: modelResponses.map(record => record.latencyMs),
  fallbackReasons: [...new Set(fallbackRecords.map(record => record.fallbackReason))],
  snapshotReplayVerified: JSON.stringify(restored.state) === JSON.stringify(final),
  failure: failure ?? (!probePhase && final.phase !== 'matchEnd' ? 'Action limit reached' : null),
  assessment: 'Integration and legality only; one hand does not establish playing strength.',
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ summary, snapshot: JSON.parse(snapshot), logs: JSON.parse(logger.exportJson()) }, null, 2));
console.log('ASSESSMENT ' + JSON.stringify(summary));
console.log('Saved ' + output);
if (summary.failure || modelResponses.length === 0) process.exitCode = 1;
