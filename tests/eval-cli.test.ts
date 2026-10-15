/** 评测 CLI 回归：实际启动离线入口，验证参数选择与落盘报告身份一致。 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('评测命令行数据集参数', () => {
  it.each([
    ['等号写法', ['--dataset=holdout']],
    ['分隔写法', ['--dataset', 'holdout']],
    ['快捷开关', ['--holdout']],
  ])('%s：LLM 离线入口只运行保留集定主题并记录身份', async (_name, datasetArgs) => {
    const output = await mkdtemp(path.join(tmpdir(), 'yaozifen-eval-cli-'));
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [
          path.resolve('node_modules/vite-node/vite-node.mjs'), '--mode', 'test',
          'scripts/evaluate-llm-scenarios.ts', '--mock', ...datasetArgs,
          '--phase', 'trump', '--model', 'offline-cli-test',
          '--url', 'http://example.invalid/v1', '--api-key', 'test', '--output', output,
        ], { timeout: 20000 }, (error, _stdout, stderr) => {
          // 战术通过率不足会以 1 退出，但仍应生成可审计的报告；其他失败应明确暴露。
          if (error && error.code !== 1) reject(new Error(`${error.message}\n${stderr}`));
          else resolve();
        });
      });
      const [run] = await readdir(output);
      expect(run).toBeDefined();
      const summary = JSON.parse(await readFile(path.join(output, run, 'summary.json'), 'utf8'));
      const manifest = JSON.parse(await readFile(path.join(output, run, 'manifest.json'), 'utf8'));
      expect(summary.dataset).toBe('holdout');
      expect(manifest.dataset).toBe('holdout');
      expect(summary.totalScenarios).toBe(8);
      expect(summary.phaseSummaries.trump.total).toBe(8);
      expect(summary.phaseSummaries.playing.total).toBe(0);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }, 30000);
});
