/**
 * 决策日志存储与导出（SRP：只负责决策日志采集、序列化与导出）。
 */
import type { SessionCommit } from '@yaozifen/protocol/session';
import { DecisionRecord } from './engineTypes';

export class DecisionLogger {
  private commits: SessionCommit[] = [];
  private records: DecisionRecord[] = [];
  private readonly maxRecords: number;
  private readonly listeners: Set<() => void> = new Set();

  constructor(maxRecords = 200) {
    this.maxRecords = maxRecords;
  }

  record(entry: Omit<DecisionRecord, 'id' | 'timestamp'>): DecisionRecord {
    const fullRecord: DecisionRecord = {
      ...entry,
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    this.records.push(fullRecord);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    this.notify();
    return fullRecord;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('DecisionLogger 监听回调异常:', err);
      }
    });
  }

  getRecords(): readonly DecisionRecord[] {
    return this.records;
  }

  invalidate(sessionId: string): void {
    this.records = this.records.map(record => record.context?.sessionId === sessionId && record.status === 'evaluated'
      ? { ...record, status: 'stale' as const } : record);
    this.notify();
  }

  recordCommit(commit: SessionCommit): void {
    this.commits = [...this.commits, commit].slice(-this.maxRecords);
    this.records = this.records.map(record => commit.requestId && record.context?.requestId === commit.requestId
      ? { ...record, status: 'applied' as const, appliedNodeId: commit.to.nodeId } : record);
    this.notify();
  }

  getCommits(): readonly SessionCommit[] { return this.commits; }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        total: this.records.length,
        records: this.records,
        commits: this.commits,
      },
      null,
      2,
    );
  }

  exportRecords(): string {
    return this.exportJson();
  }

  clear(): void {
    this.records = [];
    this.commits = [];
    this.notify();
  }
}

export const decisionLogger = new DecisionLogger();
