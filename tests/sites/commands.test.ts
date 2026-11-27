/**
 * persist-job-data 3.2：按岗位的业务动作 API、原子版本更新与分范围偏好。
 *
 * 两个独立客户端验证保存后重新读取可见；旧客户端基于旧版本的撤回
 * 被版本条件拒绝，二面与三面都保留。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardInstance, createClient, type BoardInstance } from './helpers.ts';

let instance: BoardInstance;

test.before(async () => {
  instance = await createBoardInstance({ name: 'commands', ownerId: 'user-commands' });
});

test.after(async () => {
  await instance?.close();
});

test('两个独立客户端：保存后重新读取可见', async () => {
  const phone = await createClient(instance, instance.ownerId);
  const desktop = await createClient(instance, instance.ownerId);

  const created = await phone.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-cross-device',
    input: { postingUrl: 'https://jobs.example.com/1' },
  });
  assert.equal(created.status, 'confirmed');

  // 第二个客户端主动重新读取。
  const read = await desktop.getJob('job-cross-device');
  assert.ok(read.ok && read.value);
  assert.equal(read.value.id, 'job-cross-device');
  assert.equal(read.value.version, 1);
});

test('按岗位登记二面后原子递增版本，另一客户端可见', async () => {
  const phone = await createClient(instance, instance.ownerId);
  const desktop = await createClient(instance, instance.ownerId);

  const logged = await phone.submitJobCommand({
    kind: 'log-step',
    jobId: 'job-cross-device',
    expectedVersion: 1,
    nodeId: 'node-interview-2nd',
    step: {
      kind: 'interview',
      round: '二面',
      scheduledAt: { precision: 'datetime', date: '2026-12-01', time: '14:00' },
    },
  });
  assert.equal(logged.status, 'confirmed');
  assert.equal(logged.job.version, 2);

  const read = await desktop.getJob('job-cross-device');
  assert.ok(read.ok && read.value);
  assert.equal(read.value.version, 2);
  assert.equal(read.value.flow[0]?.kind, 'interview');
  if (read.value.flow[0]?.kind === 'interview') {
    assert.equal(read.value.flow[0].scheduledAt?.precision, 'datetime');
  }
});

test('旧客户端的撤回被拒绝，二面与三面都在', async () => {
  const first = await createClient(instance, instance.ownerId);
  const second = await createClient(instance, instance.ownerId);

  // 两个客户端都读到二面（版本 2）后，第一方登记三面。
  const logged = await first.submitJobCommand({
    kind: 'log-step',
    jobId: 'job-cross-device',
    expectedVersion: 2,
    nodeId: 'node-interview-3rd',
    step: { kind: 'interview', round: '三面' },
  });
  assert.equal(logged.status, 'confirmed');

  // 第二方仍以旧版本请求撤回二面。
  const withdrawn = await second.submitJobCommand({
    kind: 'remove-latest-step',
    jobId: 'job-cross-device',
    expectedVersion: 2,
    expectedLastNodeId: 'node-interview-2nd',
  });
  assert.equal(withdrawn.status, 'rejected');
  assert.ok(withdrawn.status === 'rejected' && withdrawn.failure.reason === 'versionConflict');

  // 重新读取：二面和三面都在。
  const read = await second.getJob('job-cross-device');
  assert.ok(read.ok && read.value);
  assert.deepEqual(
    read.value.flow.map((node) => (node.kind === 'interview' ? node.round : node.kind)),
    ['二面', '三面'],
  );
});

test('全新岗位禁止覆盖同 ID 记录，重送同一建档命令不追加第二条', async () => {
  const client = await createClient(instance, instance.ownerId);

  const first = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-idempotent',
    input: { company: '重复', position: '工程师' },
  });
  assert.equal(first.status, 'confirmed');

  const resent = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-idempotent',
    input: { company: '重复', position: '工程师' },
  });
  assert.equal(resent.status, 'rejected');

  const jobs = await client.listJobs();
  assert.ok(jobs.ok);
  assert.equal(jobs.value.filter((job) => job.id === 'job-idempotent').length, 1);
});

test('同一登记命令重送沿用同节点 ID，命中版本冲突不追加第二条', async () => {
  const client = await createClient(instance, instance.ownerId);

  const created = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-resend-step',
    input: { company: '重送', position: '测试' },
  });
  assert.ok(created.status === 'confirmed');

  const command = {
    kind: 'log-step',
    jobId: 'job-resend-step',
    expectedVersion: 1,
    nodeId: 'node-resend-once',
    step: { kind: 'applied' },
  } as const;
  const first = await client.submitJobCommand(command);
  assert.equal(first.status, 'confirmed');

  // 相同操作按相同期望版本重送：不会追加第二条环节。
  const resent = await client.submitJobCommand(command);
  assert.equal(resent.status, 'rejected');

  const read = await client.getJob('job-resend-step');
  assert.ok(read.ok && read.value);
  assert.equal(read.value.flow.length, 1);
});

test('分范围偏好：写手机覆盖保留共用与桌面', async () => {
  const client = await createClient(instance, instance.ownerId);

  const initial = await client.getPreferences();
  assert.ok(initial.ok);

  // 只写共用布局：两端覆盖保持缺省（沿用共用布局）。
  const sharedSaved = await client.savePreferences({
    shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
  });
  assert.equal(sharedSaved.status, 'confirmed');
  assert.ok(
    sharedSaved.status === 'confirmed' &&
      sharedSaved.preferences.mobile.overridden === false &&
      sharedSaved.preferences.desktop.overridden === false,
  );

  // 只写手机覆盖：共用布局与桌面不变。
  const mobileSaved = await client.savePreferences({
    mobile: { overridden: true, layout: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: false }] } },
  });
  assert.equal(mobileSaved.status, 'confirmed');
  assert.ok(mobileSaved.status === 'confirmed' && mobileSaved.preferences.mobile.overridden === true);
  if (mobileSaved.status === 'confirmed' && mobileSaved.preferences.mobile.overridden) {
    assert.deepEqual(mobileSaved.preferences.mobile.layout.modules, [
      { id: 'jobs', visible: true },
      { id: 'schedule', visible: false },
    ]);
  }
  // 手机改布局没有覆盖桌面与共用。
  assert.ok(mobileSaved.preferences.desktop.overridden === false);
  assert.deepEqual(mobileSaved.preferences.shared.modules, [
    { id: 'schedule', visible: true },
    { id: 'jobs', visible: true },
  ]);

  // 重新读取一致。
  const reread = await client.getPreferences();
  assert.ok(reread.ok && reread.value.mobile.overridden === true);
  assert.ok(reread.ok && reread.value.desktop.overridden === false);
});

test('非法偏好补丁被拒绝且不改动任何范围', async () => {
  const client = await createClient(instance, instance.ownerId);
  const before = await client.getPreferences();
  assert.ok(before.ok);

  const outcome = await client.savePreferences({
    mobile: { overridden: true, layout: { modules: [{ id: 'unknown-module' as never, visible: true }] } },
  });
  assert.equal(outcome.status, 'rejected');

  const after = await client.getPreferences();
  assert.ok(after.ok);
  assert.deepEqual(after.value, before.value);
});
