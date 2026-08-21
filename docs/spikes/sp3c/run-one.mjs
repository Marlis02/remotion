/**
 * SP-3c: ОДИН прогон HyperFrames в отдельном процессе.
 *
 * Отдельный процесс — по тем же причинам, что в SP-3 runner.mjs: (а) так меряется
 * реальный оверхед старта на сегмент, (б) пик RSS дерева процессов снимается только
 * снаружи, (в) падение прогона не убивает матрицу.
 *
 * Конфиг — JSON-строкой в argv[2], результат пишется в config.resultPath.
 * Приборы — те же, что в SP-3: lib/media.mjs (framemd5, ffprobe, keyframes, sha256),
 * lib/proctree.mjs (RSS дерева), lib/sysinfo.mjs (питание, температура, loadavg).
 * Они импортируются из docs/spikes/sp3/lib и не правятся.
 */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, HF_CLI, BIN, childEnv} from './lib/env.mjs';

// Приборы SP-3 (framemd5/ffprobe) зовут ffmpeg по PATH — на этой машине он только в sp3c/bin.
process.env.PATH = `${BIN}:${process.env.PATH}`;
import {getVersions} from './lib/versions.mjs';
import {hfArgs, HF_PROFILES} from './lib/hfprofiles.mjs';
import {startMemorySampler} from '../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const T0 = Date.now();
const NODE_BOOT_MS = Math.round(T0 - performance.timeOrigin);

const result = {
  schema: 'sp3c-run/1',
  runId: cfg.runId,
  renderer: 'hyperframes',
  status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {
    profile: cfg.profile,
    workers: cfg.workers,
    gpu: cfg.gpu,
    project: cfg.project ?? HF_PROFILES[cfg.profile].project,
    outputPath: cfg.outputPath,
    profileParams: HF_PROFILES[cfg.profile],
    cpuLoadProcesses: cfg.cpuLoad ?? 0,
    envOverrides: cfg.env ?? {},
  },
  versions: getVersions(),
  stateAtStart: snapshotState(),
  timings: {nodeBootMs: NODE_BOOT_MS},
  trace: [],
  warnings: [],
};
const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

/** Фоновая нагрузка CPU — тот же приём, что в SP-3 extra.mjs: N занятых потоков. */
const startCpuLoad = (n) => {
  const kids = [];
  for (let i = 0; i < n; i++) {
    kids.push(
      spawn(process.execPath, ['-e', 'let x=0;for(;;){x=(x+1)%1e9;Math.sqrt(x);}'], {
        stdio: 'ignore',
        detached: false,
      }),
    );
  }
  return () => kids.forEach((k) => k.kill('SIGKILL'));
};

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
      /* строка обрезана буфером — пропускаем, это не измерение */
    }
  }
  return out;
};

const findPhase = (trace, phase, status) => trace.find((t) => t.phase === phase && t.status === status);

/** sha256 каталога PNG: имя+содержимое каждого файла в отсортированном порядке (как dirHash в SP-3). */
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

const stopLoad = cfg.cpuLoad ? startCpuLoad(cfg.cpuLoad) : null;

