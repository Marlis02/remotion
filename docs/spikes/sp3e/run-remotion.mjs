/**
 * SP-3e: ОДИН прогон Remotion в отдельном процессе.
 * Адаптация sp3/runner.mjs: конфигурация рендера — как SP-3 `final`
 * (gl: angle, тот же энкодер, те же ffmpegOverride-флаги), плюс проверки
 * над готовым сегментом теми же приборами, что у HyperFrames-ветки.
 */
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, BIN} from './lib/env.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;
import {PROFILES, encoderExtraArgs} from '../sp3/lib/profiles.mjs';
import {startMemorySampler} from '../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const profile = PROFILES[cfg.profile ?? 'final'];
const T0 = Date.now();
const NODE_BOOT_MS = Math.round(T0 - performance.timeOrigin);
const FRAMES = 300;
const marks = {nodeBootMs: NODE_BOOT_MS};

const result = {
  schema: 'sp3e-run/1', runId: cfg.runId, renderer: 'remotion', status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {profile: cfg.profile ?? 'final', concurrency: cfg.concurrency, gl: cfg.gl ?? 'angle',
    project: cfg.entryPoint ?? 'src/remotion/index.ts', compositionId: cfg.compositionId ?? 'motion',
    outputPath: cfg.outputPath, profileParams: profile},
  stateAtStart: snapshotState(), timings: {}, warnings: [],
};
const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

const sampler = startMemorySampler(process.pid, {intervalMs: 200});
try {
  await ensureBrowser({
    onBrowserDownload: () => { throw new Error('Chrome не скачан заранее — прогон был бы с сетью (V9)'); },
  });

  const tBundle = Date.now();
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, cfg.entryPoint ?? 'src/remotion/index.ts'),
    publicDir: cfg.publicDir === null ? null : path.resolve(ROOT, cfg.publicDir ?? 'src/remotion/public'),
    outDir: path.join(ROOT, cfg.bundleOutDir ?? '.bundle/main'),
    webpackCachePath: path.join(ROOT, cfg.webpackCachePath ?? '.webpack-cache'),
  });
  marks.bundleMs = Date.now() - tBundle;

  const tSelect = Date.now();
  const composition = await selectComposition({serveUrl, id: cfg.compositionId ?? 'motion', chromiumOptions: {gl: cfg.gl ?? 'angle'}, logLevel: 'error'});
  marks.selectCompositionMs = Date.now() - tSelect;

  fs.rmSync(cfg.outputPath, {force: true});
  const browserLogs = [];
  const capturedFfmpegArgs = [];
  let onStartAt = null;
  let allFramesRenderedAt = null;
  const tRenderCall = Date.now();
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: cfg.outputPath,
    crf: profile.crf, scale: profile.scale, imageFormat: profile.imageFormat, jpegQuality: profile.jpegQuality,
    x264Preset: profile.x264Preset, pixelFormat: profile.pixelFormat, colorSpace: profile.colorSpace,
    concurrency: cfg.concurrency, chromiumOptions: {gl: cfg.gl ?? 'angle'},
    offthreadVideoCacheSizeInBytes: profile.offthreadVideoCacheSizeInBytes,
    disallowParallelEncoding: profile.disallowParallelEncoding,
    muted: true, enforceAudioTrack: false, logLevel: 'error', timeoutInMilliseconds: 60000,
    onBrowserLog: (l) => browserLogs.push(`${l.type}: ${l.text}`),
    ffmpegOverride: ({type, args}) => {
      const patched = [...args];
      patched.splice(patched.length - 1, 0, ...encoderExtraArgs(profile));
      capturedFfmpegArgs.push({type, patched});
      return patched;
    },
    onStart: () => { onStartAt = Date.now(); },
    onProgress: ({renderedFrames}) => {
      if (renderedFrames === FRAMES && allFramesRenderedAt === null) allFramesRenderedAt = Date.now();
    },
  });
  const tEnd = Date.now();
  marks.renderCallMs = tEnd - tRenderCall;
  marks.renderPhaseMs = onStartAt ? tEnd - onStartAt : null;
  marks.framesRenderPhaseMs = onStartAt && allFramesRenderedAt ? allFramesRenderedAt - onStartAt : null;
  marks.stitchTailMs = allFramesRenderedAt ? tEnd - allFramesRenderedAt : null;
  marks.totalMs = tEnd - T0;
  marks.preRenderOverheadMs = NODE_BOOT_MS + (onStartAt ? onStartAt - T0 : marks.totalMs);
  result.timings = marks;
  result.memory = sampler.stop();
  result.browserLogCount = browserLogs.length;
  result.browserLogs = browserLogs.slice(0, 20);
  result.ffmpeg = {invocations: capturedFfmpegArgs};

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
    framesPerSecond_framesOnly: per(marks.framesRenderPhaseMs),
    framesPerSecond_renderPhase: per(marks.renderPhaseMs),
    framesPerSecond_endToEnd: per(marks.totalMs),
    wallTimeSec: Math.round(marks.totalMs) / 1000,
  };
  result.status = 'OK';
  result.stateAtEnd = snapshotState();
  result.finishedAt = new Date().toISOString();
  write();
} catch (err) {
  try { result.memory = sampler.stop(); } catch { /* сэмплер уже остановлен */ }
  result.status = 'FAILED';
  result.error = {message: String(err?.message ?? err), stack: String(err?.stack ?? '')};
  result.timings = marks;
  result.finishedAt = new Date().toISOString();
  write();
  process.exitCode = 1;
}
