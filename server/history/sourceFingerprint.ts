/** 模拟源码指纹（SRP）：包含未提交实现，避免跨重启拼接不同规则/策略版本。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentDigest } from '../../src/history/json';
export function simulationSourceHash(): string {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files: Array<{
        path: string;
        content: string;
    }> = [];
    function visit(dir: string) { for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
            visit(path);
        else if (/\.(ts|tsx)$/.test(name))
            files.push({ path: relative(root, path), content: readFileSync(path, 'utf8') });
    } }
    for (const folder of ['src', 'server'])
        visit(join(root, folder));
    for (const name of ['package.json', 'pnpm-lock.yaml'])
        files.push({ path: name, content: readFileSync(join(root, name), 'utf8') });
    return contentDigest(files);
}
