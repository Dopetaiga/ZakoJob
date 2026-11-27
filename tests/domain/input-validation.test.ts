import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJob, logAppliedStep, updateJobProfile, validateDeadline } from '../../src/domain/index.ts';

test('日期精度保留，日历中不存在的日期返回错误', () => {
  assert.equal(validateDeadline({ precision: 'date', date: '2024-02-29' }), null);
  assert.ok(validateDeadline({ precision: 'date', date: '2026-02-29' }));
  assert.ok(validateDeadline({ precision: 'datetime', date: '2026-11-31', time: '10:30' }));
});

test('保存后岗位仍能识别，链接可由浏览器打开', () => {
  assert.equal(createJob({ postingUrl: 'file:///job' }).ok, false);
  const created = createJob({ postingUrl: 'https://example.org/hiring' });
  assert.ok(created.ok);
  assert.equal(updateJobProfile(created.job, created.job.version, { postingUrl: '' }).ok, false);
});

test('重复的环节 ID 无法追加到现有流程', () => {
  const created = createJob({ company: '甲', position: '工程师' });
  assert.ok(created.ok);
  const options = { generateId: () => 'step-1' };
  const first = logAppliedStep(created.job, created.job.version, options);
  assert.ok(first.ok);
  assert.equal(logAppliedStep(first.job, first.job.version, options).ok, false);
});

test('建档时填写的可选资料在首次提交中保存', () => {
  const draft = { company: '青禾', position: '开发', location: '上海', salary: '300 元/天', jobDescription: '第一行\n第二行' };
  const created = createJob(draft);
  assert.ok(created.ok);
  assert.deepEqual(created.job.profile, draft);
  assert.equal(created.job.version, 1);
});
