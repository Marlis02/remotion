// SP-VID A5 (третья стадия) — СКОЛЬКО СТОИТ ХРОМ на 60 с графики.
//
// Композиция — одноразовая, как в A1 (фикстура закрыта заданием): один клип
// `captionEmphasis@1` на 1800 кадров, вертикаль канала 1080×1920@30, профиль `final`
// (`scale: 1`, png, workers 4). Мерится ОДИН прогон: 1800 кадров — это уже не шум.
//
// Отдельно печатается стоимость ЧЕРНОВОГО профиля (`draftHalf`: scale 0.5) — потому что
// решение VID-01/02 будет приниматься про оба, и «Chrome дорог» без второй цифры неверно.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RENDERER = path.join(REPO, 'packages/renderer-hyperframes/dist/src/index.js');

const { materializeComposition, renderArgs, renderEnv, browserPath, defaultCliPath } = await import(RENDERER);
const { rendererTemplates } = await import(
  path.join(REPO, 'packages/renderer-hyperframes/dist/src/templates/index.js')
);

const OUT = path.join(HERE, 'a5-chrome');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const FONT = path.join(
  REPO,
  'packages/templates-spec/src/templates/captionEmphasis@1/gate-requests/assets/DejaVuSans-Bold.ttf',
);
const FONT_SHA = 'd1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b';
const FRAMES = 1800;

/** Субтитры на все 1800 кадров группами по 30: рендер обязан РИСОВАТЬ, а не держать один кадр. */
function captions() {
  const out = [];
  for (let start = 0; start < FRAMES; start += 30) {
    const n = start / 30;
    out.push({
      frames: { frameStart: start, frameEnd: Math.min(start + 30, FRAMES) },
      text: `speed probe ${String(n)}`,
      tokens: [
        { text: 'speed', highlight: null },
        { text: 'probe', highlight: { frameStart: start, frameEnd: Math.min(start + 30, FRAMES) } },
        { text: String(n), highlight: null },
      ],
    });
  }
  return out;
}

function request(dir, scale) {
  const font = { family: 'DejaVu Sans', path: FONT, sha256: FONT_SHA };
  return {
    requestVersion: 1,
    bundle: { compositionId: 'sp-vid-a5', hash: '0'.repeat(64), path: dir },
    tmpDir: path.join(OUT, `tmp-${String(scale)}`),
    outputPath: path.join(OUT, 'unused.mts'),
    assets: [],
    fonts: [font],
    compileProfile: { fps: { num: 30, den: 1 }, width: 1080, height: 1920 },
    pixelProfile: { browserGpu: false, imageFormat: 'png', scale },
    executionProfile: { workers: 4, segmentTimeoutMs: 3600000 },
    ir: {
      segmentId: 'seg:a5',
      segmentDurationInFrames: FRAMES,
      assets: [],
      fonts: [{ role: 'caption', sha256: FONT_SHA }],
      captions: captions(),
      clips: [
        {
          clipId: 'r:a5000001',
          template: 'captionEmphasis@1',
          track: 'visual',
          z: 20,
          frames: { frameStart: 0, frameEnd: FRAMES },
          params: { style: 'bold' },
          assets: [],
          fonts: [{ role: 'caption', sha256: FONT_SHA, family: 'DejaVu Sans' }],
          seeds: {},
        },
      ],
    },
  };
}

const results = {};
for (const [label, scale] of [
  ['final(scale 1)', 1],
  ['draftHalf(scale 0.5)', 0.5],
]) {
  const dir = path.join(OUT, `comp-${String(scale)}`);
  materializeComposition(request(dir, scale), { registry: rendererTemplates, verifyHash: false });
  const framesDir = path.join(OUT, `frames-${String(scale)}`);
  mkdirSync(framesDir, { recursive: true });
  const tmp = path.join(OUT, `hf-tmp-${String(scale)}`);
  mkdirSync(tmp, { recursive: true });
  const args = renderArgs({
    compositionDir: dir,
    framesDir,
    fps: { num: 30, den: 1 },
    pixelProfile: { browserGpu: false, imageFormat: 'png', scale },
    executionProfile: { workers: 4, segmentTimeoutMs: 3600000 },
  });
  const chrome = browserPath(process.env);
  const env = renderEnv({
    parentEnv: process.env,
    ffmpegPath: '/usr/local/bin/ffmpeg',
    ffprobePath: '/usr/local/bin/ffprobe',
    tmpDir: tmp,
    ...(chrome === null ? {} : { browserPath: chrome }),
  });
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [defaultCliPath(), ...args], { env, encoding: 'utf8', timeout: 3600000 });
  const ms = Date.now() - t0;
  const frames = existsSync(framesDir) ? readdirSync(framesDir).filter((f) => f.endsWith('.png')).length : 0;
  results[label] = {
    code: run.status,
    ms,
    frames,
    msPerFrame: frames === 0 ? null : ms / frames,
    msPerSecondOfVideo: ms / (FRAMES / 30),
  };
  console.log(
    `${label}: код ${String(run.status)} · ${String(ms)} мс · кадров ${String(frames)} · ` +
      `${(ms / Math.max(frames, 1)).toFixed(1)} мс/кадр · ${(ms / (FRAMES / 30)).toFixed(0)} мс на секунду ролика`,
  );
  if (run.status !== 0) console.log(`${(run.stdout ?? '') + (run.stderr ?? '')}`.slice(0, 1500));
}
writeFileSync(path.join(OUT, 'a5-chrome.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