try {
  const args = hfArgs({
    profile: cfg.profile,
    workers: cfg.workers,
    gpu: cfg.gpu,
    outputPath: cfg.outputPath,
    project: cfg.project,
  });
  result.commandLine = `hyperframes ${args.join(' ')}`;
  write();

  // Выход чистим заранее: иначе «прогон прошёл» может означать «старый файл на месте».
  if (HF_PROFILES[cfg.profile].format === 'png-sequence') {
    fs.rmSync(cfg.outputPath, {recursive: true, force: true});
  } else {
    fs.rmSync(cfg.outputPath, {force: true});
  }

  const tSpawn = Date.now();
  const child = spawn(process.execPath, [HF_CLI, ...args], {
    cwd: ROOT,
    env: childEnv(cfg.env ?? {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sampler = startMemorySampler(process.pid, {intervalMs: 200});
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  const exitCode = await new Promise((r) => {
    child.on('close', (c) => r(c));
    child.on('error', () => r(-1));
  });
  const cliWallMs = Date.now() - tSpawn;
  const memory = sampler.stop();

  const trace = parseTrace(log);
  result.trace = trace;
  result.memory = memory;
  result.cliExitCode = exitCode;

  // Имена фаз зависят от числа воркеров: при workers=1 захват и энкод слиты
  // (capture_streaming), при workers>1 они разделены (capture_disk + encode).
  const capStart =
    findPhase(trace, 'capture_streaming', 'start') ??
    findPhase(trace, 'capture_disk', 'start') ??
    findPhase(trace, 'capture_parallel', 'start') ??
    findPhase(trace, 'capture', 'start');
  const capEnd =
    findPhase(trace, 'capture_streaming', 'end') ??
    findPhase(trace, 'capture_disk', 'end') ??
    findPhase(trace, 'capture_parallel', 'end') ??
    findPhase(trace, 'capture', 'end');
  const encEnd = findPhase(trace, 'encode', 'end');
  const asmEnd = findPhase(trace, 'assemble', 'end');
  const pipelineDone = trace.filter((t) => t.phase === 'pipeline' && t.status === 'checkpoint').at(-1);

  const captureMs = capEnd?.durationMs ?? null;
  const encodeMs = encEnd?.durationMs ?? null;
  const toCaptureMs = capStart?.elapsedMs ?? null;
  const pipelineMs = pipelineDone?.totalElapsedMs ?? asmEnd?.elapsedMs ?? null;
  // Фаза рендера целиком: от старта захвата до конца конвейера (захват + энкод + сборка).
  const renderPhaseMs = pipelineMs !== null && toCaptureMs !== null ? pipelineMs - toCaptureMs : null;

  result.timings = {
    ...result.timings,
    cliWallMs,
    pipelineMs,
    toCaptureStartMs: toCaptureMs,
    captureMs,
    encodeMs,
    renderPhaseMs,
    assembleMs: asmEnd?.durationMs ?? null,
    // Стоимость старта на сегмент: старт node + загрузка CLI + компиляция + проба
    // браузера + файловый сервер + проба GPU. Вход в minSegmentDurationFrames (ADR-0008).
    preRenderOverheadMs:
      pipelineMs !== null && toCaptureMs !== null ? cliWallMs - pipelineMs + toCaptureMs : null,
    // Хвост после конвейера (закрытие процесса, финальные проверки CLI).
    postPipelineMs: pipelineMs !== null ? cliWallMs - pipelineMs : null,
  };
  result.captureMode = capStart?.captureMode ?? capEnd?.captureMode ?? null;
  result.workerCount = capEnd?.workerCount ?? capStart?.workerCount ?? null;
  result.forceScreenshot = capEnd?.forceScreenshot ?? null;
  result.gpuProbe = (stripAnsi(log).match(/browserGpuMode probe → .*/) ?? [null])[0];
  result.browserLaunchLine = (stripAnsi(log).match(/\[BrowserManager\] Browser launched \(.*\)/) ?? [null])[0];
  result.logTail = stripAnsi(log).split('\n').filter((l) => !/Streaming frame|^\s*[█░]/.test(l)).slice(-25).join('\n');
  write();

  const isPng = HF_PROFILES[cfg.profile].format === 'png-sequence';
  const produced = isPng ? fs.existsSync(cfg.outputPath) && fs.statSync(cfg.outputPath).isDirectory() : fs.existsSync(cfg.outputPath);
  if (exitCode !== 0 || !produced) {
    result.status = 'FAILED';
    result.error = {message: `hyperframes вышел с кодом ${exitCode}, выход ${produced ? 'есть' : 'отсутствует'}`};
    write();
    process.exitCode = 1;
  } else {
    // Проверки над готовым сегментом — те же приборы, что в SP-3.
    if (isPng) {
      const dh = dirHash(cfg.outputPath);
      const md5Path = path.join(ROOT, 'results/framemd5', `${cfg.runId}.framemd5`);
      const first = dh.files[0]?.file ?? '';
      const pattern = first.replace(/\d+/, (m) => `%0${m.length}d`);
      result.verification = {
        dirHash: dh.dirHash,
        fileCount: dh.fileCount,
        totalBytes: dh.totalBytes,
        perFile: dh.files,
        framemd5: await framemd5(path.join(cfg.outputPath, pattern), md5Path, {
          extraInputArgs: ['-framerate', '30', '-start_number', String(Number((first.match(/\d+/) ?? ['0'])[0]))],
        }),
      };
      result.verification.framemd5.file = path.relative(ROOT, md5Path);
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
    }

    const frames = 300;
    const per = (ms) => (ms && ms > 0 ? Math.round((frames / (ms / 1000)) * 1000) / 1000 : null);
    result.derived = {
      frames,
      // Три числа скорости — по decisions SP-3 п.1.
      // framesOnly  — только захват кадров (при workers=1 энкод в него вплетён: streaming).
      // renderPhase — захват + энкод + сборка, то есть вся работа после готовности браузера.
      // endToEnd    — весь процесс CLI, включая старт node и компиляцию.
      framesPerSecond_framesOnly: per(captureMs),
      framesPerSecond_renderPhase: per(renderPhaseMs),
      framesPerSecond_endToEnd: per(cliWallMs),
      wallTimeSec: Math.round(cliWallMs) / 1000,
      encodeMs,
      ac2ProjectedMinutes_renderPhase: renderPhaseMs ? Math.round((1800 / (frames / (renderPhaseMs / 1000)) / 60) * 100) / 100 : null,
      ac2ProjectedMinutes_endToEnd: Math.round((1800 / (frames / (cliWallMs / 1000)) / 60) * 100) / 100,
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
