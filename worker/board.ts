/**
 * 看板数据逻辑：全部直接操作传入的 D1 绑定，不读取环境变量。
 *
 * 命令的业务规则复用 src/data/commands.ts 的共享校验与执行，
 * 备份编解码复用 src/data/backup.ts，偏好校验复用 src/data/preferences.ts。
 * 本模块只负责：按版本条件的 D1 写入、按范围的偏好保存、
 * 一致快照导出，以及以守卫触发器保证的原子整包导入。
 */

import {
  dispatchCreateJobCommand,
  dispatchJobCommand,
  validateJobCommand,
  commandValidationFailure,
} from '../src/data/commands.ts';
import { encodeBackup, decodeBackup } from '../src/data/backup.ts';
import {
  defaultBoardPreferences,
  PREFERENCE_SCOPES,
  type BoardPreferences,
  type JobCommand,
  type PreferencesPatch,
  type CommandOutcome,
} from '../src/data/contract.ts';
import { validatePreferences, validatePreferencesPatch } from '../src/data/preferences.ts';
import type { Job } from '../src/domain/index.ts';

/** 测试专用故障注入：生产入口从不构造本对象。 */
export interface BoardFaults {
  /** 让整包导入批次在岗位写入之后、偏好写入之前执行失败。 */
  importMidwayFailure?: boolean;
}

interface JobRow {
  id: string;
  version: string;
  data: string;
}

interface PreferenceRow {
  scope: string;
  data: string;
}

function serializeJob(job: Job): string {
  return JSON.stringify({
    id: job.id,
    profile: job.profile,
    starred: job.starred,
    flow: job.flow,
    outcome: job.outcome,
  });
}

function deserializeJob(row: JobRow): Job {
  const parsed = JSON.parse(row.data) as Omit<Job, 'version'>;
  return { ...parsed, version: Number(row.version) };
}

/** 全部岗位（含已结束），按插入顺序返回；全新实例返回零条。 */
export async function listJobs(db: D1Database): Promise<Job[]> {
  const result = await db
    .prepare('SELECT id, version, data FROM jobs ORDER BY rowid')
    .all<JobRow>();
  return result.results.map(deserializeJob);
}

