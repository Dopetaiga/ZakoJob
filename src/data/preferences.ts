/**
 * 开始页偏好的结构验证。
 *
 * 偏好可能来自不可信的备份文件或客户端请求，
 * 先验证结构再写入存储；校验只关心模块标识、顺序与可见性，
 * 模块的显示名称与样式由前端负责。
 */

import {
  BOARD_MODULE_IDS,
  PREFERENCE_SCOPES,
  type BoardLayout,
  type BoardModuleId,
  type BoardPreferences,
  type DeviceLayoutOverride,
  type PreferencesPatch,
} from './contract.ts';
import type { BackupIssue } from './contract.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验一份布局：必须恰好列出每个已知模块一次，visible 为布尔。 */
function checkLayout(value: unknown, path: string, issues: BackupIssue[]): BoardLayout | null {
  if (!isPlainObject(value) || !Array.isArray(value.modules)) {
    issues.push({ path, message: '布局必须是含 modules 数组的对象。' });
    return null;
  }
  const seen = new Set<BoardModuleId>();
  const modules: BoardModulePlacementCheck[] = [];
  for (const [index, entry] of value.modules.entries()) {
    const entryPath = `${path}.modules[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push({ path: entryPath, message: '模块条目必须是对象。' });
      continue;
    }
    if (typeof entry.id !== 'string' || !BOARD_MODULE_IDS.includes(entry.id as BoardModuleId)) {
      issues.push({
        path: entryPath,
        message: `未知模块「${String(entry.id)}」，可用模块：${BOARD_MODULE_IDS.join('、')}。`,
      });
      continue;
    }
    if (typeof entry.visible !== 'boolean') {
      issues.push({ path: `${entryPath}.visible`, message: 'visible 必须是布尔值。' });
      continue;
    }
    if (seen.has(entry.id as BoardModuleId)) {
      issues.push({ path: entryPath, message: `模块「${entry.id}」重复出现。` });
      continue;
    }
    seen.add(entry.id as BoardModuleId);
    modules.push({ id: entry.id as BoardModuleId, visible: entry.visible });
  }
  for (const id of BOARD_MODULE_IDS) {
    if (!seen.has(id)) {
      issues.push({ path: `${path}.modules`, message: `缺少模块「${id}」。` });
    }
  }
  if (issues.some((issue) => issue.path.startsWith(path))) {
    return null;
  }
  return { modules };
}

interface BoardModulePlacementCheck {
  id: BoardModuleId;
  visible: boolean;
}

/** 校验分端覆盖：`overridden: false` 或 `{ overridden: true, layout }`。 */
function checkOverride(
  value: unknown,
  path: string,
  issues: BackupIssue[],
): DeviceLayoutOverride | null {
  if (!isPlainObject(value)) {
    issues.push({ path, message: '分端覆盖必须是对象。' });
    return null;
  }
  if (value.overridden === false) {
    return { overridden: false };
  }
  if (value.overridden === true) {
    const layout = checkLayout(value.layout, `${path}.layout`, issues);
    if (!layout) {
      return null;
    }
    return { overridden: true, layout };
  }
  issues.push({ path: `${path}.overridden`, message: 'overridden 必须是布尔值。' });
  return null;
}

/** 偏好解析结果：通过时返回可信的偏好，否则返回可定位的问题列表。 */
export type PreferencesParseResult =
  | { ok: true; preferences: BoardPreferences }
  | { ok: false; issues: BackupIssue[] };

/**
 * 验证并解析完整偏好（备份中的 `preferences` 或存储读回值）。
 * 三个范围（shared、mobile、desktop）都必须存在且合法。
 */
export function validatePreferences(value: unknown): PreferencesParseResult {
  const issues: BackupIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ path: 'preferences', message: '偏好必须是对象。' }],
    };
  }
  const scopeIssues: BackupIssue[] = [];
  for (const scope of PREFERENCE_SCOPES) {
    if (!(scope in value)) {
      scopeIssues.push({ path: `preferences.${scope}`, message: `缺少偏好范围「${scope}」。` });
    }
  }
  const shared = checkLayout(value.shared, 'preferences.shared', issues);
  const mobile = checkOverride(value.mobile, 'preferences.mobile', issues);
  const desktop = checkOverride(value.desktop, 'preferences.desktop', issues);
  const all = [...scopeIssues, ...issues];
  if (all.length > 0 || !shared || !mobile || !desktop) {
    return { ok: false, issues: all };
  }
  return { ok: true, preferences: { shared, mobile, desktop } };
}

/** 偏好补丁解析结果。 */
export type PreferencesPatchParseResult =
  | { ok: true; patch: PreferencesPatch }
  | { ok: false; issues: BackupIssue[] };

/**
 * 验证偏好写入补丁：只允许出现已知范围，提供的范围必须完整合法；
 * 未提供的范围保持不变。空补丁合法（等于不改动任何范围）。
 */
export function validatePreferencesPatch(value: unknown): PreferencesPatchParseResult {
  if (value === undefined || value === null) {
    return { ok: true, patch: {} };
  }
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ path: 'patch', message: '偏好补丁必须是对象。' }],
    };
  }
  const issues: BackupIssue[] = [];
  for (const key of Object.keys(value)) {
    if (!PREFERENCE_SCOPES.includes(key as (typeof PREFERENCE_SCOPES)[number])) {
      issues.push({
        path: `patch.${key}`,
        message: `未知偏好范围「${key}」，可用范围：${PREFERENCE_SCOPES.join('、')}。`,
      });
    }
  }
  const patch: PreferencesPatch = {};
  if ('shared' in value) {
    const shared = checkLayout(value.shared, 'patch.shared', issues);
    if (shared) {
      patch.shared = shared;
    }
  }
  if ('mobile' in value) {
    const mobile = checkOverride(value.mobile, 'patch.mobile', issues);
    if (mobile) {
      patch.mobile = mobile;
    }
  }
  if ('desktop' in value) {
    const desktop = checkOverride(value.desktop, 'patch.desktop', issues);
    if (desktop) {
      patch.desktop = desktop;
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, patch };
}
