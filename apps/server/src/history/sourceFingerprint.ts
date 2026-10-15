/** 模拟源码指纹（SRP）：包含未提交实现，避免跨重启拼接不同规则/策略版本。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repositoryRoot } from '../paths';
import { contentDigest } from '@yaozifen/protocol/json';
export function simulationSourceHash(): string {
    const root = repositoryRoot;
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
    for (const area of ['apps', 'packages']) {
        for (const name of readdirSync(join(root, area)).sort()) {
            const workspace = join(root, area, name);
            if (!statSync(workspace).isDirectory()) continue;
            visit(join(workspace, 'src'));
            for (const config of ['package.json', 'tsconfig.json'])
                files.push({ path: relative(root, join(workspace, config)), content: readFileSync(join(workspace, config), 'utf8') });
        }
    }
    for (const name of ['package.json', 'pnpm-lock.yaml'])
        files.push({ path: name, content: readFileSync(join(root, name), 'utf8') });
    return contentDigest(files);
}
