/**
 * Worker 环境的最小类型声明。
 *
 * 项目同时编译 DOM 与 Worker 代码，为避免引入 @cloudflare/workers-types
 * 与 DOM lib 的全局冲突，这里只声明用到的 D1 与资产绑定接口。
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  results: T[];
  meta: {
    changes?: number;
    duration?: number;
    [key: string]: unknown;
  };
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}

/** Sites 静态资产绑定：非 API 路径由它返回站点静态文件。 */
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  /** 本实例绑定的 D1 数据库，由部署平台注入。 */
  DB: D1Database;
  /** 部署配置的所有者用户 ID；与可信身份头一致才放行数据路径。 */
  OWNER_USER_ID?: string;
  /** 静态资产绑定（生产部署提供；测试可省略）。 */
  ASSETS?: AssetFetcher;
}
