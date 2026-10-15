/** 仓库位置（SRP）：源码与生产产物同层级定位，数据/环境不随启动目录漂移。 */
import { fileURLToPath } from "node:url";
export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
