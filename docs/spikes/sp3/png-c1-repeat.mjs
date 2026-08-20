/**
 * SP-3, блок F: детерминирован ли Chrome сам по себе при concurrency = 1 и полном масштабе.
 *
 * Зачем отдельным файлом. Блоки A–E уже были сняты, когда стал нужен этот вопрос
 * (блок B отвечает на него только для scale 0.25 профиля ac4). Дописывать
 * determinism.mjs означало бы, что закоммиченный код не равен коду, которым сняты A–E.
 * Результат дописывается в тот же results/raw/determinism.json как блок F.
 */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {framemd5, compareFramemd5, psnrBetweenPngDirs} from './lib/media.mjs';
import {PROFILES} from './lib/profiles.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {ROOT, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
const DOC = path.join(RAW, 'determinism.json');

const doc = JSON.parse(fs.readFileSync(DOC, 'utf8'));
const flush = () => {
  fs.writeFileSync(DOC, JSON.stringify(doc, null, 2) + '\n');
  try {
    writeSummary();
  } catch {
    /* пересоберётся позже */
  }
};

const hashPngDir = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const perFile = files.map((f) => ({file: f, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}));
  const h = crypto.createHash('sha256');
  for (const e of perFile) h.update(`${e.file} ${e.sha256}\n`);
  return {dirHash: h.digest('hex'), count: files.length, perFile};
};

const runRunner = async (cfg) => {
  const t = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  const code = await new Promise((r) => child.on('close', r));
  return {code, wallMs: Date.now() - t, memory: sampler.stop(), stderr: stderr.slice(-2000), commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`};
};

const CONCURRENCY = Number(process.argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 1);
const REPEATS = Number(process.argv.find((a) => a.startsWith('--repeats='))?.split('=')[1] ?? 2);
// gl и id блока параметризованы после того, как блок F был снят: дефолты сохраняют
// в точности то поведение, которым получен F (см. results/decisions.md п. 17 и 19).
const GL = process.argv.find((a) => a.startsWith('--gl='))?.split('=')[1] ?? 'swangle';
const BLOCK_ID = process.argv.find((a) => a.startsWith('--block='))?.split('=')[1] ?? 'F';
const profile = 'final';

const block = {
  id: BLOCK_ID,
  title: `PNG-сиквенс без энкода, gl=${GL}, concurrency ${CONCURRENCY}: детерминирован ли Chrome сам по себе`,
  configText: `renderFrames(imageFormat=png), профиль ${profile} (scale ${PROFILES[profile].scale}), gl=${GL}, concurrency=${CONCURRENCY}, ${REPEATS} прогона подряд`,
  kind: 'png-repeat',
  runs: [],
  comparisons: [],
  verdict: 'в процессе',
  notes: [],
};
doc.blocks = (doc.blocks ?? []).filter((b) => b.id !== BLOCK_ID);
doc.blocks.push(block);
flush();

const dirs = [];
for (let i = 1; i <= REPEATS; i++) {
  const runId = `det-${BLOCK_ID}-png-${GL}-c${CONCURRENCY}-r${i}`;
  const framesOutDir = path.join(OUT, `frames-${BLOCK_ID}-r${i}`);
  console.log(`▶ ${runId}`);
  const r = await runRunner({
    runId,
    gl: GL,
    concurrency: CONCURRENCY,
    profile,
    mode: 'frames',
    bundleMode: 'warm',
    framesOutDir,
    resultPath: path.join(OUT, `${runId}.json`),
  });
  if (r.code !== 0) {
    block.runs.push({runId, status: 'FAILED', commandLine: r.commandLine, stderr: r.stderr});
    block.verdict = 'FAILED — прогон не состоялся';
    flush();
    process.exit(1);
  }
  const h = hashPngDir(framesOutDir);
  const md5Path = path.join(MD5, `${runId}.framemd5`);
  const fm = await framemd5(path.join(framesOutDir, '*.png'), md5Path, {extraInputArgs: ['-framerate', '30', '-pattern_type', 'glob']});
  dirs.push({runId, framesOutDir, hash: h, framemd5File: path.relative(ROOT, md5Path)});
  block.runs.push({
    runId,
    status: 'OK',
    commandLine: r.commandLine,
    wallMs: r.wallMs,
    peakRssSumMb: r.memory.peakRssSumMb,
    pngCount: h.count,
    pngDirHash: h.dirHash,
    framemd5: {...fm, file: path.relative(ROOT, md5Path)},
  });
  console.log(`  ${runId}: ${h.count} PNG, dirHash=${h.dirHash.slice(0, 16)}`);
  flush();
}

for (let i = 1; i < dirs.length; i++) {
  const n = Math.min(dirs[0].hash.perFile.length, dirs[i].hash.perFile.length);
  let firstDiff = null;
  let differing = 0;
  for (let k = 0; k < n; k++) {
    if (dirs[0].hash.perFile[k].sha256 !== dirs[i].hash.perFile[k].sha256) {
      differing += 1;
      if (firstDiff === null) firstDiff = k;
    }
  }
  const cmp = compareFramemd5(path.join(ROOT, dirs[0].framemd5File), path.join(ROOT, dirs[i].framemd5File));
  const psnr = firstDiff === null ? null : await psnrBetweenPngDirs(dirs[0].framesOutDir, dirs[i].framesOutDir, path.join(OUT, 'det-F.psnr'));
  block.comparisons.push({
    a: dirs[0].runId,
    b: dirs[i].runId,
    pngBytesEqual: firstDiff === null,
    firstDiffPngIndex: firstDiff,
    differingPngCount: differing,
    totalPng: n,
    framemd5Equal: cmp.equal,
    firstDiffFrame: cmp.firstDiffFrame,
    psnr,
    verdict: firstDiff === null ? 'совпало' : `разошлось на кадре ${firstDiff}`,
  });
}
const allEqual = block.comparisons.every((c) => c.pngBytesEqual && c.framemd5Equal);
block.verdict = allEqual
  ? `совпало (${dirs.length} прогона × ${dirs[0].hash.count} PNG побайтово идентичны при gl=${GL}, concurrency ${CONCURRENCY})`
  : `разошлось на кадре ${block.comparisons.find((c) => !c.pngBytesEqual)?.firstDiffPngIndex}`;
block.table = [
  '| прогон | PNG | dirHash | sha256(framemd5) |',
  '|---|---|---|---|',
  ...block.runs.filter((r) => r.status === 'OK').map((r) => `| ${r.runId} | ${r.pngCount} | \`${r.pngDirHash.slice(0, 16)}\` | \`${r.framemd5.sha256.slice(0, 16)}\` |`),
];
doc.stateAtEndF = snapshotState();
flush();
for (const d of dirs) fs.rmSync(d.framesOutDir, {recursive: true, force: true});
console.log(`${BLOCK_ID}. ${block.title}: ${block.verdict}`);
