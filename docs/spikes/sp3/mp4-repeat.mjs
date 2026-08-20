/**
 * SP-3, блок H: повторяемость ГОТОВОГО mp4 на gl=angle.
 *
 * Зачем отдельным файлом — та же причина, что у png-c1-repeat.mjs (decisions.md п. 17):
 * блоки A–E были уже сняты, когда блок G показал, что на `angle` кадры совпадают побайтово,
 * а `swangle` — нет. Это переворачивает предпосылку ADR-0008 («swangle ради детерминизма»),
 * и проверить её нужно на том, что реально уходит в публикацию, — на mp4, а не на PNG.
 *
 * Результат дописывается в results/raw/determinism.json как блок H.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {framemd5, compareFramemd5, ffprobe, keyframes, psnrBetweenFiles, psnrDistribution, sha256File} from './lib/media.mjs';
import {PROFILES} from './lib/profiles.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {ROOT, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
const DOC = path.join(RAW, 'determinism.json');

const flag = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt;
const GL = flag('gl', 'angle');
const CONCURRENCY = Number(flag('concurrency', '4'));
const PROFILE = flag('profile', 'final');
const REPEATS = Number(flag('repeats', '3'));
const BLOCK_ID = flag('block', 'H');
// Фоновая нагрузка: детерминизм на простаивающей машине и на занятой — разные утверждения.
// Дефолт 0 сохраняет поведение, которым снят блок H.
const LOAD_WORKERS = Number(flag('load', '0'));

const doc = JSON.parse(fs.readFileSync(DOC, 'utf8'));
const flush = () => {
  fs.writeFileSync(DOC, JSON.stringify(doc, null, 2) + '\n');
  try {
    writeSummary();
  } catch {
    /* пересоберётся позже */
  }
};

const block = {
  id: BLOCK_ID,
  title: `mp4, ${REPEATS} прогона подряд: gl=${GL}, профиль ${PROFILE}, concurrency ${CONCURRENCY}${LOAD_WORKERS ? `, машина занята (${LOAD_WORKERS} фоновых процессов)` : ''}`,
  loadWorkers: LOAD_WORKERS,
  configText: `профиль ${PROFILE} (scale ${PROFILES[PROFILE].scale}, crf ${PROFILES[PROFILE].crf}, imageFormat ${PROFILES[PROFILE].imageFormat}, encoder threads ${PROFILES[PROFILE].encoderThreads}), gl=${GL}, concurrency=${CONCURRENCY}, ${REPEATS} прогона подряд${LOAD_WORKERS ? `, фоновая нагрузка ${LOAD_WORKERS} процессов` : ''}`,
  kind: 'mp4-repeat',
  runs: [],
  comparisons: [],
  verdict: 'в процессе',
  notes: [],
};
doc.blocks = (doc.blocks ?? []).filter((b) => b.id !== BLOCK_ID);
doc.blocks.push(block);
flush();

for (let i = 1; i <= REPEATS; i++) {
  const runId = `det-${BLOCK_ID}-${GL}-${CONCURRENCY}-${PROFILE}-r${i}`;
  const outputPath = path.join(OUT, `${runId}.mp4`);
  const cfg = {
    runId,
    gl: GL,
    concurrency: CONCURRENCY,
    profile: PROFILE,
    mode: 'media',
    bundleMode: 'warm',
    outputPath,
    resultPath: path.join(OUT, `${runId}.json`),
  };
  console.log(`▶ ${runId}${LOAD_WORKERS ? ` (фоновая нагрузка: ${LOAD_WORKERS} процессов)` : ''}`);
  const loaders = [];
  for (let k = 0; k < LOAD_WORKERS; k++) {
    loaders.push(spawn(process.execPath, ['-e', 'let x=0;while(true){x=Math.sqrt(x+1)%7;}'], {stdio: 'ignore'}));
  }
  const t = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit']});
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  const code = await new Promise((r) => child.on('close', r));
  const memory = sampler.stop();
  for (const l of loaders) l.kill('SIGKILL');
  if (code !== 0 || !fs.existsSync(outputPath)) {
    block.runs.push({runId, status: 'FAILED', commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`});
    block.verdict = 'FAILED — прогон не состоялся';
    flush();
    process.exit(1);
  }
  const md5Path = path.join(MD5, `${runId}.framemd5`);
  const fm = await framemd5(outputPath, md5Path);
  block.runs.push({
    runId,
    status: 'OK',
    commandLine: `node runner.mjs '${JSON.stringify(cfg)}'`,
    wallMs: Date.now() - t,
    peakRssSumMb: memory.peakRssSumMb,
    outputSha256: sha256File(outputPath),
    outputBytes: fs.statSync(outputPath).size,
    framemd5: {...fm, file: path.relative(ROOT, md5Path)},
    ffprobe: (await ffprobe(outputPath)).fingerprint,
    keyframes: await keyframes(outputPath),
  });
  console.log(`  ${runId}: sha256(mp4)=${block.runs[i - 1].outputSha256.slice(0, 16)} framemd5=${fm.sha256.slice(0, 16)}`);
  flush();
}

const ok = block.runs.filter((r) => r.status === 'OK');
for (let i = 1; i < ok.length; i++) {
  const cmp = compareFramemd5(path.join(ROOT, ok[0].framemd5.file), path.join(ROOT, ok[i].framemd5.file));
  const entry = {
    a: ok[0].runId,
    b: ok[i].runId,
    framemd5Equal: cmp.equal,
    firstDiffFrame: cmp.firstDiffFrame,
    framesCompared: cmp.framesCompared,
    byteIdenticalMp4: ok[0].outputSha256 === ok[i].outputSha256,
    verdict: cmp.equal ? 'совпало' : `разошлось на кадре ${cmp.firstDiffFrame}`,
  };
  if (!cmp.equal) {
    const psnr = await psnrBetweenFiles(path.join(OUT, `${ok[0].runId}.mp4`), path.join(OUT, `${ok[i].runId}.mp4`), path.join(OUT, `det-${BLOCK_ID}.psnr`));
    entry.distribution = psnrDistribution(psnr.frames);
  }
  block.comparisons.push(entry);
}
const allEqual = block.comparisons.every((c) => c.framemd5Equal);
const allBytes = block.comparisons.every((c) => c.byteIdenticalMp4);
block.verdict = allEqual
  ? `совпало (${ok.length} прогона, ${block.comparisons[0]?.framesCompared ?? 0} кадров, декодированные кадры идентичны)`
  : `разошлось на кадре ${block.comparisons.find((c) => !c.framemd5Equal)?.firstDiffFrame}`;
block.notes.push(`побайтовое равенство самих mp4: ${allBytes ? 'да' : 'нет'}`);
block.table = [
  '| прогон | wall, с | sha256(mp4) | sha256(framemd5) |',
  '|---|---|---|---|',
  ...ok.map((r) => `| ${r.runId} | ${(r.wallMs / 1000).toFixed(1)} | \`${r.outputSha256.slice(0, 16)}\` | \`${r.framemd5.sha256.slice(0, 16)}\` |`),
];
doc[`stateAtEnd${BLOCK_ID}`] = snapshotState();
flush();
console.log(`${BLOCK_ID}. ${block.title}: ${block.verdict}`);
