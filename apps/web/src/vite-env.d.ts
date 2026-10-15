/**
 * Vite 环境变量类型声明。
 * 仅声明本项目实际读取的 VITE_* 变量，使 `import.meta.env` 取值具备类型且便于检索。
 * 参考 `vite/client` 的 ImportMetaEnv 契约，不覆盖其内置字段。
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发者上帝模式默认开关（构建期注入，'true' 时默认开启透视） */
  readonly VITE_ENABLE_GOD_MODE?: string;
  /** LLM 请求默认并发上限（正整数；缺省回退 2） */
  readonly VITE_LLM_MAX_CONCURRENCY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
