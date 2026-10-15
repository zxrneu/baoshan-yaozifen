/** Node 脚本与实验转换配置（SRP）：入口以仓库根解析，Web 应用使用自身配置。 */
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  if (mode !== 'test' && mode !== 'browser-test') {
    Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  }
  return { ssr: { noExternal: [/^@yaozifen\//] } };
});
