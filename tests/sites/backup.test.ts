/**
 * persist-job-data 3.4：D1 的一致快照导出与原子整包导入。
 *
 * 验证：并发导出只能读到一份完整快照；守卫触发器让非空目标
 * （含已结束岗位）整体拒绝；批次中途故障无部分数据；
 * 校验失败可定位问题且目标原状。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importBackup } from '../../worker/board.ts';
import { createBoardInstance, createClient, fetchAs, type BoardInstance } from './helpers.ts';

let instance: BoardInstance;

test.before(async () => {
  instance = await createBoardInstance({ name: 'backup', ownerId: 'user-backup' });
});

test.after(async () => {
  await instance?.close();
});

test('空看板导出：空岗位集合与完整偏好', async () => {
  const client = await createClient(instance, instance.ownerId);

  const exported = await client.exportSnapshot();
  assert.ok(exported.ok);
  assert.deepEqual(exported.backup.applications, []);
  assert.ok(exported.backup.preferences.shared.modules.length > 0);
});

test('有数据后导出：一次一致快照包含全部岗位与偏好', async () => {
  const client = await createClient(instance, instance.ownerId);

  const created = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-snapshot',
    input: { company: '青禾', position: '前端工程师' },
  });
  assert.ok(created.status === 'confirmed');
  const version = created.status === 'confirmed' ? created.job.version : 1;

  await client.submitJobCommand({
    kind: 'log-step',
    jobId: 'job-snapshot',
    expectedVersion: version,
    nodeId: 'node-applied',
    step: { kind: 'applied' },
  });
  await client.savePreferences({
    shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
    mobile: { overridden: true, layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] } },
  });

  const exported = await client.exportSnapshot();
  assert.ok(exported.ok);
  assert.equal(exported.backup.applications.length, 1);
  assert.equal(exported.backup.applications[0]?.id, 'job-snapshot');
  assert.equal(exported.backup.applications[0]?.flow[0]?.id, 'node-applied');
  assert.ok(exported.backup.preferences.mobile.overridden === true);
  assert.ok(exported.backup.format === 'zakoujob-backup' && exported.backup.version === 1);
});

test('并发导出只能读到一份完整快照（多次导出互不撕裂）', async () => {
  const client = await createClient(instance, instance.ownerId);

  const snapshots = await Promise.all([
    client.exportSnapshot(),
    client.exportSnapshot(),
    client.exportSnapshot(),
  ]);
  for (const snapshot of snapshots) {
    assert.ok(snapshot.ok);
    assert.equal(snapshot.backup.applications.length, 1);
  }
  const first = snapshots[0];
  assert.ok(first.ok);
  for (const snapshot of snapshots.slice(1)) {
    assert.ok(snapshot.ok);
    assert.deepEqual(snapshot.backup, first.backup);
  }
});

test('非空目标（含已结束岗位）导入被拒绝，原数据保留', async () => {
  const client = await createClient(instance, instance.ownerId);

  // 目标已有岗位：先拒绝整次导入。
  const backup = await client.exportSnapshot();
  assert.ok(backup.ok);
  const rejected = await client.importBackup(backup.backup);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.status === 'rejected' && rejected.reason === 'targetNotEmpty');

  // 已结束岗位也算占用：登记结果后再次拒绝。
  const job = backup.backup.applications[0]!;
  const recorded = await client.submitJobCommand({
    kind: 'record-outcome',
    jobId: job.id,
    expectedVersion: job.version,
    status: 'declinedByUser',
  });
  assert.ok(recorded.status === 'confirmed');

  const rejectedAgain = await client.importBackup(backup.backup);
  assert.equal(rejectedAgain.status, 'rejected');
  assert.ok(rejectedAgain.status === 'rejected' && rejectedAgain.reason === 'targetNotEmpty');

  // 原数据保留。
  const read = await client.getJob(job.id);
  assert.ok(read.ok && read.value);
  assert.ok(read.value.outcome?.status === 'declinedByUser');
});

test('导入校验后另一端先建档，提交时守卫保留并发创建的岗位及原布局', async () => {
  const board = await createBoardInstance({ name: 'import-race', ownerId: 'local-owner' });
  try {
    const client = await createClient(board, board.ownerId);
    const original = await client.exportSnapshot();
    const source = await (await createClient(instance, instance.ownerId)).exportSnapshot();
    assert.ok(original.ok && source.ok && source.backup.applications.length > 0);
    const db = await board.mf.getD1Database('DB') as unknown as D1Database;
    // 在导入请求完成校验、SQL 批次尚未提交的瞬间，让另一个真实请求先提交。
    const beforeCommit: D1Database = {
      prepare: sql => db.prepare(sql),
      exec: sql => db.exec(sql),
      async batch<T>(statements: D1PreparedStatement[]) {
        const created = await client.submitJobCommand({
          kind: 'create-job', jobId: 'concurrent', input: { postingUrl: 'https://example.com/new' },
        });
        assert.equal(created.status, 'confirmed');
        return db.batch<T>(statements);
      },
    };
    const result = await importBackup(beforeCommit, source.backup);
    assert.ok(!result.ok && result.reason === 'targetNotEmpty');
    const after = await client.exportSnapshot();
    assert.ok(after.ok);
    assert.deepEqual(after.backup.applications.map(job => job.id), ['concurrent']);
    assert.deepEqual(after.backup.preferences, original.backup.preferences);
  } finally {
    await board.close();
  }
});

test('恢复期间从独立客户端导出的岗位和布局来自同一个快照', async () => {
  const board = await createBoardInstance({ name: 'export-during-import', ownerId: 'local-owner' });
  try {
    const writer = await createClient(board, board.ownerId);
    const reader = await createClient(board, board.ownerId);
    const before = await reader.exportSnapshot();
    const source = await (await createClient(instance, instance.ownerId)).exportSnapshot();
    assert.ok(before.ok && source.ok);
    const backup = { ...source.backup, preferences: {
      ...source.backup.preferences, shared: { modules: [
        { id: 'schedule', visible: false }, { id: 'jobs', visible: true },
      ] },
    } };
    const [early, restore, ...during] = await Promise.all([
      reader.exportSnapshot(), writer.importBackup(backup),
      ...Array.from({ length: 6 }, () => reader.exportSnapshot()),
    ] as const);
    assert.equal(restore.status, 'confirmed');
    for (const snapshot of [early, ...during]) {
      assert.ok(snapshot.ok);
      assert.deepEqual(snapshot.backup, snapshot.backup.applications.length ? backup : before.backup);
    }
    const after = await reader.exportSnapshot();
    assert.ok(after.ok);
    assert.deepEqual(after.backup, backup);
  } finally {
    await board.close();
  }
});

test('导入批次中途故障：无部分数据，目标保持导入前状态', async () => {
  // 使用独立实例避免污染其他用例数据。
  const isolated = await createBoardInstance({ name: 'backup-fault', ownerId: 'user-fault' });
  try {
    const client = await createClient(isolated, isolated.ownerId);

    // 目标预置偏好（应保持原状）。
    await client.savePreferences({
      shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
    });

    const flaky = fetchAs(isolated.baseUrl, isolated.ownerId);
    const response = await flaky(`${isolated.baseUrl}/api/board/backup/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zk-test-fault-import-midway': '1',
      },
      body: JSON.stringify({
        format: 'zakoujob-backup',
        version: 1,
        applications: [
          {
            id: 'job-midway',
            profile: { company: '中途', position: '失败' },
            starred: false,
            flow: [],
            outcome: null,
            version: 1,
          },
        ],
        preferences: {
          shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
          mobile: { overridden: false },
          desktop: { overridden: false },
        },
      }),
    });
    assert.equal(response.status, 500);

    // 岗位未写入，偏好保持原值。
    const jobs = await client.listJobs();
    assert.ok(jobs.ok && jobs.value.length === 0);
    const preferences = await client.getPreferences();
    assert.ok(preferences.ok);
    assert.deepEqual(preferences.value.shared.modules, [
      { id: 'schedule', visible: true },
      { id: 'jobs', visible: true },
    ]);
  } finally {
    await isolated.close();
  }
});

test('校验失败可定位问题记录，目标仍为空且偏好可读回', async () => {
  const isolated = await createBoardInstance({ name: 'backup-invalid', ownerId: 'user-invalid' });
  try {
    const client = await createClient(isolated, isolated.ownerId);

    await client.savePreferences({
      desktop: { overridden: true, layout: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] } },
    });

    const outcome = await client.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [
        {
          id: 'job-good',
          profile: { company: '合法', position: '工程师' },
          starred: false,
          flow: [],
          outcome: null,
          version: 1,
        },
        {
          id: 'job-bad',
          profile: { company: '坏数据', position: '工程师' },
          starred: false,
          flow: [
            { kind: 'interview', id: 'node-dup', round: '一面', status: 'pending' },
            { kind: 'interview', id: 'node-dup', round: '二面', status: 'pending' },
          ],
          outcome: { status: 'declinedByEmployer' },
          version: 1,
        },
      ],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'rejected');
    assert.ok(outcome.status === 'rejected' && outcome.reason === 'invalidBackup');
    const issue = outcome.issues.find((entry) => entry.path.includes('applications[1]'));
    assert.ok(issue, '问题应定位到第二条岗位记录');

    const jobs = await client.listJobs();
    assert.ok(jobs.ok && jobs.value.length === 0);
    const preferences = await client.getPreferences();
    assert.ok(preferences.ok && preferences.value.desktop.overridden === true);
  } finally {
    await isolated.close();
  }
});

test('无法识别的备份版本被明确拒绝', async () => {
  const isolated = await createBoardInstance({ name: 'backup-version', ownerId: 'user-version' });
  try {
    const client = await createClient(isolated, isolated.ownerId);
    const outcome = await client.importBackup({
      format: 'zakoujob-backup',
      version: 2,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'rejected');
    assert.ok(outcome.status === 'rejected' && outcome.reason === 'invalidBackup');
    assert.ok(outcome.issues.some((issue) => issue.path === 'version'));

    const jobs = await client.listJobs();
    assert.ok(jobs.ok && jobs.value.length === 0);
  } finally {
    await isolated.close();
  }
});

test('向空看板导入成功，重复导入命中非空检查', async () => {
  const isolated = await createBoardInstance({ name: 'backup-import', ownerId: 'user-import' });
  try {
    const client = await createClient(isolated, isolated.ownerId);
    const outcome = await client.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [
        {
          id: 'job-restored',
          profile: { postingUrl: 'https://jobs.example.com/restored' },
          starred: true,
          flow: [{ kind: 'interview', id: 'node-restored', round: '二面', status: 'pending' }],
          outcome: null,
          version: 3,
        },
      ],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: true, layout: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: false }] } },
        desktop: { overridden: false },
      },
    });
    assert.equal(outcome.status, 'confirmed');

    const read = await client.getJob('job-restored');
    assert.ok(read.ok && read.value);
    assert.equal(read.value.starred, true);
    assert.equal(read.value.flow[0]?.id, 'node-restored');
    const preferences = await client.getPreferences();
    assert.ok(preferences.ok && preferences.value.mobile.overridden === true);

    // 恢复有岗位的备份后重试：命中非空检查。
    const retry = await client.importBackup({
      format: 'zakoujob-backup',
      version: 1,
      applications: [],
      preferences: {
        shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
        mobile: { overridden: false },
        desktop: { overridden: false },
      },
    });
    assert.equal(retry.status, 'rejected');
    assert.ok(retry.status === 'rejected' && retry.reason === 'targetNotEmpty');
  } finally {
    await isolated.close();
  }
});
