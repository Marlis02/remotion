/**
 * SP-3: ОДИН прогон рендера в отдельном процессе.
 * Отдельный процесс — не роскошь: (а) так меряется реальный оверхед старта
 * процесса и Chrome на сегмент (ADR-0008), (б) пиковую RSS дерева процессов
 * можно снять только снаружи, (в) падение прогона не убивает весь замер.
 *
 * Конфиг приходит JSON-строкой в argv[2], результат пишется в config.resultPath.
 */
import {bundle} from '@remotion/bundler';
import {
  ensureBrowser,
  openBrowser,
  renderMedia,
  renderFrames,
  selectComposition,
} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {PROFILES, encoderExtraArgs} from './lib/profiles.mjs';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';

const cfg = JSON.parse(process.argv[2]);
const profile = PROFILES[cfg.profile];
if (!profile) throw new Error(`неизвестный профиль: ${cfg.profile}`);

const now = () => Date.now();
const T0 = now();
/** Время старта самого процесса node (boot + ESM-импорты) — часть оверхеда на сегмент. */
const NODE_BOOT_MS = Math.round(T0 - performance.timeOrigin);
const marks = {};
const mark = (name) => {
  marks[name] = now() - T0;
};

const result = {
  runId: cfg.runId,
  status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {
    gl: cfg.gl,
    concurrency: cfg.concurrency,
    profile: cfg.profile,
    mode: cfg.mode ?? 'media',
    bundleMode: cfg.bundleMode ?? 'warm',
    compositionId: 'short',
    profileParams: profile,
  },
  versions: getVersions(),
  stateAtStart: snapshotState(),
  timings: {},
  render: {},
  ffmpeg: {},
  warnings: [],
};

const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

const fail = (err) => {
  result.status = 'FAILED';
  result.error = {message: String(err?.message ?? err), stack: String(err?.stack ?? '')};
  result.finishedAt = new Date().toISOString();
  result.timings = {...result.timings, ...marks, totalMs: now() - T0};
  write();
  process.exitCode = 1;
};

