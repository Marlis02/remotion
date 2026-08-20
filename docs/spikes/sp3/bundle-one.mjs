/** SP-3: одна сборка бандла в СВЕЖЕМ процессе (иначе «холодный» бандл меряется с прогретым node). */
import {bundle} from '@remotion/bundler';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const T0 = Date.now();
const NODE_BOOT_MS = Math.round(T0 - performance.timeOrigin);

const hashDir = (dir) => {
  const files = [];
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else files.push([r, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(dir);
  const h = crypto.createHash('sha256');
  for (const [r, sha] of files) h.update(`${r} ${sha}\n`);
  return {dirHash: h.digest('hex'), fileCount: files.length, files: files.map(([r, sha]) => ({path: r, sha256: sha}))};
};

if (cfg.cold) {
  fs.rmSync(cfg.outDir, {recursive: true, force: true});
  fs.rmSync(cfg.cacheDir, {recursive: true, force: true});
}
const t = Date.now();
await bundle({
  entryPoint: path.join(ROOT, 'src/index.ts'),
  publicDir: path.join(ROOT, 'assets'),
  outDir: cfg.outDir,
  webpackCachePath: cfg.cacheDir,
});
const ms = Date.now() - t;
const h = hashDir(cfg.outDir);
fs.writeFileSync(
  cfg.resultPath,
  JSON.stringify({label: cfg.label, cold: !!cfg.cold, ms, nodeBootMs: NODE_BOOT_MS, processMs: Date.now() - T0 + NODE_BOOT_MS, ...h}, null, 2),
);
console.log(`${cfg.label}: bundle ${ms} ms (процесс целиком ${Date.now() - T0 + NODE_BOOT_MS} ms), dirHash ${h.dirHash.slice(0, 16)}`);