/** 按 ID 读取单条岗位；不存在返回 null（仍算读取成功）。 */
export async function getJob(db: D1Database, jobId: string): Promise<Job | null> {
  const row = await db
    .prepare('SELECT id, version, data FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<JobRow>();
  return row ? deserializeJob(row) : null;
}

/**
 * 提交一条岗位命令：结构校验后按版本条件执行领域动作，
 * 以 `UPDATE … WHERE id = ? AND version = ?` 原子提交并递增版本。
 * 只有条件更新命中一行才算确认成功；读改写之间被并发写入时返回版本冲突。
 * 全新岗位按稳定 ID 插入且禁止覆盖同 ID 记录，重送同一命令不会追加第二条。
 */
export async function submitJobCommand(
  db: D1Database,
  command: JobCommand,
): Promise<CommandOutcome> {
  const validationIssue = validateJobCommand(command);
  if (validationIssue) {
    return { status: 'rejected', failure: commandValidationFailure(validationIssue) };
  }

  if (command.kind === 'create-job') {
    const created = dispatchCreateJobCommand(command);
    if (!created.ok) {
      return { status: 'rejected', failure: created.failure };
    }
    const insert = await db
      .prepare(
        'INSERT INTO jobs (id, version, data) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE id = ?)',
      )
      .bind(created.job.id, String(created.job.version), serializeJob(created.job), created.job.id)
      .run();
    if (insert.meta.changes !== 1) {
      // 同 ID 记录已存在：按契约报告版本冲突，不覆盖、不重复追加。
      return { status: 'rejected', failure: { reason: 'versionConflict' } };
    }
    return { status: 'confirmed', job: created.job };
  }

  const row = await db
    .prepare('SELECT id, version, data FROM jobs WHERE id = ?')
    .bind(command.jobId)
    .first<JobRow>();
  if (!row) {
    return {
      status: 'rejected',
      failure: { reason: 'invalidInput', message: '岗位不存在。' },
    };
  }
  const current = deserializeJob(row);
  const result = dispatchJobCommand(current, command);
  if (!result.ok) {
    return { status: 'rejected', failure: result.failure };
  }

  const update = await db
    .prepare('UPDATE jobs SET version = ?, data = ? WHERE id = ? AND version = ?')
    .bind(
      String(result.job.version),
      serializeJob(result.job),
      command.jobId,
      String(current.version),
    )
    .run();
  if (update.meta.changes !== 1) {
    return { status: 'rejected', failure: { reason: 'versionConflict' } };
  }
  return { status: 'confirmed', job: result.job };
}

/**
 * 组装完整偏好：已保存的范围用存储值，缺失范围用缺省值
 * （共用布局按默认顺序全显示，两端沿用共用布局）。
 */
function assemblePreferences(rows: PreferenceRow[]): BoardPreferences {
  const stored: Partial<Record<string, unknown>> = {};
  for (const row of rows) {
    try {
      stored[row.scope] = JSON.parse(row.data);
    } catch {
      // 损坏的存储值按缺省处理；validatePreferences 会拦截非法结构。
    }
  }
  const defaults = defaultBoardPreferences();
  const merged = {
    shared: stored.shared ?? defaults.shared,
    mobile: stored.mobile ?? defaults.mobile,
    desktop: stored.desktop ?? defaults.desktop,
  };
  const validated = validatePreferences(merged);
  if (!validated.ok) {
    throw new Error('已保存的偏好结构无效。');
  }
  return validated.preferences;
}

/** 读取完整偏好（共用与分端）；从未设置时返回缺省偏好而非失败。 */
export async function getPreferences(db: D1Database): Promise<BoardPreferences> {
  const result = await db
    .prepare('SELECT scope, data FROM preferences')
    .all<PreferenceRow>();
  return assemblePreferences(result.results);
}

/**
 * 按补丁写入偏好：只为提供的范围执行 UPSERT，其他范围保持不变，
 * 避免手机改布局覆盖桌面布局。一次 batch 内完成写入与回读。
 */
export async function savePreferencesPatch(
  db: D1Database,
  patch: PreferencesPatch,
): Promise<BoardPreferences> {
  const validation = validatePreferencesPatch(patch);
  if (!validation.ok) {
    throw new PreferenceValidationError(validation.issues.map((i) => `${i.path}：${i.message}`).join('；'));
  }

  const statements: D1PreparedStatement[] = [];
  for (const scope of PREFERENCE_SCOPES) {
    const value = patch[scope];
    if (value === undefined) {
      continue;
    }
    statements.push(
      db.prepare(
        'INSERT INTO preferences (scope, data) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET data = excluded.data',
      ).bind(scope, JSON.stringify(value)),
    );
  }
  statements.push(db.prepare('SELECT scope, data FROM preferences'));
  const results = await db.batch<PreferenceRow>(statements);
  return assemblePreferences(results[results.length - 1]!.results);
}

export class PreferenceValidationError extends Error {}

/** 在一个一致快照中读取全部岗位与偏好，编码为 v1 备份。 */
export async function exportSnapshot(db: D1Database) {
  const [jobRows, preferenceRows] = await db.batch<JobRow | PreferenceRow>([
    db.prepare('SELECT id, version, data FROM jobs ORDER BY rowid'),
    db.prepare('SELECT scope, data FROM preferences'),
  ]);
  const jobs = (jobRows!.results as JobRow[]).map(deserializeJob);
  const preferences = assemblePreferences(preferenceRows!.results as PreferenceRow[]);
  return encodeBackup(jobs, preferences);
}

export type ImportResult =
  | { ok: true }
  | { ok: false; reason: 'invalidBackup'; message: string }
  | { ok: false; reason: 'targetNotEmpty'; message: string }
  | { ok: false; reason: 'failed'; message: string };

/**
 * 向空看板原子恢复一份备份。
 *
 * 先整包校验（目标尚未写入），再在同一个 D1 batch 内完成：
 * 1. 插入 completed_imports 幂等标记 —— 该表的守卫触发器在目标已有
 *    任何岗位（含已结束记录）时 RAISE(ABORT) 中止整批，
 *    覆盖「校验期间另一端刚好新建岗位」的并发窗口；
 * 2. 按备份顺序插入全部岗位；
 * 3. 用备份整组替换偏好（恢复缺省的端覆盖）。
 * 任一语句失败均回滚整批，目标保持导入前的状态。
 */
export async function importBackup(
  db: D1Database,
  parsed: unknown,
  faults?: BoardFaults,
): Promise<ImportResult> {
  const decoded = decodeBackup(parsed);
  if (!decoded.ok) {
    const detail = decoded.issues.map((issue) => `${issue.path || '备份'}：${issue.message}`).join('；');
    return { ok: false, reason: 'invalidBackup', message: detail };
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT INTO completed_imports (id) VALUES (?)').bind(crypto.randomUUID()),
  ];
  for (const job of decoded.backup.applications) {
    statements.push(
      db
        .prepare('INSERT INTO jobs (id, version, data) VALUES (?, ?, ?)')
        .bind(job.id, String(job.version), serializeJob(job)),
    );
  }
  if (faults?.importMidwayFailure) {
    statements.push(db.prepare('INSERT INTO missing_table_for_fault VALUES (1)'));
  }
  for (const scope of PREFERENCE_SCOPES) {
    statements.push(
      db
        .prepare(
          'INSERT INTO preferences (scope, data) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET data = excluded.data',
        )
        .bind(scope, JSON.stringify(decoded.backup.preferences[scope])),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes('board_not_empty')) {
      return {
        ok: false,
        reason: 'targetNotEmpty',
        message: '目标看板已有岗位，导入被拒绝。',
      };
    }
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : '导入失败。',
    };
  }
  return { ok: true };
}