try {
  // 0. Браузер обязан быть уже скачан: сети в рендере быть не должно.
  const tEnsure = now();
  await ensureBrowser({
    onBrowserDownload: () => {
      throw new Error('Chrome не скачан заранее — прогон был бы с сетью, это нарушает V9');
    },
  });
  marks.ensureBrowserMs = now() - tEnsure;

  // 1. Бандлинг. Холодный = пустой outDir и пустой кэш webpack.
  const bundleOutDir = cfg.bundleOutDir ?? path.join(ROOT, '.bundle/main');
  const cacheDir = cfg.webpackCachePath ?? path.join(ROOT, '.webpack-cache');
  if ((cfg.bundleMode ?? 'warm') === 'cold') {
    fs.rmSync(bundleOutDir, {recursive: true, force: true});
    fs.rmSync(cacheDir, {recursive: true, force: true});
  }
  const tBundle = now();
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, 'src/index.ts'),
    publicDir: path.join(ROOT, 'assets'),
    outDir: bundleOutDir,
    webpackCachePath: cacheDir,
  });
  marks.bundleMs = now() - tBundle;
  result.bundle = {
    mode: cfg.bundleMode ?? 'warm',
    outDir: bundleOutDir,
    ms: marks.bundleMs,
  };
  write();

  // 2. Отдельно — чистое время старта Chrome (оверхед на сегмент, ADR-0008 «подпроцесс + Chrome на сегмент»).
  try {
    const tChrome = now();
    const browser = await openBrowser('chrome', {
      chromiumOptions: {gl: cfg.gl},
      logLevel: 'error',
      onBrowserDownload: () => {
        throw new Error('скачивание браузера во время прогона запрещено');
      },
    });
    marks.chromeStartProbeMs = now() - tChrome;
    const tClose = now();
    await browser.close({silent: true});
    marks.chromeCloseProbeMs = now() - tClose;
  } catch (err) {
    result.warnings.push(`chromeStartProbe не выполнен: ${String(err?.message ?? err)}`);
    marks.chromeStartProbeMs = null;
  }

  // 3. Композиция.
  const tSelect = now();
  const composition = await selectComposition({
    serveUrl,
    id: 'short',
    chromiumOptions: {gl: cfg.gl},
    logLevel: 'error',
  });
  marks.selectCompositionMs = now() - tSelect;
  const [rangeStart, rangeEnd] = Array.isArray(cfg.frameRange)
    ? cfg.frameRange
    : [0, composition.durationInFrames - 1];
  result.render.frameCount = rangeEnd - rangeStart + 1;
  result.render.frameRange = [rangeStart, rangeEnd];
  result.render.compositionSize = {width: composition.width, height: composition.height, fps: composition.fps};
  write();

  // 4. Рендер.
  const progress = [];
  let onStartAt = null;
  let lastRenderedFrames = 0;
  let allFramesRenderedAt = null;
  const browserLogs = [];
  const capturedFfmpegArgs = [];

  const tRenderCall = now();

  if ((cfg.mode ?? 'media') === 'frames') {
    // PNG-сиквенс без энкода: изолирует Chrome от энкодера (RT-01 §5.3 п.1).
    fs.rmSync(cfg.framesOutDir, {recursive: true, force: true});
    fs.mkdirSync(cfg.framesOutDir, {recursive: true});
    await renderFrames({
      composition,
      serveUrl,
      outputDir: cfg.framesOutDir,
      imageFormat: 'png',
      scale: profile.scale,
      concurrency: cfg.concurrency,
      chromiumOptions: {gl: cfg.gl},
      offthreadVideoCacheSizeInBytes: profile.offthreadVideoCacheSizeInBytes,
      frameRange: cfg.frameRange ?? null,
      logLevel: 'error',
      timeoutInMilliseconds: cfg.frameTimeoutMs ?? 60000,
      onBrowserLog: (log) => browserLogs.push(`${log.type}: ${log.text}`),
      onStart: () => {
        onStartAt = now();
        marks.toFirstFrameMs = onStartAt - tRenderCall;
      },
      onFrameUpdate: (framesRendered) => {
        lastRenderedFrames = framesRendered;
        progress.push({tMs: now() - T0, renderedFrames: framesRendered, encodedFrames: 0});
        if (framesRendered === result.render.frameCount && allFramesRenderedAt === null) {
          allFramesRenderedAt = now();
        }
      },
    });
  } else {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: cfg.outputPath,
      crf: profile.crf,
      scale: profile.scale,
      imageFormat: profile.imageFormat,
      jpegQuality: profile.jpegQuality,
      x264Preset: profile.x264Preset,
      pixelFormat: profile.pixelFormat,
      colorSpace: profile.colorSpace,
      concurrency: cfg.concurrency,
      chromiumOptions: {gl: cfg.gl},
      offthreadVideoCacheSizeInBytes: profile.offthreadVideoCacheSizeInBytes,
      disallowParallelEncoding: profile.disallowParallelEncoding,
      frameRange: cfg.frameRange ?? null,
      muted: true, // немое видео: звук не режется и муксится отдельно (V6, ADR-0008)
      enforceAudioTrack: false,
      logLevel: 'error',
      timeoutInMilliseconds: cfg.frameTimeoutMs ?? 60000,
      onBrowserLog: (log) => browserLogs.push(`${log.type}: ${log.text}`),
      ffmpegOverride: ({type, args}) => {
        const patched = [...args];
        patched.splice(patched.length - 1, 0, ...encoderExtraArgs(profile));
        capturedFfmpegArgs.push({type, original: args, patched});
        return patched;
      },
      onStart: () => {
        onStartAt = now();
        marks.toFirstFrameMs = onStartAt - tRenderCall;
      },
      onProgress: ({renderedFrames, encodedFrames, stitchStage}) => {
        lastRenderedFrames = renderedFrames;
        progress.push({tMs: now() - T0, renderedFrames, encodedFrames, stitchStage});
        if (renderedFrames === result.render.frameCount && allFramesRenderedAt === null) {
          allFramesRenderedAt = now();
        }
      },
    });
  }

  const tRenderEnd = now();
  marks.renderCallMs = tRenderEnd - tRenderCall;
  marks.renderPhaseMs = onStartAt ? tRenderEnd - onStartAt : null;
  marks.framesRenderPhaseMs = onStartAt && allFramesRenderedAt ? allFramesRenderedAt - onStartAt : null;
  marks.stitchTailMs = allFramesRenderedAt ? tRenderEnd - allFramesRenderedAt : null;
  marks.totalMs = tRenderEnd - T0;
  marks.nodeBootMs = NODE_BOOT_MS;
  // Всё, что оплачивается до первого кадра: boot node + бандл + проба Chrome + композиция + старт рендера.
  marks.preRenderOverheadMs = NODE_BOOT_MS + (onStartAt ? onStartAt - T0 : marks.totalMs);

  const frames = result.render.frameCount;
  const fps = (ms) => (ms && ms > 0 ? Math.round((frames / (ms / 1000)) * 1000) / 1000 : null);

  result.render.renderedFrames = lastRenderedFrames;
  result.render.progressSamples = progress.filter((_, i) => i % 10 === 0 || i === progress.length - 1);
  result.render.browserLogCount = browserLogs.length;
  result.render.browserLogs = browserLogs.slice(0, 40);
  result.render.fps = {
    // кадров/с только фазы рендера (после того, как Chrome готов)
    renderPhase: fps(marks.renderPhaseMs),
    // кадров/с до последнего отрендеренного кадра (без хвоста муксинга)
    framesOnly: fps(marks.framesRenderPhaseMs),
    // кадров/с всего прогона: бандл + старт Chrome + рендер + мукс — число для AC2
    endToEnd: fps(marks.totalMs),
  };
  result.ffmpeg = {invocations: capturedFfmpegArgs};
  if (cfg.outputPath && fs.existsSync(cfg.outputPath)) {
    result.render.outputBytes = fs.statSync(cfg.outputPath).size;
  }
  result.timings = marks;
  result.stateAtEnd = snapshotState();
  result.status = 'OK';
  result.finishedAt = new Date().toISOString();
  write();
} catch (err) {
  fail(err);
}
