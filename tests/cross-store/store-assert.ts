/**
 * 跨适配器共享的最小断言工具。
 *
 * 不依赖 node:assert，使场景文件既能被 tsx/Node 加载（D1 HTTP 腿），
 * 也能被 Vite 直接送进真实浏览器执行（IndexedDB 腿）。
 */

/** 键序无关的稳定 JSON 序列化，用于纯数据记录的深度比较。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message}\n  期望: ${stableStringify(expected)}\n  实际: ${stableStringify(actual)}`,
    );
  }
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}（期望 ${String(expected)}，实际 ${String(actual)}）`);
  }
}

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 断言读取成功并返回值（提供类型收窄）。 */
export function assertOk<T>(
  result: { ok: true; value: T } | { ok: false; failure: unknown },
  message: string,
): T {
  if (!result.ok) {
    throw new Error(`${message}：${JSON.stringify(result.failure)}`);
  }
  return result.value;
}

/** 断言可选值存在（getJob 未命中返回 null 的场景）。 */
export function assertPresent<T>(value: T, message: string): Exclude<T, null | undefined> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value as Exclude<T, null | undefined>;
}

export interface ScenarioResult {
  name: string;
  ok: boolean;
  error?: string;
  ms: number;
  evidence?: Record<string, unknown>;
}

/** 场景上下文：openStore 每次返回指向同一底层存储的全新独立句柄。 */
export interface ScenarioContext {
  openStore: () => Promise<import('../../src/data/contract.ts').JobBoardStore>;
}

export async function runScenario(
  name: string,
  body: (ctx: ScenarioContext) => Promise<Record<string, unknown> | void>,
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const startedAt = Date.now();
  try {
    const evidence = (await body(ctx)) ?? {};
    return { name, ok: true, ms: Date.now() - startedAt, evidence };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - startedAt,
    };
  }
}
