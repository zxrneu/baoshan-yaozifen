/**
 * 决策日志存储与导出（SRP：只负责决策日志采集、序列化与导出）。
 */
import { DecisionRecord } from './engineTypes';

export class DecisionLogger {
  private records: DecisionRecord[] = [];
  private readonly maxRecords: number;

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
    return fullRecord;
  }

  getRecords(): readonly DecisionRecord[] {
    return this.records;
  }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        total: this.records.length,
        records: this.records,
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
  }
}

export const decisionLogger = new DecisionLogger();
