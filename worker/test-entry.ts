/**
 * 隔离测试专用 Worker 入口（不用于生产部署）。
 *
 * 与生产入口的区别只有两处，均由本模块承担，生产入口不含这些逻辑：
 * 1. 首个请求前对本实例绑定的 D1 应用 drizzle 迁移（隔离库每次新建）；
 * 2. 识别测试请求头中的故障标记，模拟「提交后失联」与「导入批次中途失败」。
 *
 * 故障标记只存在于测试请求，生产环境不定义也不识别这些行为。
 */

import { applyBoardMigrations } from './db-migrations.ts';
import { handleBoardRequest, type BoardRequestOptions } from './routes.ts';

/** 测试标记：命令已提交但掐断响应，让客户端得到「未确认是否保存」。 */
const FAULT_DROP_RESPONSE = 'x-zk-test-fault-drop-response';
/** 测试标记：整包导入批次在岗位写入之后失败。 */
const FAULT_IMPORT_MIDWAY = 'x-zk-test-fault-import-midway';

function makeErroredStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('simulated connection lost'));
    },
  });
}

let migrationsReady = false;

async function ensureMigrated(env: WorkerEnv): Promise<void> {
  if (migrationsReady) {
    return;
  }
  await applyBoardMigrations(env.DB);
  migrationsReady = true;
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    await ensureMigrated(env);

    const faults = request.headers.get(FAULT_IMPORT_MIDWAY)
      ? { importMidwayFailure: true }
      : undefined;
    const options: BoardRequestOptions = {
      ownerUserId: env.OWNER_USER_ID,
      ...(faults ? { faults } : {}),
    };

    const result = await handleBoardRequest(request, env.DB, options);
    if (!result.handled) {
      return new Response('未找到资源。', { status: 404 });
    }
    if (request.headers.get(FAULT_DROP_RESPONSE) && result.response.status < 400) {
      // 成功响应已生成（提交已完成），但让连接在回包前断开。
      return new Response(makeErroredStream(), {
        status: result.response.status,
        headers: result.response.headers,
      });
    }
    return result.response;
  },
};

export default worker;
