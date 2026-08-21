/**
 * SP-3c контроль: ОДИН прогон Remotion на ЭТОЙ машине.
 *
 * Зачем он вообще есть. Числа SP-3 сняты на другой машине (AMD Ryzen 5 5600H,
 * ноутбук, 15 GiB, Ubuntu 22.04), а спайк идёт на Intel i5-10400 (стационар,
 * 31 GiB, Ubuntu 24.04). Кадров/с — свойство железа, поэтому сравнивать
 * HyperFrames здесь с Remotion там нельзя. Этот прогон даёт вторую точку на
 * ОДНОМ железе; числа SP-3 при этом не пересматриваются и не пересчитываются.
 *
 * Композиция берётся из docs/spikes/sp3/src БЕЗ КОПИРОВАНИЯ и без правок —
 * бандлер читает те же файлы, что читал SP-3. Профили и флаги энкодера
 * импортируются из docs/spikes/sp3/lib/profiles.mjs.
 */
import {bundle} from '@remotion/bundler';
import {ensureBrowser, openBrowser, renderMedia, renderFrames, selectComposition} from '@remotion/renderer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILES, encoderExtraArgs} from '../../sp3/lib/profiles.mjs';
import {snapshotState} from '../../sp3/lib/sysinfo.mjs';
import {startMemorySampler} from '../../sp3/lib/proctree.mjs';
import {framemd5, ffprobe, keyframes, sha256File} from '../../sp3/lib/media.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.PATH = `${path.resolve(HERE, '../bin')}:${process.env.PATH}`;
const SP3C = path.dirname(HERE);
const SP3 = path.resolve(SP3C, '../sp3');

const cfg = JSON.parse(process.argv[2]);
const profile = PROFILES[cfg.profile];
if (!profile) throw new Error(`неизвестный профиль: ${cfg.profile}`);

const now = () => Date.now();
const T0 = now();
const NODE_BOOT_MS = Math.round(T0 - performance.timeOrigin);
const marks = {nodeBootMs: NODE_BOOT_MS};

const CHROME = path.join(
  HERE,
  'node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell',
);

const result = {
  schema: 'sp3c-run/1',
  runId: cfg.runId,
  renderer: 'remotion',
  status: 'RUNNING',
  startedAt: new Date(T0).toISOString(),
  config: {
    gl: cfg.gl,
    concurrency: cfg.concurrency,
    profile: cfg.profile,
    mode: cfg.mode ?? 'media',
    compositionId: 'short',
    compositionSource: path.relative(path.resolve(SP3C, '../..'), path.join(SP3, 'src/index.ts')),
    profileParams: profile,
    cpuLoadProcesses: cfg.cpuLoad ?? 0,
  },
  versions: {
    node: process.version,
    remotion: (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/remotion/package.json'), 'utf8')).version;
      } catch {
        return null;
      }
    })(),
    react: (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/react/package.json'), 'utf8')).version;
      } catch {
        return null;
      }
    })(),
    chromeHeadlessShellPath: CHROME,
  },
  stateAtStart: snapshotState(),
  timings: {},
  render: {},
  warnings: [],
};
const write = () => fs.writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2) + '\n');
write();

const {spawn} = await import('node:child_process');
// Пик RSS всего дерева (node + вкладки Chrome + ffmpeg) — тем же прибором, что у HyperFrames.
const memSampler = startMemorySampler(process.pid, {intervalMs: 200});
const cpuKids = [];
if (cfg.cpuLoad) {
  for (let i = 0; i < cfg.cpuLoad; i++) {
    cpuKids.push(spawn(process.execPath, ['-e', 'let x=0;for(;;){x=(x+1)%1e9;Math.sqrt(x);}'], {stdio: 'ignore'}));
  }
}

