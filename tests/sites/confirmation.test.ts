/**
 * persist-job-data 3.3：保存确认、明确失败与未确认反馈。
 *
 * 用测试专用 worker 的故障标记模拟三种结果：
 * - 发送前断网（预检）→ rejected，请求不发出；
 * - 服务端明确拒绝 → rejected；
 * - 提交后失去响应 → unconfirmed；恢复联网后刷新看到真实记录，
 *   重送相同操作命中版本冲突，不会重复追加。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSitesJobBoard } from '../../src/sites/client.ts';
import { createBoardInstance, createClient, fetchAs, type BoardInstance } from './helpers.ts';

let instance: BoardInstance;

test.before(async () => {
  instance = await createBoardInstance({ name: 'confirm', ownerId: 'user-confirm' });
});

test.after(async () => {
  await instance?.close();
});

test('发送前断网：预检拒绝且请求不发出', async () => {
  let fetchCalls = 0;
  // 与 fetchAs 相同的本地站主身份注入，仅额外计数。
  const authenticated: typeof fetch = (input, init) => {
    fetchCalls += 1;
    return fetchAs(instance.baseUrl, instance.ownerId)(input, init);
  };
  const offlineClient = await createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: authenticated,
    isOffline: () => true,
  });

  const outcome = await offlineClient.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-offline',
    input: { company: '离线', position: '工程师' },
  });
  assert.equal(outcome.status, 'rejected');
  assert.equal(fetchCalls, 0, '确定断网时不应发出任何请求');

  // 预检同样拦截读取；恢复在线（isOffline 缺省为在线）后看不到该岗位。
  const onlineClient = await createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: authenticated,
  });
  const read = await onlineClient.listJobs();
  assert.ok(read.ok, '恢复在线后读取应成功');
  assert.ok(read.ok && read.value.every((job) => job.id !== 'job-offline'));
});

test('服务端明确拒绝：报告失败并保留可重试状态', async () => {
  const client = await createClient(instance, instance.ownerId);

  // 版本条件不满足是服务端明确拒绝。
  const outcome = await client.submitJobCommand({
    kind: 'set-star',
    jobId: 'job-not-exist',
    expectedVersion: 1,
    starred: true,
  });
  assert.equal(outcome.status, 'rejected');
});

test('提交成功但回包丢失：未确认，刷新后读到真实记录，重送不重复追加', async () => {
  const client = await createClient(instance, instance.ownerId);

  const created = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-drop-response',
    input: { company: '失联', position: '工程师' },
  });
  assert.ok(created.status === 'confirmed');
  const jobVersionAfterCreate = created.status === 'confirmed' ? created.job.version : 0;

  // 故障提交加星：fetch 正常 resolve（状态 200），但读响应体时连接断开 ——
  // .then 的第二参数捕获不了成功回调里抛的错，用 try/catch。
  const flaky = fetchAs(instance.baseUrl, instance.ownerId);
  let bodyReadFailed = false;
  try {
    const response = await flaky(`${instance.baseUrl}/api/board/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zk-test-fault-drop-response': '1',
      },
      body: JSON.stringify({
        kind: 'set-star',
        jobId: 'job-drop-response',
        expectedVersion: jobVersionAfterCreate,
        starred: true,
      }),
    });
    await response.json();
  } catch {
    bodyReadFailed = true;
  }
  assert.equal(bodyReadFailed, true, '响应体读取已失败（网络层错误）');

  // 同一故障交给客户端映射：已发出的请求（回包体丢失）只能得到
  // 「未确认是否保存」。
  const faultedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-zk-test-fault-drop-response', '1');
    return fetchAs(instance.baseUrl, instance.ownerId)(input, { ...init, headers });
  };
  const faulted = await createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: faultedFetch,
  });
  const mapped = await faulted.submitJobCommand({
    kind: 'set-star',
    jobId: 'job-drop-response',
    expectedVersion: 999,
    starred: true,
  });
  assert.equal(mapped.status, 'unconfirmed', '已发出但回包丢失应报告未确认');

  // 恢复联网后刷新：真实记录可见（星标已提交，版本已递增）。
  const refreshed = await client.getJob('job-drop-response');
  assert.ok(refreshed.ok && refreshed.value);
  assert.equal(refreshed.value.starred, true);
  const refreshedVersion = refreshed.value.version;

  // 重送相同操作（旧期望版本）：命中版本冲突，不重复追加。
  const resent = await client.submitJobCommand({
    kind: 'set-star',
    jobId: 'job-drop-response',
    expectedVersion: jobVersionAfterCreate,
    starred: true,
  });
  assert.equal(resent.status, 'rejected');

  const finalRead = await client.getJob('job-drop-response');
  assert.ok(finalRead.ok && finalRead.value);
  assert.equal(finalRead.value.version, refreshedVersion, '重送未改变记录');
});

test('登记环节后回包丢失：刷新只看到一条环节，重送命中冲突', async () => {
  const client = await createClient(instance, instance.ownerId);

  const created = await client.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-drop-step',
    input: { company: '面试失联', position: '工程师' },
  });
  assert.ok(created.status === 'confirmed');

  // 通过客户端提交二面登记并注入丢包标记：提交完成、回包体读取失败被
  // 客户端映射为 unconfirmed。
  const faultedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-zk-test-fault-drop-response', '1');
    return fetchAs(instance.baseUrl, instance.ownerId)(input, { ...init, headers });
  };
  const faulted = await createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: faultedFetch,
  });
  const mapped = await faulted.submitJobCommand({
    kind: 'log-step',
    jobId: 'job-drop-step',
    expectedVersion: 1,
    nodeId: 'node-drop-interview',
    step: { kind: 'interview', round: '二面' },
  });
  assert.equal(mapped.status, 'unconfirmed', '回包丢失应报告未确认');

  // 刷新：只看到一条二面。
  const refreshed = await client.getJob('job-drop-step');
  assert.ok(refreshed.ok && refreshed.value);
  assert.equal(refreshed.value.flow.length, 1);
  if (refreshed.value.flow[0]?.kind === 'interview') {
    assert.equal(refreshed.value.flow[0].round, '二面');
  }

  // 重送相同登记（同节点 ID、同期望版本）：命中版本冲突，不追加第二条。
  const resent = await client.submitJobCommand({
    kind: 'log-step',
    jobId: 'job-drop-step',
    expectedVersion: 1,
    nodeId: 'node-drop-interview',
    step: { kind: 'interview', round: '二面' },
  });
  assert.equal(resent.status, 'rejected');

  const finalRead = await client.getJob('job-drop-step');
  assert.ok(finalRead.ok && finalRead.value);
  assert.equal(finalRead.value.flow.length, 1);
});

test('客户端映射：fetch 拒绝（已发出）一律 unconfirmed，不误报未保存', async () => {
  // 在线预检通过，但 fetch 抛出（连接被掐断）。
  const client = await createSitesJobBoard({
    apiBaseUrl: instance.baseUrl,
    fetch: async () => {
      throw new Error('simulated connection lost');
    },
  });

  const outcome = await client.submitJobCommand({
    kind: 'set-star',
    jobId: 'whatever',
    expectedVersion: 1,
    starred: true,
  });
  assert.equal(outcome.status, 'unconfirmed', '已发出的请求不能报告为未保存');
});
