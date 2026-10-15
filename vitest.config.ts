/** 常规测试组合根（SRP）：集中发现跨包测试，不加载玩家环境或实验套件。 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: { environment: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/browser/**"] },
});