try {
  const tEnsure = now();
  // Браузер обязан быть скачан заранее (control/preflight.mjs): скачивание внутри
  // замера означало бы сеть в рендере и испорченное число.
  await ensureBrowser();
  marks.ensureBrowserMs = now() - tEnsure;

  const bundleOutDir = path.join(HERE, '.bundle/main');
  const cacheDir = path.join(HERE, '.webpack-cache');
  if (cfg.bundleMode === 'cold') {
    fs.rmSync(bundleOutDir, {recursive: true, force: true});
    fs.rmSync(cacheDir, {recursive: true, force: true});
  }
  const tBundle = now();
  const serveUrl = await bundle({
    // entryOverride — только для 60-секундного замера (control/src60), где нужна
    // другая captions.json. Обычные прогоны бандлят SP-3 напрямую.
    entryPoint: cfg.entryOverride ? path.join(SP3C, cfg.entryOverride) : path.join(SP3, 'src/index.ts'),
    publicDir: path.join(SP3, 'assets'),
    outDir: cfg.entryOverride ? path.join(HERE, '.bundle/alt') : bundleOutDir,
    webpackCachePath: cacheDir,
  });
  marks.bundleMs = now() - tBundle;
  write();

  try {
    const tChrome = now();
    const browser = await openBrowser('chrome', {chromiumOptions: {gl: cfg.gl}, logLevel: 'error'});
    marks.chromeStartProbeMs = now() - tChrome;
    await browser.close({silent: true});
  } catch (err) {
    result.warnings.push(`chromeStartProbe не выполнен: ${String(err?.message ?? err)}`);
    marks.chromeStartProbeMs = null;
  }

  const tSelect = now();
  const composition = await selectComposition({serveUrl, id: 'short', chromiumOptions: {gl: cfg.gl}, logLevel: 'error'});
  marks.selectCompositionMs = now() - tSelect;
  const frames = composition.durationInFrames;
  result.render.frameCount = frames;
  result.render.compositionSize = {width: composition.width, height: composition.height, fps: composition.fps};
  write();

  let onStartAt = null;
  let allFramesRenderedAt = null;
  let lastRendered = 0;
  const capturedFfmpegArgs = [];
  const tRenderCall = now();

  if ((cfg.mode ?? 'media') === 'frames') {
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
      logLevel: 'error',
      timeoutInMilliseconds: 60000,
      onStart: () => {
        onStartAt = now();
        marks.toFirstFrameMs = onStartAt - tRenderCall;
      },
      onFrameUpdate: (n) => {
        lastRendered = n;
        if (n === frames && allFramesRenderedAt === null) allFramesRenderedAt = now();
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
      muted: true,
      enforceAudioTrack: false,
      logLevel: 'error',
      timeoutInMilliseconds: 60000,
      ffmpegOverride: ({type, args}) => {
        const patched = [...args];
        patched.splice(patched.length - 1, 0, ...encoderExtraArgs(profile));
        capturedFfmpegArgs.push({type, patched});
        return patched;
      },
      onStart: () => {
        onStartAt = now();
        marks.toFirstFrameMs = onStartAt - tRenderCall;
      },
      onProgress: ({renderedFrames}) => {
        lastRendered = renderedFrames;
        if (renderedFrames === frames && allFramesRenderedAt === null) allFramesRenderedAt = now();
      },
    });
  }

  const tEnd = now();
  marks.renderCallMs = tEnd - tRenderCall;
  marks.renderPhaseMs = onStartAt ? tEnd - onStartAt : null;
  marks.framesRenderPhaseMs = onStartAt && allFramesRenderedAt ? allFramesRenderedAt - onStartAt : null;
  marks.stitchTailMs = allFramesRenderedAt ? tEnd - allFramesRenderedAt : null;
  marks.totalMs = tEnd - T0;
  marks.preRenderOverheadMs = NODE_BOOT_MS + (onStartAt ? onStartAt - T0 : marks.totalMs);

  const fps = (ms) => (ms && ms > 0 ? Math.round((frames / (ms / 1000)) * 1000) / 1000 : null);
  result.render.renderedFrames = lastRendered;
  result.render.fps = {
    renderPhase: fps(marks.renderPhaseMs),
    framesOnly: fps(marks.framesRenderPhaseMs),
    endToEnd: fps(marks.totalMs),
  };
  result.ffmpeg = {invocations: capturedFfmpegArgs};
  result.timings = marks;
  result.memory = memSampler.stop();

  // Проверки над готовым сегментом — те же приборы, что у HyperFrames и в SP-3.
  if ((cfg.mode ?? 'media') === 'frames') {
    const files = fs.readdirSync(cfg.framesOutDir).filter((f) => f.endsWith('.png')).sort();
    const h = crypto.createHash('sha256');
    let bytes = 0;
    const per = [];
    for (const f of files) {
      const buf = fs.readFileSync(path.join(cfg.framesOutDir, f));
      const fh = crypto.createHash('sha256').update(buf).digest('hex');
      h.update(f).update('\0').update(fh).update('\0');
      per.push({file: f, sha256: fh, bytes: buf.length});
      bytes += buf.length;
    }
    const firstFile = files[0] ?? '';
    const pattern = firstFile.replace(/\d+/, (m) => `%0${m.length}d`);
    const md5Path = path.join(SP3C, 'results/framemd5', `${cfg.runId}.framemd5`);
    result.verification = {
      dirHash: h.digest('hex'),
      fileCount: files.length,
      totalBytes: bytes,
      perFile: per,
      framemd5: await framemd5(path.join(cfg.framesOutDir, pattern), md5Path, {
        extraInputArgs: ['-framerate', '30', '-start_number', String(Number((firstFile.match(/\d+/) ?? ['0'])[0]))],
      }),
    };
    result.verification.framemd5.file = path.relative(SP3C, md5Path);
  } else if (fs.existsSync(cfg.outputPath)) {
    const md5Path = path.join(SP3C, 'results/framemd5', `${cfg.runId}.framemd5`);
    result.verification = {
      framemd5: await framemd5(cfg.outputPath, md5Path),
      ffprobe: await ffprobe(cfg.outputPath),
      keyframes: await keyframes(cfg.outputPath),
      outputSha256: sha256File(cfg.outputPath),
      outputBytes: fs.statSync(cfg.outputPath).size,
    };
    result.verification.framemd5.file = path.relative(SP3C, md5Path);
  }

  result.derived = {
    frames,
    framesPerSecond_framesOnly: result.render.fps.framesOnly,
    framesPerSecond_renderPhase: result.render.fps.renderPhase,
    framesPerSecond_endToEnd: result.render.fps.endToEnd,
    wallTimeSec: Math.round(marks.totalMs) / 1000,
    ac2ProjectedMinutes_renderPhase: result.render.fps.renderPhase
      ? Math.round((1800 / result.render.fps.renderPhase / 60) * 100) / 100
      : null,
    ac2ProjectedMinutes_endToEnd: result.render.fps.endToEnd
      ? Math.round((1800 / result.render.fps.endToEnd / 60) * 100) / 100
      : null,
  };
  result.stateAtEnd = snapshotState();
  result.status = 'OK';
  result.finishedAt = new Date().toISOString();
  write();
} catch (err) {
  result.status = 'FAILED';
  result.error = {message: String(err?.message ?? err), stack: String(err?.stack ?? '')};
  result.timings = marks;
  result.finishedAt = new Date().toISOString();
  write();
  process.exitCode = 1;
} finally {
  cpuKids.forEach((k) => k.kill('SIGKILL'));
  try {
    memSampler.stop();
  } catch {
    /* уже остановлен */
  }
}
