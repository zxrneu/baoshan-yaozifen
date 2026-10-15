/** Node 生产构建（SRP）：打包工作区 TS，Node 内置模块和第三方 SDK 保持外部依赖。 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  build: { ssr: "src/proxy.ts", outDir: "dist", target: "node22", emptyOutDir: true },
  ssr: { noExternal: [/^@yaozifen\//] },
});
