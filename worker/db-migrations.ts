/**
 * D1 迁移语句（与 drizzle/ 下生成的 SQL 保持一致）。
 *
 * 生产部署由 Sites 托管按 drizzle/meta/_journal.json 应用 drizzle/*.sql；
 * 隔离测试 worker 在启动时用本模块自行应用同样的迁移，不需要 wrangler。
 * drizzle-kit 不支持触发器，0001 守卫触发器为手工维护的迁移文件。
 */

export interface BoardMigration {
  tag: string;
  statements: string[];
}

export const BOARD_MIGRATIONS: BoardMigration[] = [
  {
    tag: '0000_init',
    statements: [
      'CREATE TABLE `completed_imports` (\n\t`id` text PRIMARY KEY NOT NULL\n);',
      'CREATE TABLE `jobs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`version` text NOT NULL,\n\t`data` text NOT NULL\n);',
      'CREATE TABLE `preferences` (\n\t`scope` text PRIMARY KEY NOT NULL,\n\t`data` text NOT NULL\n);',
    ],
  },
  {
    tag: '0001_board_guard',
    statements: [
      [
        'CREATE TRIGGER `completed_imports_require_empty_board`',
        'BEFORE INSERT ON `completed_imports`',
        'WHEN (SELECT COUNT(*) FROM `jobs`) > 0',
        'BEGIN',
        "\tSELECT RAISE(ABORT, 'board_not_empty');",
        'END;',
      ].join('\n'),
    ],
  },
];

/** 在给定数据库上应用全部迁移（幂等：已建表时跳过）。 */
export async function applyBoardMigrations(db: D1Database): Promise<void> {
  const applied = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'completed_imports'")
    .first();
  if (applied) {
    return;
  }
  for (const migration of BOARD_MIGRATIONS) {
    await db.batch(migration.statements.map((statement) => db.prepare(statement)));
  }
}
