/** 数据契约用例：版本化备份编解码与整包拒绝（persist-job-data 1.3）。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  defaultBoardPreferences,
  decodeBackup,
  encodeBackup,
  type BackupFile,
  type BoardPreferences,
} from '../../src/data/index.ts';
import { dispatchCreateJobCommand, dispatchJobCommand } from '../../src/data/index.ts';
import type { Job } from '../../src/domain/index.ts';

/** 构造一组覆盖空流程、首条二面、空期限、仅日期与具体时刻的岗位。 */
function buildSampleJobs(): Job[] {
  const empty = dispatchCreateJobCommand({
    kind: 'create-job',
    jobId: 'job-empty',
    input: { postingUrl: 'https://jobs.example.com/qr-b1' },
  });
  assert.ok(empty.ok);

  const directSecond = dispatchCreateJobCommand({
    kind: 'create-job',
    jobId: 'job-second',
    input: { company: '青禾科技', position: '前端工程师' },
  });
  assert.ok(directSecond.ok);
  const second = dispatchJobCommand(directSecond.job, {
    kind: 'log-step', jobId: 'job-second', expectedVersion: 1, nodeId: 'n-second', step: { kind: 'interview', round: '二面', scheduledAt: { precision: 'date', date: '2026-12-02' } },
  });
  assert.ok(second.ok);
  const marked = dispatchJobCommand(second.job, {
    kind: 'update-step', jobId: 'job-second', expectedVersion: 2, nodeId: 'n-second', payload: { targetKind: 'interview', patch: { status: 'done' } },
  });
  assert.ok(marked.ok);
  const offer = dispatchJobCommand(marked.job, {
    kind: 'log-step', jobId: 'job-second', expectedVersion: 3, nodeId: 'n-offer', step: { kind: 'offer' },
  });
  assert.ok(offer.ok);
  const closed = dispatchJobCommand(offer.job, {
    kind: 'record-outcome', jobId: 'job-second', expectedVersion: 4, status: 'declinedByUser',
  });
  assert.ok(closed.ok);

  const dated = dispatchCreateJobCommand({
    kind: 'create-job',
    jobId: 'job-dated',
    input: { postingUrl: 'https://jobs.example.com/qr-b2' },
  });
  assert.ok(dated.ok);
  const assessment = dispatchJobCommand(dated.job, {
    kind: 'log-step', jobId: 'job-dated', expectedVersion: 1, nodeId: 'n-assessment', step: { kind: 'assessment', deadline: { precision: 'date', date: '2026-11-30' } },
  });
  assert.ok(assessment.ok);
  const interview = dispatchJobCommand(assessment.job, {
    kind: 'log-step', jobId: 'job-dated', expectedVersion: 2, nodeId: 'n-interview', step: { kind: 'interview', round: '一面', scheduledAt: { precision: 'datetime', date: '2026-12-05', time: '14:00', timeZone: 'Asia/Shanghai' } },
  });
  assert.ok(interview.ok);
  return [empty.job, closed.job, interview.job];
}

describe('备份编解码往返', () => {
  it('空流程、首条二面、空期限、仅日期与具体时刻均按原精度回读', () => {
    const jobs = buildSampleJobs();
    const preferences: BoardPreferences = {
      shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] },
      mobile: { overridden: true, layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: false }] } },
      desktop: { overridden: false },
    };
    const encoded = encodeBackup(jobs, preferences);
    // 两次 JSON 往返模拟文件保存与读取。
    const decoded = decodeBackup(JSON.parse(JSON.stringify(encoded)));
    assert.ok(decoded.ok);
    const backup = decoded.backup;
    assert.equal(backup.format, BACKUP_FORMAT);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.deepEqual(backup.preferences, preferences);

    assert.equal(backup.applications.length, 3);
    const [empty, declined, dated] = backup.applications;
    assert.deepEqual(empty!.flow, []);
    assert.equal(declined!.outcome?.status, 'declinedByUser');
    assert.equal(declined!.flow.length, 2);
    assert.deepEqual(declined!.flow.map((node) => node.id), ['n-second', 'n-offer']);
    const offerNode = declined!.flow[1]!;
    assert.ok(offerNode.kind === 'offer');
    assert.equal(offerNode.replyDeadline, undefined);

    const assessmentNode = dated!.flow[0]!;
    assert.ok(assessmentNode.kind === 'assessment');
    assert.deepEqual(assessmentNode.deadline, { precision: 'date', date: '2026-11-30' });
    const interviewNode = dated!.flow[1]!;
    assert.ok(interviewNode.kind === 'interview');
    assert.deepEqual(interviewNode.scheduledAt, {
      precision: 'datetime',
      date: '2026-12-05',
      time: '14:00',
      timeZone: 'Asia/Shanghai',
    });

    // 解码结果可再次编码且内容一致（JSON 视角）。
    const reEncoded = encodeBackup(backup.applications, backup.preferences);
    assert.deepEqual(JSON.parse(JSON.stringify(reEncoded)), JSON.parse(JSON.stringify(encoded)));
  });

  it('空岗位数组与缺省偏好是合法备份', () => {
    const decoded = decodeBackup(encodeBackup([], defaultBoardPreferences()));
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.backup.applications, []);
    assert.deepEqual(decoded.backup.preferences, defaultBoardPreferences());
  });
});

