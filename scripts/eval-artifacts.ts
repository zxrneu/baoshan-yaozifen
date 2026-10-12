import fs from 'node:fs';
import path from 'node:path';
import { contentHash } from '../src/ai/eval/fingerprint';
import { BenchmarkRunner } from '../src/ai/eval/benchmarkRunner';
import { BenchmarkReportSummary } from '../src/ai/eval/types';

/** 包括未提交源码，避免 Git HEAD 相同却复用不同实现的成绩。 */
export async function evaluationSourceHash(): Promise<string> {
  const files: Array<{ path: string; content: string }> = [];
  function visit(dir: string) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) visit(file);
      else if (/\.(ts|tsx)$/.test(name)) files.push({ path: file, content: fs.readFileSync(file, 'utf-8') });
    }
  }
  visit('src');
  visit('scripts');
  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    if (fs.existsSync(file)) files.push({ path: file, content: fs.readFileSync(file, 'utf-8') });
  }
  return contentHash(files);
}

export async function saveEvaluationRun(runner: BenchmarkRunner, summary: BenchmarkReportSummary, outDir: string) {
  const runDir = path.join(outDir, summary.runId);
  await fs.promises.mkdir(runDir, { recursive: true });
  const files = runner.generateReportFiles(summary);
  await Promise.all([
    fs.promises.writeFile(path.join(runDir, 'report.md'), files.reportMd, 'utf-8'),
    fs.promises.writeFile(path.join(runDir, 'summary.json'), files.summaryJson, 'utf-8'),
    fs.promises.writeFile(path.join(runDir, 'decisions.ndjson'), files.decisionsNdjson, 'utf-8'),
    fs.promises.writeFile(path.join(runDir, 'manifest.json'), files.manifestJson, 'utf-8'),
  ]);
}

export async function archiveCurrentReports(outDir: string, names: string[]) {
  const existing = names.filter(name => fs.existsSync(path.join(outDir, name)));
  if (!existing.length) return;
  const dir = path.join(outDir, `history-${Date.now()}`);
  await fs.promises.mkdir(dir, { recursive: true });
  for (const name of existing) await fs.promises.writeFile(path.join(dir, name), fs.readFileSync(path.join(outDir, name), 'utf-8'), 'utf-8');
}
