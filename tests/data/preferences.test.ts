/** 数据契约用例：偏好与偏好补丁验证（persist-job-data 1.1、spec 布局要求）。 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultBoardPreferences,
  validatePreferences,
  validatePreferencesPatch,
} from '../../src/data/index.ts';

describe('完整偏好验证', () => {
  it('缺省偏好合法', () => {
    const parsed = validatePreferences(defaultBoardPreferences());
    assert.ok(parsed.ok);
  });

  it('接受调整顺序、隐藏模块与分端覆盖', () => {
    const parsed = validatePreferences({
      shared: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: false }] },
      mobile: { overridden: true, layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] } },
      desktop: { overridden: false },
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.preferences.shared.modules.map((m) => m.id), ['schedule', 'jobs']);
    assert.equal(parsed.preferences.mobile.overridden, true);
    assert.equal(parsed.preferences.desktop.overridden, false);
  });

  it('拒绝缺范围、缺模块、未知模块、重复模块与非布尔可见性', () => {
    const missingScope = validatePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'schedule', visible: true }] },
      mobile: { overridden: false },
    });
    assert.ok(!missingScope.ok);
    assert.ok(missingScope.issues.some((issue) => issue.path === 'preferences.desktop'));

    const missingModule = validatePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }] },
      mobile: { overridden: false },
      desktop: { overridden: false },
    });
    assert.ok(!missingModule.ok);
    assert.ok(missingModule.issues.some((issue) => /缺少模块「schedule」/.test(issue.message)));

    const unknownModule = validatePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'calendar', visible: true }] },
      mobile: { overridden: false },
      desktop: { overridden: false },
    });
    assert.ok(!unknownModule.ok);
    assert.ok(unknownModule.issues.some((issue) => /未知模块/.test(issue.message)));

    const duplicate = validatePreferences({
      shared: { modules: [{ id: 'jobs', visible: true }, { id: 'jobs', visible: false }, { id: 'schedule', visible: true }] },
      mobile: { overridden: false },
      desktop: { overridden: false },
    });
    assert.ok(!duplicate.ok);
    assert.ok(duplicate.issues.some((issue) => /重复出现/.test(issue.message)));

    const badVisible = validatePreferences({
      shared: { modules: [{ id: 'jobs', visible: 'yes' }, { id: 'schedule', visible: true }] },
      mobile: { overridden: false },
      desktop: { overridden: false },
    });
    assert.ok(!badVisible.ok);
    assert.ok(badVisible.issues.some((issue) => issue.path.endsWith('visible')));
  });
});

describe('偏好补丁验证', () => {
  it('空补丁合法，未知范围被拒绝', () => {
    assert.deepEqual(validatePreferencesPatch({}), { ok: true, patch: {} });
    assert.deepEqual(validatePreferencesPatch(undefined), { ok: true, patch: {} });

    const unknown = validatePreferencesPatch({ tablet: { overridden: false } });
    assert.ok(!unknown.ok);
    assert.ok(unknown.issues.some((issue) => /未知偏好范围「tablet」/.test(issue.message)));
  });

  it('只接受提供的范围并解析成功', () => {
    const parsed = validatePreferencesPatch({
      mobile: { overridden: true, layout: { modules: [{ id: 'schedule', visible: true }, { id: 'jobs', visible: true }] } },
    });
    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.patch), ['mobile']);
    assert.equal(parsed.patch.mobile?.overridden, true);
  });

  it('提供的范围不完整时报告对应路径', () => {
    const parsed = validatePreferencesPatch({ shared: { modules: 'jobs first' } });
    assert.ok(!parsed.ok);
    assert.ok(parsed.issues.some((issue) => issue.path === 'patch.shared'));
  });
});
