/**
 * SP-3c: прямой замер AC2 — 1800 кадров (60 c) одним сегментом, без экстраполяции.
 * Такого замера в SP-3 не было: там 1800 кадров получались умножением 300.
 * Меряются оба рендерера на одной машине.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, BIN, HF_CLI, childEnv} from './lib/env.mjs';
import {startMemorySampler} from '../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, sha256File} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';
import {getVersions} from './lib/versions.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;

const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(RAW, {recursive: true});

const doc = {
  schema: 'sp3c-long/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  note: '1800 кадров = 60 c при 30 fps, один сегмент. Композиция src-60s: тот же Ken Burns той же формулой на всю длину, страницы субтитров повторены шесть раз со сдвигом.',
  runs: [],
};
const outFile = path.join(RAW, 'long-run.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

const runChild = async (argv, {timeoutMs}) => {
  const t = Date.now();
  const child = spawn(process.execPath, argv, {cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe']});
  const sampler = startMemorySampler(process.pid, {intervalMs: 250});
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  return {code, timedOut, wallMs: Date.now() - t, memory: sampler.stop(), log};
};

const traceOf = (log) => {
  const out = [];
  for (const line of log.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const m = line.match(/\[Render:trace\]\s+(\{.*\})\s*$/);
    if (m) {
      try {
        out.push(JSON.parse(m[1]));
      } catch {
        /* обрезанная строка */
      }
    }
  }
  return out;
};

// 1. HyperFrames, final, workers 4
{
  const outPath = path.join(OUT, 'long-hf-final-w4-gpu.mp4');
  fs.rmSync(outPath, {force: true});
  const state0 = snapshotState();
  const r = await runChild(
    [HF_CLI, 'render', 'src-60s', '-o', outPath, '--workers', '4', '--quality', 'standard', '--format', 'mp4', '--fps', '30', '--browser-gpu', '--quiet'],
    {timeoutMs: 40 * 60 * 1000},
  );
  const tr = traceOf(r.log);
  const cap = tr.find((t) => (t.phase === 'capture_disk' || t.phase === 'capture_streaming') && t.status === 'end');
  const enc = tr.find((t) => t.phase === 'encode' && t.status === 'end');
  const pipe = tr.filter((t) => t.phase === 'pipeline' && t.status === 'checkpoint').at(-1);
  const capStart = tr.find((t) => (t.phase === 'capture_disk' || t.phase === 'capture_streaming') && t.status === 'start');
  const ok = r.code === 0 && fs.existsSync(outPath);
  const rec = {
    runId: 'long-hf-final-w4-gpu',
    renderer: 'hyperframes',
    frames: 1800,
    status: ok ? 'OK' : 'FAILED',
    wallSec: Math.round(r.wallMs) / 1000,
    captureMs: cap?.durationMs ?? null,
    encodeMs: enc?.durationMs ?? null,
    pipelineMs: pipe?.totalElapsedMs ?? null,
    toCaptureStartMs: capStart?.elapsedMs ?? null,
    peakRssMb: r.memory.peakRssSumMb,
    peakPssMb: r.memory.peakPssSumMb,
    stateBefore: state0,
    stateAfter: snapshotState(),
    logTail: r.log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => !/Streaming frame|^\s*[█░]/.test(l)).slice(-12).join('\n'),
  };
  if (ok) {
    rec.sha256 = sha256File(outPath);
    rec.bytes = fs.statSync(outPath).size;
    rec.framemd5 = await framemd5(outPath, path.join(ROOT, 'results/framemd5', 'long-hf-final-w4-gpu.framemd5'));
    rec.ffprobe = await ffprobe(outPath);
    const renderMs = rec.pipelineMs !== null && rec.toCaptureStartMs !== null ? rec.pipelineMs - rec.toCaptureStartMs : null;
    rec.fpsFramesOnly = rec.captureMs ? Math.round((1800 / (rec.captureMs / 1000)) * 1000) / 1000 : null;
    rec.fpsRenderPhase = renderMs ? Math.round((1800 / (renderMs / 1000)) * 1000) / 1000 : null;
    rec.fpsEndToEnd = Math.round((1800 / (r.wallMs / 1000)) * 1000) / 1000;
    rec.ac2Minutes = Math.round((r.wallMs / 1000 / 60) * 100) / 100;
  }
  doc.runs.push(rec);
  flush();
  console.log(`${rec.runId}: ${rec.status}, ${rec.wallSec} c, ${rec.fpsFramesOnly ?? '—'} кадр/с (кадры), RSS ${rec.peakRssMb} МБ`);
}
flush();

// 2. Remotion (контроль), final, concurrency 4, gl=angle — тот же 60-секундный материал.
{
  const outPath = path.join(OUT, 'long-rm-final-c4-angle.mp4');
  fs.rmSync(outPath, {force: true});
  const cfg = {
    runId: 'long-rm-final-c4-angle',
    gl: 'angle',
    concurrency: 4,
    profile: 'final',
    mode: 'media',
    entryOverride: 'control/src60/index.ts',
    outputPath: outPath,
    resultPath: path.join(OUT, 'long-rm-final-c4-angle.runner.json'),
  };
  const r = await runChild([path.join(ROOT, 'control/runner.mjs'), JSON.stringify(cfg)], {timeoutMs: 40 * 60 * 1000});
  let runner = null;
  try {
    runner = JSON.parse(fs.readFileSync(cfg.resultPath, 'utf8'));
  } catch {
    /* runner не дописал */
  }
  const ok = r.code === 0 && fs.existsSync(outPath) && runner?.status === 'OK';
  const rec = {
    runId: cfg.runId,
    renderer: 'remotion',
    frames: runner?.render?.frameCount ?? 1800,
    status: ok ? 'OK' : 'FAILED',
    wallSec: Math.round(r.wallMs) / 1000,
    captureMs: runner?.timings?.framesRenderPhaseMs ?? null,
    encodeMs: runner?.timings?.stitchTailMs ?? null,
    pipelineMs: runner?.timings?.totalMs ?? null,
    toCaptureStartMs: runner?.timings?.preRenderOverheadMs ?? null,
    peakRssMb: r.memory.peakRssSumMb,
    peakPssMb: r.memory.peakPssSumMb,
    stateAfter: snapshotState(),
    error: runner?.error?.message ?? (ok ? null : `код ${r.code}`),
  };
  if (ok) {
    rec.sha256 = sha256File(outPath);
    rec.bytes = fs.statSync(outPath).size;
    rec.framemd5 = await framemd5(outPath, path.join(ROOT, 'results/framemd5', 'long-rm-final-c4-angle.framemd5'));
    rec.ffprobe = await ffprobe(outPath);
    rec.fpsFramesOnly = runner.render.fps.framesOnly;
    rec.fpsRenderPhase = runner.render.fps.renderPhase;
    rec.fpsEndToEnd = Math.round((rec.frames / (r.wallMs / 1000)) * 1000) / 1000;
    rec.ac2Minutes = Math.round((r.wallMs / 1000 / 60) * 100) / 100;
  }
  doc.runs.push(rec);
  flush();
  console.log(`${rec.runId}: ${rec.status}, ${rec.wallSec} c, ${rec.fpsFramesOnly ?? '—'} кадр/с (кадры), RSS ${rec.peakRssMb} МБ`);
}
flush();
