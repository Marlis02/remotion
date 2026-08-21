/**
 * SP-3f: ОДИН прогон HyperFrames в отдельном процессе.
 * Прямая адаптация sp3c/run-one.mjs: тот же разбор трассы, те же три числа
 * скорости, те же приборы SP-3. Отличия — путь к композиции (src/hyperframes)
 * и id композиции `motion`.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, HF_CLI, BIN, childEnv} from './lib/env.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;
import {startMemorySampler} from '../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const T0 = Date.now();
const FRAMES = Number(cfg.frames ?? 450);

const result = {
  schema: 'sp3f-run/1', runId: cfg.runId, renderer: 'hyperframes', status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {profile: cfg.profile ?? 'final', frames: FRAMES, workers: cfg.workers, gpu: cfg.gpu ?? 'sw', project: cfg.project ?? 'src', outputPath: cfg.outputPath},
  stateAtStart: snapshotState(), timings: {}, trace: [], warnings: [],
};
const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const parseTrace = (log) => {
  const out = [];
  for (const line of stripAnsi(log).split('\n')) {
    const m = line.match(/\[Render:trace\]\s+(\{.*\})\s*$/);
    if (!m) continue;
    try { const d = JSON.parse(m[1]); delete d.renderJobId; out.push(d); } catch { /* обрезано буфером */ }
  }
  return out;
};
const findPhase = (t, phase, status) => t.find((x) => x.phase === phase && x.status === status);

try {
  // Профиль final SP-3c: quality standard (= libx264 preset medium, crf 18), mp4, fps 30.
  const args = ['render', cfg.project ?? 'src', '-o', cfg.outputPath, '--workers', String(cfg.workers),
    '--quality', 'standard', '--format', 'mp4', '--fps', '30'];
  if (cfg.crf) args.push('--crf', String(cfg.crf));
  if ((cfg.gpu ?? 'sw') === 'sw') args.push('--no-browser-gpu'); else args.push('--browser-gpu');
  args.push('--quiet');
  result.commandLine = `hyperframes ${args.join(' ')}`;
  fs.rmSync(cfg.outputPath, {force: true});
  write();

  const tSpawn = Date.now();
  const child = spawn(process.execPath, [HF_CLI, ...args], {cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe']});
  const sampler = startMemorySampler(process.pid, {intervalMs: 200});
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  const exitCode = await new Promise((r) => { child.on('close', r); child.on('error', () => r(-1)); });
  const cliWallMs = Date.now() - tSpawn;
  result.memory = sampler.stop();
  result.cliExitCode = exitCode;

  const trace = parseTrace(log);
  result.trace = trace;
  const capStart = findPhase(trace, 'capture_streaming', 'start') ?? findPhase(trace, 'capture_disk', 'start') ?? findPhase(trace, 'capture_parallel', 'start') ?? findPhase(trace, 'capture', 'start');
  const capEnd = findPhase(trace, 'capture_streaming', 'end') ?? findPhase(trace, 'capture_disk', 'end') ?? findPhase(trace, 'capture_parallel', 'end') ?? findPhase(trace, 'capture', 'end');
  const encEnd = findPhase(trace, 'encode', 'end');
  const asmEnd = findPhase(trace, 'assemble', 'end');
  const pipelineDone = trace.filter((t) => t.phase === 'pipeline' && t.status === 'checkpoint').at(-1);
  const captureMs = capEnd?.durationMs ?? null;
  const toCaptureMs = capStart?.elapsedMs ?? null;
  const pipelineMs = pipelineDone?.totalElapsedMs ?? asmEnd?.elapsedMs ?? null;
  const renderPhaseMs = pipelineMs !== null && toCaptureMs !== null ? pipelineMs - toCaptureMs : null;
  result.timings = {cliWallMs, pipelineMs, toCaptureStartMs: toCaptureMs, captureMs, encodeMs: encEnd?.durationMs ?? null,
    renderPhaseMs, preRenderOverheadMs: pipelineMs !== null && toCaptureMs !== null ? cliWallMs - pipelineMs + toCaptureMs : null};
  result.captureMode = capStart?.captureMode ?? capEnd?.captureMode ?? null;
  result.workerCount = capEnd?.workerCount ?? capStart?.workerCount ?? null;
  result.forceScreenshot = capEnd?.forceScreenshot ?? null;
  result.browserLaunchLine = (stripAnsi(log).match(/\[BrowserManager\] Browser launched \(.*\)/) ?? [null])[0];
  result.logTail = stripAnsi(log).split('\n').filter((l) => !/Streaming frame|^\s*[█░]/.test(l)).slice(-20).join('\n');
  write();

  if (exitCode !== 0 || !fs.existsSync(cfg.outputPath)) {
    result.status = 'FAILED';
    result.error = {message: `hyperframes вышел с кодом ${exitCode}`};
  } else {
    const md5Path = path.join(ROOT, 'results/framemd5', `${cfg.runId}.framemd5`);
    result.verification = {
      framemd5: await framemd5(cfg.outputPath, md5Path),
      ffprobe: await ffprobe(cfg.outputPath),
      keyframes: await keyframes(cfg.outputPath),
      outputSha256: sha256File(cfg.outputPath),
      outputBytes: fs.statSync(cfg.outputPath).size,
    };
    result.verification.framemd5.file = path.relative(ROOT, md5Path);
    const per = (ms) => (ms && ms > 0 ? Math.round((FRAMES / (ms / 1000)) * 1000) / 1000 : null);
    result.derived = {
      frames: FRAMES,
      framesPerSecond_framesOnly: per(captureMs),
      framesPerSecond_renderPhase: per(renderPhaseMs),
      framesPerSecond_endToEnd: per(cliWallMs),
      wallTimeSec: Math.round(cliWallMs) / 1000,
    };
    result.status = 'OK';
  }
  result.stateAtEnd = snapshotState();
  result.finishedAt = new Date().toISOString();
  write();
} catch (err) {
  result.status = 'FAILED';
  result.error = {message: String(err?.message ?? err), stack: String(err?.stack ?? '')};
  result.finishedAt = new Date().toISOString();
  write();
  process.exitCode = 1;
}
