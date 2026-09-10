// SP-VID A1 — прозрачные кадры из Chrome НАШИМ рендер-путём.
//
// ЧТО ЭТО ЗА ПРИБОР. Не «hyperframes умеет альфу вообще», а «умеет ли ЕЁ отдать наша
// материализация»: каталог композиции строит `materializeComposition` (тот же код, что у
// сборки), аргументы и окружение — `renderArgs`/`renderEnv` (те же), бинарь браузера —
// `browserPath` (тот же резолвер). Отличие от `renderSegment` ровно одно: нет сетевого
// namespace и нет кодирования кадров — прибору нужны PNG, а не сегмент.
//
// ДВА ВАРИАНТА КАТАЛОГА:
//   `asis`  — как его строит движок сегодня (`background: #000` на html/body/#root);
//   `clear` — тот же каталог с ВЫРЕЗАННЫМИ тремя `background: #000` (одноразовая правка
//             ТЕКСТА уже построенного каталога в `work/`, дерево шаблонов не трогается).
// Оба рендерятся, у обоих меряются `pix_fmt` и доля пикселей с альфой < 255.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RENDERER = path.join(REPO, 'packages/renderer-hyperframes/dist/src/index.js');

const { materializeComposition, renderArgs, renderEnv, browserPath, defaultCliPath } =
  await import(RENDERER);
const { rendererTemplates } = await import(
  path.join(REPO, 'packages/renderer-hyperframes/dist/src/templates/index.js')
);

const OUT = path.join(HERE, 'a1');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const FONT = path.join(
  REPO,
  'packages/templates-spec/src/templates/captionEmphasis@1/gate-requests/assets/DejaVuSans-Bold.ttf',
);
const FONT_SHA = 'd1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b';

/** Запрос: вертикаль канала 1080×1920, scale 1, png, 30 fps, 12 кадров. */
function request(dir) {
  const font = { family: 'DejaVu Sans', path: FONT, sha256: FONT_SHA };
  return {
    requestVersion: 1,
    bundle: { compositionId: 'sp-vid-a1', hash: '0'.repeat(64), path: dir },
    tmpDir: path.join(OUT, 'tmp'),
    outputPath: path.join(OUT, 'unused.mts'),
    assets: [],
    fonts: [font],
    compileProfile: { fps: { num: 30, den: 1 }, width: 1080, height: 1920 },
    pixelProfile: { browserGpu: false, imageFormat: 'png', scale: 1 },
    executionProfile: { workers: 4, segmentTimeoutMs: 900000 },
    ir: {
      segmentId: 'seg:a1',
      segmentDurationInFrames: 12,
      assets: [],
      fonts: [{ role: 'caption', sha256: FONT_SHA }],
      captions: [
        {
          frames: { frameStart: 0, frameEnd: 12 },
          text: 'alpha probe',
          tokens: [
            { text: 'alpha', highlight: { frameStart: 0, frameEnd: 12 } },
            { text: 'probe', highlight: null },
          ],
        },
      ],
      clips: [
        {
          clipId: 'r:a1000001',
          template: 'captionEmphasis@1',
          track: 'visual',
          z: 20,
          frames: { frameStart: 0, frameEnd: 12 },
          params: { style: 'bold' },
          assets: [],
          fonts: [{ role: 'caption', sha256: FONT_SHA, family: 'DejaVu Sans' }],
          seeds: {},
        },
      ],
    },
  };
}

