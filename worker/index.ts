/**
 * 私有 Site 的生产 Worker 入口。
 *
 * API 路径先经站点所有者身份守卫再走看板逻辑；
 * 其余路径交给 Sites 静态资产绑定（ASSETS）返回站点文件。
 * 生产部署不携带迁移与故障模拟逻辑：结构由托管迁移建立，
 * 本入口不提供任何测试接口。
 */

import { handleBoardRequest } from './routes.ts';

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const result = await handleBoardRequest(request, env.DB, {
      ownerUserId: env.OWNER_USER_ID,
    });
    if (result.handled) {
      return result.response;
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('未找到资源。', { status: 404 });
  },
};

export default worker;
