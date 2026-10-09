// Run:  npm ci && npm run build      (writes ../vendor.js)
import { build } from 'esbuild';

await build({
  entryPoints: ['entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'eof',
  outfile: '../vendor.js',
  logLevel: 'info'
});
