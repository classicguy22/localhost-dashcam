import { build } from 'esbuild';
import { cp, copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('extension', 'dist', { recursive: true });
await copyFile('node_modules/rrweb/dist/style.css', 'dist/rrweb.css');
await build({
  entryPoints: ['background', 'probe', 'recorder', 'popup', 'viewer', 'replay'].map(name => 'src/' + name + '.js'),
  bundle: true,
  outdir: 'dist',
  target: 'chrome120',
  legalComments: 'eof'
});
