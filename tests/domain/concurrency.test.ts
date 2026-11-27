/** 任务 3.2：版本条件与冲突结果，用内存测试替身验证两种交错顺序。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createJob,
  logAppliedStep,
  logInterviewStep,
  removeLatestStep,
  type InterviewNode,
  type Job,
} from '../../src/domain/index.ts';
import { InMemoryJobStore, createTestIdFactory } from './helpers.ts';

/** 搭建「已投递 + 一面 + 二面」的初始记录，并把三面之前的末节点交给手机端。 */
function buildBase(): { store: InMemoryJobStore; phoneView: Job; secondNode: InterviewNode } {
  const created = createJob(
    { postingUrl: 'https://jobs.example.com/qr-6001' },
    { generateId: createTestIdFactory('job') },
  );
  assert.ok(created.ok);
  const applied = logAppliedStep(created.job, created.job.version);
  assert.ok(applied.ok);
  const first = logInterviewStep(applied.job, applied.job.version, { round: '一面' });
  assert.ok(first.ok);
  const second = logInterviewStep(first.job, first.job.version, { round: '二面' });
  assert.ok(second.ok);

  const store = new InMemoryJobStore();
  store.put(second.job);
  const secondNode = second.job.flow[2] as InterviewNode;
  return { store, phoneView: second.job, secondNode };
}

/** 桌面端读取、追加三面并条件提交成功。 */
function desktopAppendsThirdRound(store: InMemoryJobStore): void {
  const read = store.read('job-1');
  assert.ok(read);
  const third = logInterviewStep(read, read.version, { round: '三面' });
  assert.ok(third.ok);
  const saved = store.save(third.job, read.version);
  assert.ok(saved.ok);
}

describe('版本条件与冲突结果（3.2）', () => {
  it('交错一：读到新末节点后提交旧请求，领域层返回版本冲突', () => {
    const { store, phoneView, secondNode } = buildBase();
    desktopAppendsThirdRound(store);

    // 手机端重新读到最新记录（末节点已是三面），却仍按之前构造的撤回请求提交。
    const latest = store.read('job-1');
    assert.ok(latest);
    const staleRequest = removeLatestStep(latest, phoneView.version, secondNode.id);
    assert.ok(!staleRequest.ok);
    assert.equal(staleRequest.failure.reason, 'versionConflict');

    // 领域层拒绝，且未生成可保存的记录；二面和三面均保留。
    const after = store.read('job-1');
    assert.ok(after);
    assert.equal(after.flow.length, 4);
    assert.equal((after.flow[3] as InterviewNode).round, '三面');
    assert.equal((after.flow[2] as InterviewNode).round, '二面');
  });

  it('交错二：业务检查通过后、保存前另一端追加节点，保存方拒绝条件写入', () => {
    const { store, phoneView, secondNode } = buildBase();

    // 手机端仍持有旧视图（末节点二面、版本 4），领域检查在旧视图上通过。
    const phoneAttempt = removeLatestStep(phoneView, phoneView.version, secondNode.id);
    assert.ok(phoneAttempt.ok);
    assert.equal(phoneAttempt.job.flow.length, 2);

    // 领域检查之后、保存之前，桌面端成功追加三面。
    desktopAppendsThirdRound(store);

    // 保存方按读取时的版本条件提交：版本已变化，写入被拒绝。
    const save = store.save(phoneAttempt.job, phoneView.version);
    assert.ok(!save.ok);
    assert.equal(save.reason, 'versionConflict');
    assert.equal(save.currentVersion, 5);

    // 重读后二面和三面均在；若用户重新选择，只能先撤回三面。
    const after = store.read('job-1');
    assert.ok(after);
    assert.equal(after.flow.length, 4);
    assert.equal((after.flow[2] as InterviewNode).round, '二面');
    assert.equal((after.flow[3] as InterviewNode).round, '三面');

    const thirdNode = after.flow[3] as InterviewNode;
    const retry = removeLatestStep(after, after.version, thirdNode.id);
    assert.ok(retry.ok);
    assert.equal(retry.job.flow.length, 3);
  });

  it('业务检查通过且版本未变时，条件写入成功', () => {
    const { store, phoneView, secondNode } = buildBase();

    const phoneAttempt = removeLatestStep(phoneView, phoneView.version, secondNode.id);
    assert.ok(phoneAttempt.ok);
    const saved = store.save(phoneAttempt.job, phoneView.version);
    assert.ok(saved.ok);
    assert.equal(saved.job.version, phoneView.version + 1);

    const after = store.read('job-1');
    assert.ok(after);
    assert.equal(after.flow.length, 2);
    assert.equal((after.flow[1] as InterviewNode).round, '一面');
  });
});
