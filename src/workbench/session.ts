import { GameState, currentSeat, nextHand } from '../engine';
import { AiAction, PlayerAgent, DecisionContext, isAsyncPlayerAgent } from '../ai/types';
import { applyAiAction } from '../ai/applyAction';
import { cloneGameState } from './snapshot';

export type SessionMode = 'paused' | 'step' | 'auto';
export interface SessionCursor {
  sessionId: string;
  nodeId: string;
  epoch: number;
  configRevision: number;
}
export interface PendingDecision {
  action: AiAction;
  context: DecisionContext;
}
export type SessionCommand = AiAction | { kind: 'nextHand' };
export interface SessionCommit {
  command: SessionCommand;
  source: 'human' | 'manual' | 'ai' | 'hint';
  from: SessionCursor;
  to: SessionCursor;
  requestId?: string;
  before: GameState;
  after: GameState;
}
interface HistoryEntry {
  id: string;
  game: GameState;
  command?: SessionCommand;
}
export interface SessionSnapshot {
  game: GameState;
  cursor: SessionCursor;
  mode: SessionMode;
  pending: PendingDecision | null;
  hint: PendingDecision | null;
  isThinking: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
let sessionSequence = 0;

/** 会话提交遵循单一职责：UI 与无界历史订阅共用同步合法动作边界。 */
export class GameSession {
  private entries: HistoryEntry[];
  private index = 0;
  private epoch = 0;
  private configRevision = 0;
  private sessionId = 'game-' + (++sessionSequence);
  private nodeSequence = 0;
  private requestSequence = 0;
  private mode: SessionMode = 'paused';
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private inFlight: { controller: AbortController; promise: Promise<PendingDecision | null> } | null = null;
  private stepping: Promise<boolean> | null = null;
  private pending: PendingDecision | null = null;
  private hint: PendingDecision | null = null;
  private commitListeners = new Set<(event: SessionCommit) => void>();
  subscribeCommits(listener: (event: SessionCommit) => void): () => void {
    this.commitListeners.add(listener); return () => { this.commitListeners.delete(listener); };
  }
  onCommit?: (event: SessionCommit) => void;
  onInvalidate?: () => void;