/** Один прогон рендерера на готовом каталоге композиции. Возвращает каталог кадров. */
function render(compDir, framesDir, label) {
  mkdirSync(framesDir, { recursive: true });
  const tmp = path.join(path.dirname(framesDir), 'hf-tmp');
  mkdirSync(tmp, { recursive: true });
  const args = renderArgs({
    compositionDir: compDir,
    framesDir,
    fps: { num: 30, den: 1 },
    pixelProfile: { browserGpu: false, imageFormat: 'png', scale: 1 },
    executionProfile: { workers: 4, segmentTimeoutMs: 900000 },
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
  const run = spawnSync(process.execPath, [defaultCliPath(), ...args], {
    env,
    encoding: 'utf8',
    timeout: 900000,
  });
  const ms = Date.now() - t0;
  const frames = existsSync(framesDir) ? readdirSync(framesDir).filter((f) => f.endsWith('.png')) : [];
  console.log(
    `[${label}] код ${String(run.status)} · ${String(ms)} мс · кадров ${String(frames.length)}` +
      (run.status === 0 ? '' : `\n${(run.stdout ?? '') + (run.stderr ?? '')}`.slice(0, 2000)),
  );
  return { framesDir, frames: frames.sort(), ms, code: run.status, chrome };
}

/** `pix_fmt` первого кадра — ffprobe, поле как есть. */
function pixFmt(file) {
  const p = spawnSync(
    '/usr/local/bin/ffprobe',
    ['-v', 'error', '-show_entries', 'stream=pix_fmt,width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return (p.stdout ?? '').trim();
}

/**
 * Доля пикселей с альфой < 255 и гистограмма крайних значений.
 *
 * Альфа вынимается `alphaextract` в rawvideo gray — то есть ffmpeg'ом, а не своим декодером
 * PNG: прибор обязан мерить то, что увидит наш же конвейер.
 */
function alphaStats(file, w, h) {
  const p = spawnSync(
    '/usr/local/bin/ffmpeg',
    ['-v', 'error', '-i', file, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 30 },
  );
  const buf = p.stdout ?? Buffer.alloc(0);
  if (buf.length === 0) return { ok: false, why: (p.stderr ?? Buffer.alloc(0)).toString().slice(0, 300) };
  let zero = 0;
  let full = 0;
  let mid = 0;
  for (const v of buf) {
    if (v === 0) zero += 1;
    else if (v === 255) full += 1;
    else mid += 1;
  }
  const total = buf.length;
  return {
    ok: true,
    total,
    expected: w * h,
    zeroPct: (100 * zero) / total,
    midPct: (100 * mid) / total,
    fullPct: (100 * full) / total,
  };
}

// ── каталог «как есть» ──────────────────────────────────────────────────────
const asisDir = path.join(OUT, 'comp-asis');
const m = materializeComposition(request(asisDir), { registry: rendererTemplates, verifyHash: false });
console.log(`материализация: ${String(m.listing.length)} файлов, compositionHash ${m.compositionHash}`);

// ── каталог «без непрозрачного фона» ────────────────────────────────────────
const clearDir = path.join(OUT, 'comp-clear');
cpSync(asisDir, clearDir, { recursive: true });
const html = readFileSync(path.join(clearDir, 'index.html'), 'utf8');
const patched = html.replaceAll(' background: #000;', '');
if (patched === html) throw new Error('в index.html не нашлось `background: #000` — прибор бы мерил то же самое дважды');
writeFileSync(path.join(clearDir, 'index.html'), patched, 'utf8');
console.log(`вырезано вхождений \`background: #000\`: ${String(html.split(' background: #000;').length - 1)}`);

const results = {};
for (const [label, dir] of [
  ['asis', asisDir],
  ['clear', clearDir],
]) {
  const r = render(dir, path.join(OUT, `frames-${label}`), label);
  const first = r.frames[0] === undefined ? null : path.join(r.framesDir, r.frames[0]);
  const mid = r.frames.length > 1 ? path.join(r.framesDir, r.frames[Math.floor(r.frames.length / 2)]) : first;
  results[label] = {
    code: r.code,
    ms: r.ms,
    frames: r.frames.length,
    chrome: r.chrome,
    pixFmt: first === null ? null : pixFmt(first),
    alphaFirst: first === null ? null : alphaStats(first, 1080, 1920),
    alphaMid: mid === null ? null : alphaStats(mid, 1080, 1920),
    file: mid,
  };
}
writeFileSync(path.join(OUT, 'a1.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
