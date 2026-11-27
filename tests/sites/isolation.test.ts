/**
 * persist-job-data 3.1：实例隔离与可信所有者身份守卫。
 *
 * 两份隔离绑定各自从零条岗位开始；甲乙各自读写互不可见；
 * 匿名和其他身份不能访问甲的岗位、偏好或备份接口。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardInstance, createClient, fetchAs, type BoardInstance } from './helpers.ts';

let alice: BoardInstance;
let bob: BoardInstance;

test.before(async () => {
  alice = await createBoardInstance({ name: 'alice', ownerId: 'user-alice' });
  bob = await createBoardInstance({ name: 'bob', ownerId: 'user-bob' });
});

test.after(async () => {
  await Promise.allSettled([alice?.close(), bob?.close()]);
});

test('两份隔离绑定初始化均为空', async () => {
  const aliceClient = await createClient(alice, alice.ownerId);
  const bobClient = await createClient(bob, bob.ownerId);

  const aliceJobs = await aliceClient.listJobs();
  assert.deepEqual(aliceJobs, { ok: true, value: [] });
  const bobJobs = await bobClient.listJobs();
  assert.deepEqual(bobJobs, { ok: true, value: [] });

  const alicePrefs = await aliceClient.getPreferences();
  assert.ok(alicePrefs.ok && alicePrefs.value.shared.modules.length > 0);
  const bobPrefs = await bobClient.getPreferences();
  assert.ok(bobPrefs.ok && bobPrefs.value.shared.modules.length > 0);
});

test('甲乙各自读写，乙的实例保持为空', async () => {
  const aliceClient = await createClient(alice, alice.ownerId);
  const bobClient = await createClient(bob, bob.ownerId);

  const created = await aliceClient.submitJobCommand({
    kind: 'create-job',
    jobId: 'job-alice-1',
    input: { company: '青禾', position: '前端工程师' },
  });
  assert.equal(created.status, 'confirmed');

  const bobJobs = await bobClient.listJobs();
  assert.deepEqual(bobJobs, { ok: true, value: [] });
  const aliceJobs = await aliceClient.listJobs();
  assert.ok(aliceJobs.ok && aliceJobs.value.length === 1);
});

test('匿名访问甲的数据接口被拒绝', async () => {
  const anonymous = fetchAs(alice.baseUrl, null);
  for (const [method, path] of [
    ['GET', '/api/board/jobs'],
    ['GET', '/api/board/preferences'],
    ['GET', '/api/board/backup'],
    ['POST', '/api/board/commands'],
    ['POST', '/api/board/backup/import'],
  ] as const) {
    const response = await anonymous(`${alice.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ kind: 'set-star' }) : undefined,
    });
    assert.equal(response.status, 401, `${method} ${path} 应拒绝匿名访问`);
  }
});

test('其他身份（乙）访问甲的数据接口被拒绝且数据不变', async () => {
  const bobAsAlice = fetchAs(alice.baseUrl, bob.ownerId);
  for (const path of ['/api/board/jobs', '/api/board/preferences', '/api/board/backup']) {
    const response = await bobAsAlice(`${alice.baseUrl}${path}`);
    assert.equal(response.status, 403, `${path} 应拒绝非所有者`);
  }
  const write = await bobAsAlice(`${alice.baseUrl}/api/board/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'set-star',
      jobId: 'job-alice-1',
      expectedVersion: 1,
      starred: true,
    }),
  });
  assert.equal(write.status, 403);

  // 甲的数据保持原样：岗位未被加星。
  const aliceClient = await createClient(alice, alice.ownerId);
  const read = await aliceClient.getJob('job-alice-1');
  assert.ok(read.ok && read.value && read.value.starred === false);
});

test('客户端传入的站点 ID 或邮箱不能授予所有权', async () => {
  const spoofer = fetchAs(alice.baseUrl, 'user-bob');
  // 即使把身份写进请求体，服务端只认可信头。
  const response = await spoofer(`${alice.baseUrl}/api/board/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'set-star',
      jobId: 'job-alice-1',
      expectedVersion: 1,
      starred: true,
      ownerUserId: 'user-alice',
      email: 'alice@example.com',
    }),
  });
  assert.equal(response.status, 403);
});
