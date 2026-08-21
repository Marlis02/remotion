/**
 * SP-3c (Q7): размеры артефактов и воспроизводимость «сборки» для нового кандидата.
 *
 * У Remotion есть отдельная стадия бандлинга, и SP-3 отвечал на U3 так: два
 * независимых холодных бандла побайтово совпали. У HyperFrames отдельного бандла
 * нет — источник и есть HTML, а компилятор внутри рендера считает по нему
 * `compositionHash`. Поэтому U3 здесь ставится иначе: (а) один ли `compositionHash`
 * у всех прогонов одной композиции, (б) совпадают ли два независимых холодных
 * компиляции с очищенным кэшем, (в) сколько весит то, что придётся возить.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROOT, HF_CLI, childEnv} from './lib/env.mjs';
import {getVersions, chromeHeadlessShellPath} from './lib/versions.mjs';

const RAW = path.join(ROOT, 'results/raw');
const duBytes = (p) => {
  try {
    return Number(execFileSync('du', ['-sb', p], {encoding: 'utf8'}).split('\t')[0]);
  } catch {
    return null;
  }
};
const mb = (b) => (b === null ? null : Math.round((b / 1024 ** 2) * 10) / 10);

const runs = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.schema === 'sp3c-run/1' && r.renderer === 'hyperframes' && r.status === 'OK');

const hashesByProject = {};
for (const r of runs) {
  const hash = (r.trace ?? []).find((t) => t.phase === 'compile' && t.status === 'checkpoint')?.compositionHash;
  const proj = r.config.project;
  if (!hash) continue;
  hashesByProject[proj] = hashesByProject[proj] ?? new Set();
  hashesByProject[proj].add(hash);
}

// Холодная компиляция дважды: чистим кэш извлечения кадров и кэш шрифтов,
// прогоняем `hyperframes lint` + один короткий рендер и сравниваем compositionHash.
const coldCompile = (tag) => {
  const cacheDir = path.join(os.tmpdir(), `hyperframes-extract-cache-${process.getuid?.() ?? 1000}`);
  fs.rmSync(cacheDir, {recursive: true, force: true});
  const out = path.join(ROOT, `out/build-repro-${tag}.mp4`);
  fs.rmSync(out, {force: true});
  const t = Date.now();
  const res = spawnSync(
    process.execPath,
    [HF_CLI, 'render', 'src', '-o', out, '--workers', '1', '--quality', 'draft', '--format', 'mp4', '--fps', '30', '--browser-gpu', '--quiet'],
    {cwd: ROOT, env: childEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000},
  );
  const log = `${res.stdout ?? ''}${res.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const m = log.match(/"compositionHash":"([0-9a-f]+)"/);
  return {
    tag,
    ms: Date.now() - t,
    exitCode: res.status,
    compositionHash: m ? m[1] : null,
    outputSha256: fs.existsSync(out) ? crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex') : null,
    outputBytes: fs.existsSync(out) ? fs.statSync(out).size : null,
  };
};

const cold1 = coldCompile('cold1');
const cold2 = coldCompile('cold2');

const chrome = chromeHeadlessShellPath();
const doc = {
  schema: 'sp3c-build/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  compositionHashes: Object.fromEntries(Object.entries(hashesByProject).map(([k, v]) => [k, [...v]])),
  coldCompiles: [cold1, cold2],
  sizesMb: {
    'sp3c/node_modules (hyperframes + gsap + ffmpeg-static)': mb(duBytes(path.join(ROOT, 'node_modules'))),
    'sp3c/node_modules/hyperframes + @hyperframes': mb(
      (duBytes(path.join(ROOT, 'node_modules/hyperframes')) ?? 0) + (duBytes(path.join(ROOT, 'node_modules/@hyperframes')) ?? 0),
    ),
    'chrome-headless-shell (puppeteer cache)': mb(duBytes(chrome ? path.dirname(chrome) : '/nonexistent')),
    'puppeteer chrome (полный, скачан заодно)': mb(duBytes(path.join(process.env.HOME, '.cache/puppeteer/chrome'))),
    'ffmpeg-static + ffprobe-static': mb(
      (duBytes(path.join(ROOT, 'node_modules/ffmpeg-static')) ?? 0) + (duBytes(path.join(ROOT, 'node_modules/ffprobe-static')) ?? 0),
    ),
    'композиция целиком (src/, вместе с фоном и шрифтом)': mb(duBytes(path.join(ROOT, 'src'))),
    'из неё: index.html': mb(fs.statSync(path.join(ROOT, 'src/index.html')).size),
    'из неё: motion.js (предвычисленные кадры)': mb(fs.statSync(path.join(ROOT, 'src/motion.js')).size),
    'контроль: control/node_modules (remotion)': mb(duBytes(path.join(ROOT, 'control/node_modules'))),
    'контроль: chrome remotion (.remotion)': mb(duBytes(path.join(ROOT, 'control/node_modules/.remotion'))),
    'контроль: бандл remotion (.bundle/main)': mb(duBytes(path.join(ROOT, 'control/.bundle/main'))),
  },
  summary: {},
};
doc.summary = {
  'разных compositionHash у src/ за все прогоны': (doc.compositionHashes.src ?? []).length,
  'compositionHash холодной компиляции 1': cold1.compositionHash,
  'compositionHash холодной компиляции 2': cold2.compositionHash,
  'две холодные компиляции дали один compositionHash': cold1.compositionHash !== null && cold1.compositionHash === cold2.compositionHash,
  'две холодные компиляции дали побайтово равный mp4': cold1.outputSha256 !== null && cold1.outputSha256 === cold2.outputSha256,
  'node_modules HyperFrames, МБ': doc.sizesMb['sp3c/node_modules (hyperframes + gsap + ffmpeg-static)'],
  'chrome-headless-shell, МБ': doc.sizesMb['chrome-headless-shell (puppeteer cache)'],
  'композиция целиком, МБ': doc.sizesMb['композиция целиком (src/, вместе с фоном и шрифтом)'],
};
fs.writeFileSync(path.join(RAW, 'build-repro.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify(doc.summary, null, 2));
