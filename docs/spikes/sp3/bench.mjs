/**
 * SP-3: матрица замеров бюджета кадров (ADR-0008 «Бюджет AC2»).
 *
 * Матрица: gl {swangle, angle} × concurrency {1,2,4} × профиль {final, draft} = 12 прогонов.
 * Каждый прогон — отдельный процесс (так меряется реальный оверхед старта процесса и Chrome
 * на сегмент), память снимается снаружи по дереву процессов.
 *
 * Результаты дописываются ПОСЛЕ КАЖДОГО прогона:
 *   results/raw/<gl>-<concurrency>-<profile>.json  — все числа прогона
 *   results/framemd5/<...>.framemd5                — покадровые md5
 *   results/progress.jsonl                         — append-only журнал
 *   results/summary.md                             — пересобирается из raw после каждого прогона
 * Обрыв на середине не теряет уже сделанное.
 *
 * Аргументы: --gl=swangle,angle --concurrency=1,2,4 --profile=final,draft --timeout=1500
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {startMemorySampler} from './lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from './lib/media.mjs';
import {ROOT, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const GLS = arg('gl', 'swangle,angle').split(',');
const CONCURRENCIES = arg('concurrency', '1,2,4').split(',').map(Number);
const PROFILES_LIST = arg('profile', 'final,draft').split(',');
const RUN_TIMEOUT_MS = Number(arg('timeout', '1500')) * 1000;
const KEEP_MP4 = arg('keep', 'yes') === 'yes';

const RAW_DIR = path.join(ROOT, 'results/raw');
const MD5_DIR = path.join(ROOT, 'results/framemd5');
const OUT_DIR = path.join(ROOT, 'out');
const PROGRESS = path.join(ROOT, 'results/progress.jsonl');
for (const d of [RAW_DIR, MD5_DIR, OUT_DIR]) fs.mkdirSync(d, {recursive: true});

const appendProgress = (obj) =>
  fs.appendFileSync(PROGRESS, JSON.stringify({at: new Date().toISOString(), ...obj}) + '\n');

const bundleInfo = (() => {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'bundle.json'), 'utf8'));
    return b.summary ?? null;
  } catch {
    return null;
  }
})();

const runOne = async ({gl, concurrency, profile}) => {
  const runId = `${gl}-${concurrency}-${profile}`;
  const resultPath = path.join(RAW_DIR, `${runId}.json`);
  const outputPath = path.join(OUT_DIR, `${runId}.mp4`);
  fs.rmSync(outputPath, {force: true});

  const cfg = {
    runId,
    gl,
    concurrency,
    profile,
    mode: 'media',
    bundleMode: 'warm',
    outputPath,
    resultPath,
  };
  const argv = [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)];
  const commandLine = `node runner.mjs '${JSON.stringify(cfg)}'`;

  console.log(`\n▶ ${runId}`);
  const tSpawn = Date.now();
  const child = spawn(process.execPath, argv, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  const sampler = startMemorySampler(child.pid, {intervalMs: 200});
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  child.stdout.on('data', () => {});

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, RUN_TIMEOUT_MS);

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });
  clearTimeout(timer);
  const wallMs = Date.now() - tSpawn;
  const memory = sampler.stop();

  let record;
  try {
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    record = {runId, status: 'FAILED', error: {message: 'runner не записал результат'}};
  }

  record.schema = 'sp3-run/1';
  record.commandLine = commandLine;
  record.externalTimings = {wallMsIncludingProcessSpawn: wallMs, exitCode, timedOut};
  record.memory = memory;
  record.bundleReference = bundleInfo;
  record.hostStateAfter = snapshotState();
  if (timedOut) {
    record.status = 'FAILED';
    record.error = {message: `прогон превысил таймаут ${RUN_TIMEOUT_MS} ms`};
  } else if (exitCode !== 0 && record.status !== 'FAILED') {
    record.status = 'FAILED';
    record.error = {message: `runner вышел с кодом ${exitCode}`, stderr: stderr.slice(-4000)};
  }
  if (stderr.trim()) record.stderrTail = stderr.slice(-2000);

  // Проверки над готовым сегментом: их стоимость — часть бюджета AC2.
  if (record.status === 'OK' && fs.existsSync(outputPath)) {
    const md5Path = path.join(MD5_DIR, `${runId}.framemd5`);
    record.verification = {
      framemd5: await framemd5(outputPath, md5Path),
      ffprobe: await ffprobe(outputPath),
      keyframes: await keyframes(outputPath),
      outputSha256: sha256File(outputPath),
      outputBytes: fs.statSync(outputPath).size,
    };
    record.verification.framemd5.file = path.relative(ROOT, md5Path);
  }

  // Полная сумма секунды-в-секунду: прогон + проверки.
  const frames = record.render?.frameCount ?? null;
  if (record.status === 'OK' && frames) {
    const verifyMs = (record.verification?.framemd5.ms ?? 0) + (record.verification?.ffprobe.ms ?? 0);
    record.derived = {
      framesPerSecond_endToEnd: Math.round((frames / (wallMs / 1000)) * 1000) / 1000,
      framesPerSecond_renderPhase: record.render.fps.renderPhase,
      framesPerSecond_framesOnly: record.render.fps.framesOnly,
      wallTimeSec: Math.round(wallMs) / 1000,
      verifyCostMs: verifyMs,
      framesPerSecond_withVerification:
        Math.round((frames / ((wallMs + verifyMs) / 1000)) * 1000) / 1000,
      // Экстраполяция на AC2: 1800 кадров (60 c при 30 fps) одним куском.
      ac2ProjectedMinutes_renderPhase:
        record.render.fps.renderPhase ? Math.round((1800 / record.render.fps.renderPhase / 60) * 100) / 100 : null,
      ac2ProjectedMinutes_endToEnd: Math.round((1800 / (frames / (wallMs / 1000)) / 60) * 100) / 100,
    };
  }

  fs.writeFileSync(resultPath, JSON.stringify(record, null, 2) + '\n');
  if (!KEEP_MP4) fs.rmSync(outputPath, {force: true});

  appendProgress({
    runId,
    status: record.status,
    wallMs,
    fps: record.derived?.framesPerSecond_renderPhase ?? null,
    peakRssMb: memory.peakRssSumMb,
    error: record.error?.message ?? null,
  });

  const line =
    record.status === 'OK'
      ? `✓ ${runId}: ${record.derived.framesPerSecond_renderPhase} кадр/с (фаза рендера), ` +
        `${record.derived.framesPerSecond_endToEnd} кадр/с (весь процесс), wall ${record.derived.wallTimeSec} c, ` +
        `пик RSS ${memory.peakRssSumMb} МБ (Pss ${memory.peakPssSumMb} МБ)`
      : `✗ ${runId}: FAILED — ${record.error?.message}`;
  console.log(line);
  return record;
};

const main = async () => {
  appendProgress({event: 'bench-start', gls: GLS, concurrencies: CONCURRENCIES, profiles: PROFILES_LIST});
  for (const profile of PROFILES_LIST) {
    for (const gl of GLS) {
      for (const concurrency of CONCURRENCIES) {
        await runOne({gl, concurrency, profile});
        writeSummary(); // сводка пересобирается после каждого прогона
      }
    }
  }
  appendProgress({event: 'bench-done'});
  writeSummary();
  console.log(`\nГотово. Сводка: ${path.relative(ROOT, path.join(ROOT, 'results/summary.md'))}`);
};

await main();