  constructor(initial: GameState) {
    this.entries = [{ id: this.newNodeId(), game: cloneGameState(initial) }];
    this.snapshot = this.makeSnapshot();
  }
  private newNodeId(): string { return this.sessionId + '-node-' + (++this.nodeSequence); }
  private cursor(): SessionCursor {
    return { sessionId: this.sessionId, nodeId: this.entries[this.index].id, epoch: this.epoch, configRevision: this.configRevision };
  }
  private makeSnapshot(): SessionSnapshot {
    return {
      game: this.entries[this.index].game, cursor: this.cursor(), mode: this.mode,
      pending: this.pending, hint: this.hint, isThinking: this.inFlight !== null,
      canUndo: this.index > 0, canRedo: this.index < this.entries.length - 1,
    };
  }
  private publish(): void {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach(listener => listener());
  }
  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  isCurrent(context: SessionCursor): boolean {
    const active = this.cursor();
    return context.sessionId === active.sessionId && context.nodeId === active.nodeId &&
      context.epoch === active.epoch && context.configRevision === active.configRevision;
  }
  private invalidate(): void {
    this.epoch++;
    this.inFlight?.controller.abort(new DOMException('局面或配置已改变', 'AbortError'));
    this.inFlight = null;
    this.stepping = null;
    this.pending = null;
    this.hint = null;
    this.onInvalidate?.();
  }
  setMode(mode: SessionMode): void {
    if (mode === this.mode && (mode !== 'paused' || (!this.inFlight && !this.pending && !this.hint))) return;
    this.invalidate();
    this.mode = mode;
    this.publish();
  }
  configurationChanged(): void {
    this.configRevision++;
    this.invalidate();
    this.publish();
  }
  cancelRequests(): void {
    this.invalidate();
    this.publish();
  }
  replace(initial: GameState): void {
    this.invalidate();
    this.sessionId = 'game-' + (++sessionSequence);
    this.nodeSequence = 0;
    this.entries = [{ id: this.newNodeId(), game: cloneGameState(initial) }];
    this.index = 0;
    this.mode = 'paused';
    this.publish();
  }
  undo(): boolean {
    this.invalidate();
    this.mode = 'paused';
    const changed = this.index > 0;
    if (changed) this.index--;
    this.publish();
    return changed;
  }
  redo(): boolean {
    this.invalidate();
    this.mode = 'paused';
    const changed = this.index < this.entries.length - 1;
    if (changed) this.index++;
    this.publish();
    return changed;
  }
  restore(initial: GameState, commands: SessionCommand[]): void {
    // Build completely before replacing the active session.
    const states = [cloneGameState(initial)];
    for (const command of commands) {
      const previous = states[states.length - 1];
      states.push(command.kind === 'nextHand' ? nextHand(previous) : applyAiAction(previous, command));
    }
    this.replace(initial);
    this.entries = states.map((game, index) => ({ id: this.newNodeId(), game, command: index ? commands[index - 1] : undefined }));
    this.index = this.entries.length - 1;
    this.publish();
  }
  rewind(): void {
    this.invalidate(); this.mode = 'paused'; this.index = 0; this.publish();
  }
  getRestartState(): GameState {
    for (let i = this.index; i >= 0; i--) {
      const state = this.entries[i].game;
      if (state.phase === 'bidding' && state.bidding.length === 0) return cloneGameState(state);
    }
    return cloneGameState(this.entries[0].game);
  }
  getReplay(): { initialState: GameState; commands: SessionCommand[] } {
    return {
      initialState: cloneGameState(this.entries[0].game),
      commands: this.entries.slice(1, this.index + 1).flatMap(entry => entry.command ? [entry.command] : []),
    };
  }
  commit(
    command: SessionCommand,
    expected: SessionCursor,
    source: SessionCommit['source'] = 'manual',
    decision?: PendingDecision,
  ): boolean {
    if (!this.isCurrent(expected) || (decision && !this.isCurrent(decision.context))) return false;
    const before = this.snapshot.game;
    if (command.kind === 'nextHand' && before.phase !== 'handEnd') return false;
    const after = command.kind === 'nextHand' ? nextHand(before) : applyAiAction(before, command);
    if (after === before) return false;
    const requestId = decision?.context.requestId;
    this.invalidate();
    if (source === 'manual' || source === 'human' || source === 'hint') this.mode = 'paused';
    this.entries = [...this.entries.slice(0, this.index + 1), { id: this.newNodeId(), game: after, command }];
    // Rebase replay on the retained checkpoint when a long match exceeds this bound.
    if (this.entries.length > 1000) this.entries = this.entries.slice(-1000);
    this.index = this.entries.length - 1;
    this.publish();
    const event = { command, source, from: expected, to: this.cursor(), requestId, before, after };
    this.commitListeners.forEach(listener => listener(event));
    this.onCommit?.(event);
    return true;
  }
  async evaluate(agent: PlayerAgent, purpose: DecisionContext['purpose']): Promise<PendingDecision | null> {
    const cached = this.pending ?? this.hint;
    if (cached && this.isCurrent(cached.context)) {
      if (purpose === 'hint') { this.hint = cached; this.publish(); }
      return cached;
    }
    if (currentSeat(this.snapshot.game) < 0) return null;
    if (this.inFlight) {
      const result = await this.inFlight.promise;
      if (result && purpose === 'hint' && this.isCurrent(result.context)) {
        this.hint = result; this.publish();
      }
      return result;
    }
    const controller = new AbortController();
    const game = cloneGameState(this.snapshot.game);
    const context: DecisionContext = {
      ...this.cursor(), requestId: this.sessionId + '-request-' + (++this.requestSequence), purpose,
    };
    const task = {
      controller,
      promise: Promise.resolve().then(async (): Promise<PendingDecision | null> => {
        try {
          const action = isAsyncPlayerAgent(agent)
            ? await agent.nextActionAsync(game, controller.signal, context)
            : agent.nextAction(game);
          if (!action || controller.signal.aborted || !this.isCurrent(context)) return null;
          if (action.seat !== currentSeat(game)) throw new Error('AI 返回了错误的行动座位');
          // Check the complete phase rules before presenting a suggestion.
          applyAiAction(game, action);
          const result = { action, context };
          if (purpose === 'hint') this.hint = result;
          else this.pending = result;
          return result;
        } catch (error) {
          if (controller.signal.aborted || !this.isCurrent(context)) return null;
          throw error;
        } finally {
          if (this.inFlight === task) { this.inFlight = null; this.publish(); }
        }
      }),
    };
    this.inFlight = task;
    this.publish();
    return task.promise;
  }
  step(agent: PlayerAgent): Promise<boolean> {
    if (this.stepping) return this.stepping;
    const expected = this.cursor();
    const promise = this.evaluate(agent, 'step').then(result =>
      result ? this.commit(result.action, expected, 'ai', result) : false,
    ).finally(() => { if (this.stepping === promise) this.stepping = null; });
    this.stepping = promise;
    return promise;
  }
}
