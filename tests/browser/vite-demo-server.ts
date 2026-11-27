// 验收专用：用 Vite 程序 API 在专属随机端口启动 demo.html，用例结束后关闭。
// 不触碰共享 vite.config.ts，也不写 tests/browser 以外的源文件。
import { randomPort } from './random-port';
import type { ViteDevServer } from 'vite';

export interface DemoServer {
  baseUrl: string;
  demoUrl: string;
  close: () => Promise<void>;
}

export async function startDemoServer(): Promise<DemoServer> {
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
    demoUrl: new URL('demo.html', baseUrl).toString(),
    close: async () => {
      if (server) {
        await server.close();
        server = null;
      }
    },
  };
}