describe('整包拒绝', () => {
  const validBackup = (): BackupFile => {
    const jobs = buildSampleJobs();
    return encodeBackup([jobs[1]!], defaultBoardPreferences());
  };

  it('未知格式版本被拒绝并说明支持范围', () => {
    const file = validBackup() as unknown as Record<string, unknown>;
    file.version = 2;
    const decoded = decodeBackup(file);
    assert.ok(!decoded.ok);
    assert.equal(decoded.issues.length, 1);
    assert.equal(decoded.issues[0]!.path, 'version');
    assert.match(decoded.issues[0]!.message, /不受支持/);
  });

  it('重复岗位或节点 ID 可定位到问题记录', () => {
    const file = validBackup();
    const duplicated = JSON.parse(JSON.stringify(file)) as BackupFile;
    duplicated.applications = [...duplicated.applications, JSON.parse(JSON.stringify(duplicated.applications[0]))];
    const decoded = decodeBackup(duplicated);
    assert.ok(!decoded.ok);
    assert.ok(decoded.issues.some((issue) => issue.path === 'applications[1].id' && /重复/.test(issue.message)));

    const withDuplicateNode = JSON.parse(JSON.stringify(file)) as BackupFile;
    const job = withDuplicateNode.applications[0]!;
    const clone = JSON.parse(JSON.stringify(job.flow[0]));
    job.flow[0]!.id = clone.id; // 保持不变；改为追加一个同 ID 节点：
    (job.flow as unknown[]).push(clone);
    const nodeDecoded = decodeBackup(withDuplicateNode);
    assert.ok(!nodeDecoded.ok);
    assert.ok(nodeDecoded.issues.some((issue) => /节点 ID.*重复/.test(issue.message)));
  });

  it('非法状态、无效期限与损坏偏好被拒绝', () => {
    const badOutcome = JSON.parse(JSON.stringify(validBackup())) as BackupFile;
    (badOutcome.applications[0]!.outcome as { status: string }).status = 'hired';
    const outcomeDecoded = decodeBackup(badOutcome);
    assert.ok(!outcomeDecoded.ok);
    assert.ok(outcomeDecoded.issues.some((issue) => issue.path.endsWith('outcome.status')));

    const badDeadline = JSON.parse(JSON.stringify(validBackup())) as BackupFile;
    const interviewJob = badDeadline.applications[0]!;
    (interviewJob.flow[0] as { kind: string }).kind = 'interview';
    (interviewJob.flow[0] as { round?: string; status?: string }).round = '一面';
    (interviewJob.flow[0] as { status?: string }).status = 'pending';
    (interviewJob.flow[0] as { scheduledAt?: unknown }).scheduledAt = { precision: 'date', date: '2026-02-30' };
    const deadlineDecoded = decodeBackup(badDeadline);
    assert.ok(!deadlineDecoded.ok);
    assert.ok(deadlineDecoded.issues.some((issue) => /日历日期/.test(issue.message)));

    const badPreferences = JSON.parse(JSON.stringify(validBackup())) as BackupFile;
    (badPreferences.preferences as unknown as Record<string, unknown>).mobile = { overridden: 'sometimes' };
    const prefsDecoded = decodeBackup(badPreferences);
    assert.ok(!prefsDecoded.ok);
    assert.ok(prefsDecoded.issues.some((issue) => issue.path.startsWith('preferences.mobile')));
  });

  it('有效记录之后出现坏数据时整包拒绝并报告位置', () => {
    const jobs = buildSampleJobs();
    const file = encodeBackup([jobs[0]!, jobs[1]!], defaultBoardPreferences());
    const broken = JSON.parse(JSON.stringify(file)) as BackupFile;
    broken.applications[1]!.starred = 'yes' as unknown as boolean;
    const decoded = decodeBackup(broken);
    assert.ok(!decoded.ok);
    assert.ok(decoded.issues.some((issue) => issue.path === 'applications[1].starred'));
  });
});
