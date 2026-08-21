/**
 * SP-3d: парный ЛОКАЛЬНЫЙ прогон (без Docker), софтверный путь `--no-browser-gpu`.
 *
 * Зачем он в спайке про Docker. Числа SP-3c блока B сняты ночью на простаивающей
 * машине; SP-3d идёт днём, и хост занят посторонней работой владельца (loadavg 18–92,
 * см. decisions). Сравнивать «Docker сегодня» с «локально ночью» нечестно: разница
 * будет разницей загрузки хоста, а не режима. Поэтому локальный софтверный путь
 * снимается ЗДЕСЬ ЖЕ, в тех же условиях, тем же прибором.
 *
 * Числа SP-3c при этом не пересматриваются и не пересчитываются: они приводятся в
 * отчёте как есть, отдельной колонкой.
 *
 * Аргументы CLI строит `hfArgs` из sp3c/lib/hfprofiles.mjs — импортом, без копии.
 * SP-3c при этом не меняется: результат пишется в sp3d/results/raw.
 */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, HF_CLI, BIN, childEnv, SP3C} from './lib/env.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
import {hfArgs, HF_PROFILES} from '../sp3c/lib/hfprofiles.mjs';
import {getVersions} from '../sp3c/lib/versions.mjs';
import {startMemorySampler} from '../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const T0 = Date.now();

const result = {
  schema: 'sp3d-local-run/1',
  runId: cfg.runId,
  renderer: 'hyperframes',
  mode: 'local',
  status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {
    profile: cfg.profile,
    workers: cfg.workers,
    gpu: cfg.gpu ?? 'sw',
    project: cfg.project ?? HF_PROFILES[cfg.profile].project,
    outputPath: cfg.outputPath,
    profileParams: HF_PROFILES[cfg.profile],
    cpuLoadProcesses: cfg.cpuLoad ?? 0,
    frames: cfg.frames ?? 300,
  },
  versions: getVersions(),
  stateAtStart: snapshotState(),
  timings: {nodeBootMs: Math.round(T0 - performance.timeOrigin)},
  trace: [],
};
const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const parseTrace = (log) => {
  const out = [];
  for (const line of stripAnsi(log).split('\n')) {
    const m = line.match(/\[Render:trace\]\s+(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const d = JSON.parse(m[1]);
      delete d.renderJobId;
      out.push(d);
    } catch {
      /* строка обрезана буфером */
    }
  }
  return out;
};
const findPhase = (trace, phase, status) => trace.find((t) => t.phase === phase && t.status === status);
const dirHash = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  const h = crypto.createHash('sha256');
  const per = [];
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const fh = crypto.createHash('sha256').update(buf).digest('hex');
    h.update(f).update('\0').update(fh).update('\0');
    per.push({file: f, sha256: fh, bytes: buf.length});
    bytes += buf.length;
  }
  return {dirHash: h.digest('hex'), fileCount: files.length, totalBytes: bytes, files: per};
};

const startCpuLoad = (n) => {
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(spawn(process.execPath, ['-e', 'let x=0;for(;;){x=(x+1)%1e9;Math.sqrt(x);}'], {stdio: 'ignore'}));
  return () => kids.forEach((k) => k.kill('SIGKILL'));
};
const stopLoad = cfg.cpuLoad ? startCpuLoad(cfg.cpuLoad) : null;

