import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist/public', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/server/index.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external', sourcemap: true }),
  build({ entryPoints: ['src/client/admin.ts', 'src/client/overlay.ts'], outdir: 'dist/public', bundle: true, platform: 'browser', target: 'chrome110', format: 'esm', minify: true, sourcemap: true }),
  cp('public', 'dist/public', { recursive: true })
]);
console.log('Build ready. Run npm start, then open http://127.0.0.1:3187');
