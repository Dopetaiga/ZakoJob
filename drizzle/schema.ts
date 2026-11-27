/**
 * 扎口Job 私有 Site 的 D1 表结构（drizzle-kit 生成迁移的来源）。
 *
 * 每份部署绑定自己的数据库，表只保存本实例所有者的数据：
 * - jobs：一条岗位一行，ID 为主键；领域资料与流程整体存进按版本定义的 JSON。
 * - preferences：开始页偏好，按 scope（shared/mobile/desktop）一行一条。
 * - completed_imports：整包导入的幂等标记，与导入写入共用同一批次。
 *
 * 首次访问不写任何初始化数据：由迁移建立结构，首次列表读取返回零条岗位。
 */

import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable('jobs', {
  /** 岗位稳定 ID，建档时由客户端生成，重送沿用同一 ID。 */
  id: text('id').primaryKey(),
  /** 乐观锁版本，条件更新时以它为守卫并递增。 */
  version: text('version').notNull(),
  /** 完整领域记录 JSON：profile、starred、flow、outcome（不含 version）。 */
  data: text('data').notNull(),
});

export const preferences = sqliteTable('preferences', {
  /** 偏好范围：shared、mobile、desktop。写一个范围不触碰其他范围。 */
  scope: text('scope').primaryKey(),
  /** 该范围的完整 JSON 值（shared 为布局，两端为覆盖对象）。 */
  data: text('data').notNull(),
});

export const completedImports = sqliteTable('completed_imports', {
  /** 导入批次的幂等标记。 */
  id: text('id').primaryKey(),
});
