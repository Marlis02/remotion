/**
 * SP-3: два добавочных прогона, которых нет в матрице задания, но которые
 * требует core.md §16 («framemd5 при concurrency 1/2/4/8», «два прогона под нагрузкой CPU»).
 *
 *   extra-concurrency8  — final/swangle/concurrency=8: есть ли ещё масштабирование за 4.
 *   extra-cpuload       — final/swangle/concurrency=4 при занятых N ядрах: что делает нагрузка
 *                         с кадрами/с и — главное — с framemd5 (детерминизм под нагрузкой).
 *
 * Логика запуска повторяет bench.mjs намеренно: bench.mjs в момент написания этого файла
 * уже крутил матрицу, и править работающий скрипт ради переиспользования 40 строк —
 * плохой размен для спайка.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {framemd5, ffprobe, keyframes, sha256File} from './lib/media.mjs';
import {startMemorySampler} from './lib/proctree.mjs';
import {ROOT, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});
const PROGRESS = path.join(ROOT, 'results/progress.jsonl');

const appendProgress = (obj) =>
  fs.appendFileSync(PROGRESS, JSON.stringify({at: new Date().toISOString(), ...obj}) + '\n');

const bundleInfo = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAW, 'bundle.json'), 'utf8')).summary ?? null;
  } catch {
    return null;
  }
})();

const runOne = async ({runId, gl, concurrency, profile, loadWorkers = 0, note}) => {
  const resultPath = path.join(RAW, `${runId}.json`);
  const outputPath = path.join(OUT, `${runId}.mp4`);
  fs.rmSync(outputPath, {force: true});
  const cfg = {runId, gl, concurrency, profile, mode: 'media', bundleMode: 'warm', outputPath, resultPath};

  // Фоновая нагрузка: занятые ядра, как при обычной работе на ноутбуке.
  const loaders = [];
  for (let i = 0; i < loadWorkers; i++) {
    loaders.push(spawn(process.execPath, ['-e', 'const t=Date.now();let x=0;while(true){x=Math.sqrt(x+1)%7;}'], {stdio: 'ignore'}));
  }

  console.log(`\n▶ ${runId}${loadWorkers ? ` (фоновая нагрузка: ${loadWorkers} процессов)` : ''}`);
  const t = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  const code = await new Promise((r) => child.on('close', r));
  const wallMs = Date.now() - t;
  const memory = sampler.stop();
  for (const l of loaders) l.kill('SIGKILL');

  let record;
  try {
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    record = {runId, status: 'FAILED', error: {message: 'runner не записал результат'}};
  }
  record.schema = 'sp3-run/1';
  record.commandLine = `node runner.mjs '${JSON.stringify(cfg)}'`;
  record.externalTimings = {wallMsIncludingProcessSpawn: wallMs, exitCode: code, timedOut: false};
  record.memory = memory;
  record.bundleReference = bundleInfo;
  record.hostStateAfter = snapshotState();
  record.extra = {note, loadWorkers};
  if (code !== 0 && record.status !== 'FAILED') {
    record.status = 'FAILED';
    record.error = {message: `runner вышел с кодом ${code}`, stderr: stderr.slice(-4000)};
  }
  if (record.status === 'OK' && fs.existsSync(outputPath)) {
    const md5Path = path.join(MD5, `${runId}.framemd5`);
    record.verification = {
      framemd5: await framemd5(outputPath, md5Path),
      ffprobe: await ffprobe(outputPath),
      keyframes: await keyframes(outputPath),
      outputSha256: sha256File(outputPath),
      outputBytes: fs.statSync(outputPath).size,
    };
    record.verification.framemd5.file = path.relative(ROOT, md5Path);
    const frames = record.render.frameCount;
    const verifyMs = record.verification.framemd5.ms + record.verification.ffprobe.ms;
    record.derived = {
      framesPerSecond_endToEnd: Math.round((frames / (wallMs / 1000)) * 1000) / 1000,
      framesPerSecond_renderPhase: record.render.fps.renderPhase,
      framesPerSecond_framesOnly: record.render.fps.framesOnly,
      wallTimeSec: wallMs / 1000,
      verifyCostMs: verifyMs,
      ac2ProjectedMinutes_renderPhase: Math.round((1800 / record.render.fps.renderPhase / 60) * 100) / 100,
      ac2ProjectedMinutes_endToEnd: Math.round((1800 / (frames / (wallMs / 1000)) / 60) * 100) / 100,
    };
  }
  fs.writeFileSync(resultPath, JSON.stringify(record, null, 2) + '\n');
  appendProgress({runId, status: record.status, wallMs, fps: record.derived?.framesPerSecond_renderPhase ?? null, peakRssMb: memory.peakRssSumMb, note});
  console.log(
    record.status === 'OK'
      ? `✓ ${runId}: ${record.derived.framesPerSecond_renderPhase} кадр/с, wall ${record.derived.wallTimeSec.toFixed(1)} c, пик RSS ${memory.peakRssSumMb} МБ`
      : `✗ ${runId}: FAILED — ${record.error?.message}`,
  );
  return record;
};

await runOne({
  runId: 'extra-concurrency8',
  gl: 'swangle',
  concurrency: 8,
  profile: 'final',
  note: 'core.md §16 требует concurrency 8; в матрице задания его нет',
});
writeSummary();

await runOne({
  runId: 'extra-cpuload',
  gl: 'swangle',
  concurrency: 4,
  profile: 'final',
  loadWorkers: 6,
  note: 'core.md §16: прогон под нагрузкой CPU (6 занятых потоков из 12)',
});
writeSummary();
console.log('\nДобавочные прогоны записаны.');
