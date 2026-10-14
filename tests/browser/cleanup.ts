/** 回归资源清理（SRP）：仅清理配置中本次生成的临时目录。 */
import { realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import type { FullConfig } from '@playwright/test';

export default function cleanup(config: FullConfig) {
  const directory: unknown = config.metadata.runDirectory;
  if (typeof directory !== 'string' || !basename(directory).startsWith('yaozifen-browser-')
    || realpathSync(dirname(directory)) !== realpathSync(tmpdir())) throw new Error('拒绝清理非回归临时目录');
  rmSync(directory, { recursive: true, force: true });
}
