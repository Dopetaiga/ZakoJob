import { mkdir, readdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');

// Vite clears the same output directory used by the static build.
await build({ root, mode: 'sites', build: { outDir: dist, emptyOutDir: true } });
const client = resolve(dist, 'client');
const assets = await readdir(dist);
await mkdir(client);
for (const asset of assets) {
  await rename(resolve(dist, asset), resolve(client, asset));
}

await build({
  root,
  mode: 'sites',
  publicDir: false,
  build: {
    outDir: resolve(dist, 'server'),
    ssr: resolve(root, 'worker/index.ts'),
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
