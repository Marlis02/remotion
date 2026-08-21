/**
 * SP-3c: драйвер матрицы прогонов.
 *
 * Каждый прогон — отдельный процесс run-one.mjs со своим таймаутом. Упавший прогон
 * записывается и НЕ останавливает матрицу (требование ночного режима). После каждого
 * прогона дописывается results/progress.jsonl, чтобы обрыв не терял сделанное.
 *
 * Использование: node matrix.mjs jobs/<файл>.json [--only=<подстрока runId>]
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const jobsFile = process.argv[2];
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((j) => !only || j.runId.includes(only));

const RAW = path.join(ROOT, 'results/raw');
const MD5 = path.join(ROOT, 'results/framemd5');
const OUT = path.join(ROOT, 'out');
for (const d of [RAW, MD5, OUT]) fs.mkdirSync(d, {recursive: true});
const PROGRESS = path.join(ROOT, 'results/progress.jsonl');
const append = (o) => fs.appendFileSync(PROGRESS, JSON.stringify({at: new Date().toISOString(), ...o}) + '\n');

append({event: 'matrix-start', jobsFile: path.basename(jobsFile), jobs: jobs.length});
console.log(`Матрица: ${jobs.length} прогонов из ${path.basename(jobsFile)}`);

let ok = 0;
let failed = 0;
for (const [i, job] of jobs.entries()) {
  const resultPath = path.join(RAW, `${job.runId}.json`);
  if (job.skipIfDone && fs.existsSync(resultPath)) {
    try {
      if (JSON.parse(fs.readFileSync(resultPath, 'utf8')).status === 'OK') {
        console.log(`↷ ${job.runId}: уже снят, пропуск`);
        ok += 1;
        continue;
      }
    } catch {
      /* битый файл — перезаписываем прогоном */
    }
  }
  const cfg = {...job, resultPath};
  const timeoutMs = (job.timeoutSec ?? 600) * 1000;
  const t = Date.now();
  process.stdout.write(`▶ [${i + 1}/${jobs.length}] ${job.runId} … `);
  append({event: 'run-start', runId: job.runId, profile: job.profile, workers: job.workers, gpu: job.gpu});

  // job.script позволяет прогнать той же машинерией контрольный Remotion
  // (control/runner.mjs), не дублируя драйвер матрицы.
  const script = path.join(ROOT, job.script ?? 'run-one.mjs');
  const child = spawn(process.execPath, [script, JSON.stringify(cfg)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGKILL');
    } catch {
      /* уже умер */
    }
  }, timeoutMs);
  const code = await new Promise((r) => {
    child.on('close', (c) => r(c));
    child.on('error', () => r(-1));
  });
  clearTimeout(timer);
  const wall = Math.round((Date.now() - t) / 100) / 10;

  let rec = null;
  try {
    rec = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    /* run-one не дописал */
  }
  if (timedOut) {
    rec = rec ?? {runId: job.runId, schema: 'sp3c-run/1'};
    rec.status = 'FAILED';
    rec.error = {message: `таймаут ${timeoutMs} ms`};
    fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2) + '\n');
  }
  if (!rec) {
    rec = {runId: job.runId, schema: 'sp3c-run/1', status: 'FAILED', error: {message: `run-one не записал результат (код ${code})`, stderr: stderr.slice(-2000)}};
    fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2) + '\n');
  }
  if (rec.status === 'OK') {
    ok += 1;
    console.log(
      `✓ ${wall} c · ${rec.derived?.framesPerSecond_framesOnly} кадр/с (кадры) · ` +
        `${rec.derived?.framesPerSecond_endToEnd} кадр/с (весь процесс) · RSS ${rec.memory?.peakRssSumMb} МБ · ` +
        `${rec.verification?.outputSha256?.slice(0, 16) ?? rec.verification?.dirHash?.slice(0, 16) ?? '—'}`,
    );
  } else {
    failed += 1;
    console.log(`✗ ${wall} c · FAILED — ${rec.error?.message}`);
  }
  append({
    event: 'run-done',
    runId: job.runId,
    status: rec.status,
    wallSec: wall,
    fpsFrames: rec.derived?.framesPerSecond_framesOnly ?? null,
    fpsEndToEnd: rec.derived?.framesPerSecond_endToEnd ?? null,
    peakRssMb: rec.memory?.peakRssSumMb ?? null,
    sha256: rec.verification?.outputSha256 ?? rec.verification?.dirHash ?? null,
    framemd5Sha256: rec.verification?.framemd5?.sha256 ?? null,
    captureMode: rec.captureMode ?? null,
    error: rec.error?.message ?? null,
  });
}
append({event: 'matrix-done', jobsFile: path.basename(jobsFile), ok, failed});
console.log(`\nГотово: ${ok} OK, ${failed} FAILED`);
