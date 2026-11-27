/**
 * 稳定 ID 生成。
 *
 * 领域模块不绑定具体平台的随机源；调用方可以通过 IdFactory 注入确定性实现，
 * 测试与需要幂等 ID 的适配器（例如离线同步）都能复用。
 */

let sequence = 0;

/** 生成一个 ID。prefix 用于人读时区分用途，例如 `job`、`node`。 */
export type IdFactory = () => string;

/** 默认实现：时间戳、自增序号与随机后缀组合，不依赖 Node 或浏览器专有 API。 */
export function newId(prefix: string): string {
  sequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}_${random}`;
}
