// 回归专用：Vite 程序 API 在专属随机端口启动仓库根目录（可加载正式 src 与样式），用后关闭。
// 不触碰共享 vite.config.ts，也不写 tests/regression-timeline 以外的源文件。
import { randomPort } from '../browser/random-port';
import type { ViteDevServer } from 'vite';

export interface RegressionServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startRegressionServer(): Promise<RegressionServer> {
  const { createServer } = await import('vite');
  let server: ViteDevServer | null = await createServer({
    root: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    configFile: 'vite.config.ts',
    server: { port: randomPort(), strictPort: true },
    logLevel: 'error',
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  if (!baseUrl) {
    await server.close();
    throw new Error('Vite dev server did not report a resolved URL');
  }
  return {
    baseUrl,
    close: async () => {
      if (server) {
        await server.close();
        server = null;
      }
    },
  };
}