try {
  const isPng = HF_PROFILES[cfg.profile].format === 'png-sequence';
  const args = hfArgs({
    profile: cfg.profile,
    workers: cfg.workers,
    gpu: cfg.gpu ?? 'sw',
    outputPath: cfg.outputPath,
    // hfArgs подставит project из профиля; композиции лежат в SP-3c, а cwd тоже SP-3C
    project: cfg.project ? path.join(SP3C, cfg.project) : path.join(SP3C, HF_PROFILES[cfg.profile].project),
  });
  result.commandLine = `hyperframes ${args.join(' ')}`;
  write();
  if (isPng) fs.rmSync(cfg.outputPath, {recursive: true, force: true});
  else fs.rmSync(cfg.outputPath, {force: true});

  const tSpawn = Date.now();
  const child = spawn(process.execPath, [HF_CLI, ...args], {cwd: SP3C, env: childEnv(cfg.env ?? {}), stdio: ['ignore', 'pipe', 'pipe']});
  const sampler = startMemorySampler(process.pid, {intervalMs: 200});
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  const exitCode = await new Promise((r) => {
    child.on('close', (c) => r(c));
    child.on('error', () => r(-1));
  });
  const cliWallMs = Date.now() - tSpawn;
  result.memory = sampler.stop();
  const trace = parseTrace(log);
  result.trace = trace;
  result.cliExitCode = exitCode;

  const capStart = findPhase(trace, 'capture_streaming', 'start') ?? findPhase(trace, 'capture_disk', 'start') ?? findPhase(trace, 'capture', 'start');
  const capEnd = findPhase(trace, 'capture_streaming', 'end') ?? findPhase(trace, 'capture_disk', 'end') ?? findPhase(trace, 'capture', 'end');
  const encEnd = findPhase(trace, 'encode', 'end');
  const asmEnd = findPhase(trace, 'assemble', 'end');
  const pipelineDone = trace.filter((t) => t.phase === 'pipeline' && t.status === 'checkpoint').at(-1);
  const captureMs = capEnd?.durationMs ?? null;
  const toCaptureMs = capStart?.elapsedMs ?? null;
  const pipelineMs = pipelineDone?.totalElapsedMs ?? asmEnd?.elapsedMs ?? null;
  const renderPhaseMs = pipelineMs !== null && toCaptureMs !== null ? pipelineMs - toCaptureMs : null;
  result.timings = {
    ...result.timings,
    cliWallMs,
    pipelineMs,
    toCaptureStartMs: toCaptureMs,
    captureMs,
    encodeMs: encEnd?.durationMs ?? null,
    renderPhaseMs,
    assembleMs: asmEnd?.durationMs ?? null,
    preRenderOverheadMs: pipelineMs !== null && toCaptureMs !== null ? cliWallMs - pipelineMs + toCaptureMs : null,
    postPipelineMs: pipelineMs !== null ? cliWallMs - pipelineMs : null,
  };
  result.captureMode = capStart?.captureMode ?? capEnd?.captureMode ?? null;
  result.browserLaunchLine = (stripAnsi(log).match(/\[BrowserManager\] Browser launched \(.*\)/) ?? [null])[0];
  result.logTail = stripAnsi(log).split('\n').filter((l) => !/Streaming frame|Capturing frame|^\s*[█░]/.test(l)).slice(-20).join('\n');

  const produced = isPng ? fs.existsSync(cfg.outputPath) && fs.statSync(cfg.outputPath).isDirectory() : fs.existsSync(cfg.outputPath);
  if (exitCode !== 0 || !produced) {
    result.status = 'FAILED';
    result.error = {message: `hyperframes вышел с кодом ${exitCode}, выход ${produced ? 'есть' : 'отсутствует'}`, logTail: result.logTail};
    process.exitCode = 1;
  } else {
    const md5Path = path.join(ROOT, 'results/framemd5', `${cfg.runId}.framemd5`);
    if (isPng) {
      const dh = dirHash(cfg.outputPath);
      const first = dh.files[0]?.file ?? '';
      const pattern = first.replace(/\d+/, (m) => `%0${m.length}d`);
      result.verification = {
        dirHash: dh.dirHash,
        fileCount: dh.fileCount,
        totalBytes: dh.totalBytes,
        perFile: dh.files,
        framemd5: await framemd5(path.join(cfg.outputPath, pattern), md5Path, {extraInputArgs: ['-framerate', '30', '-start_number', String(Number((first.match(/\d+/) ?? ['0'])[0]))]}),
      };
    } else {
      result.verification = {
        framemd5: await framemd5(cfg.outputPath, md5Path),
        ffprobe: await ffprobe(cfg.outputPath),
        keyframes: await keyframes(cfg.outputPath),
        outputSha256: sha256File(cfg.outputPath),
        outputBytes: fs.statSync(cfg.outputPath).size,
      };
    }
    result.verification.framemd5.file = path.relative(ROOT, md5Path);
    const frames = cfg.frames ?? 300;
    const per = (ms) => (ms && ms > 0 ? Math.round((frames / (ms / 1000)) * 1000) / 1000 : null);
    result.derived = {
      frames,
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
} finally {
  stopLoad?.();
}
