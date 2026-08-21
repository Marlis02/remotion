/**
 * SP-3c: варианты композиции, порождаемые из основной, а не написанные руками —
 * чтобы «один-в-один» оставалось проверяемым, а не декларируемым.
 *
 *  src-draft  — 540x960. Профиль draft у SP-3 — это deviceScaleFactor 0.5 при том же
 *               CSS-макете 1080x1920. У HyperFrames масштаб < 1 через CLI не выражается,
 *               поэтому здесь тот же макет 1080x1920, сжатый CSS-трансформом scale(0.5).
 *               Это ПРИБЛИЖЕНИЕ, а не эквивалент (см. decisions).
 *  src-60s    — 1800 кадров: прямой замер AC2 без экстраполяции. Ken Burns той же
 *               формулой на всю длину, страницы субтитров повторены шесть раз со сдвигом.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, 'control/package.json'));
const {interpolate, Easing} = await import(require.resolve('remotion'));

const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/captions.json'), 'utf8'));

const copyAssets = (dir) => {
  fs.mkdirSync(path.join(ROOT, dir), {recursive: true});
  for (const f of ['backdrop.jpg', 'DejaVuSans-Bold.ttf', 'gsap.min.js']) {
    fs.copyFileSync(path.join(ROOT, 'src', f), path.join(ROOT, dir, f));
  }
};

// ── src-draft ──────────────────────────────────────────────────────────────
{
  const dir = 'src-draft';
  copyAssets(dir);
  fs.copyFileSync(path.join(ROOT, 'src/motion.js'), path.join(ROOT, dir, 'motion.js'));
  fs.copyFileSync(path.join(ROOT, 'src/captions.js'), path.join(ROOT, dir, 'captions.js'));
  let h = html
    .replace('content="width=1080, height=1920"', 'content="width=540, height=960"')
    .replace(
      /html, body \{\n        width: 1080px;\n        height: 1920px;/,
      'html, body {\n        width: 540px;\n        height: 960px;',
    )
    .replace(
      '#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background-color: #000; }',
      '#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background-color: #000;\n               transform: scale(0.5); transform-origin: 0 0; }',
    )
    .replace('data-width="1080" data-height="1920"', 'data-width="540" data-height="960"')
    .replace('<title>SP-3c short</title>', '<title>SP-3c short draft 540x960</title>');
  fs.writeFileSync(path.join(ROOT, dir, 'index.html'), h);
  console.log('src-draft записан');
}

// ── src-60s ────────────────────────────────────────────────────────────────
{
  const dir = 'src-60s';
  copyAssets(dir);
  const REPEATS = 6;
  const BLOCK = captions.durationInFrames; // 300
  const durationInFrames = BLOCK * REPEATS; // 1800
  const last = durationInFrames - 1;

  const pages = [];
  for (let r = 0; r < REPEATS; r++) {
    for (const p of captions.pages) {
      pages.push({
        index: pages.length,
        startFrame: p.startFrame + r * BLOCK,
        endFrame: p.endFrame + r * BLOCK,
        tokens: p.tokens.map((t) => ({...t, startFrame: t.startFrame + r * BLOCK, endFrame: t.endFrame + r * BLOCK})),
      });
    }
  }
  const caps = {fps: captions.fps, durationInFrames, pages};
  fs.writeFileSync(path.join(ROOT, dir, 'captions.json'), JSON.stringify(caps, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, dir, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify(caps, null, 2) + ';\n');

  const ease = {easing: Easing.inOut(Easing.ease), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
  const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
  const m = {schema: 'sp3c-motion/1', durationInFrames, fps: caps.fps, scale: [], tx: [], ty: [], fade: [], pageIndex: [], appear: []};
  for (let f = 0; f < durationInFrames; f++) {
    m.scale.push(interpolate(f, [0, last], [1.0, 1.15], ease));
    m.tx.push(interpolate(f, [0, last], [0, -36], ease));
    m.ty.push(interpolate(f, [0, last], [0, 28], ease));
    m.fade.push(interpolate(f, [0, 15, durationInFrames - 16, last], [1, 0, 0, 1], clamp));
    const idx = pages.findIndex((p) => f >= p.startFrame && f < p.endFrame);
    m.pageIndex.push(idx);
    m.appear.push(idx < 0 ? 0 : interpolate(f, [pages[idx].startFrame, pages[idx].startFrame + 4], [0, 1], clamp));
  }
  fs.writeFileSync(path.join(ROOT, dir, 'motion.js'), 'window.MOTION = ' + JSON.stringify(m) + ';\n');

  const h = html
    .replace('data-duration="10"', 'data-duration="60"')
    .replace("tl.to(proxy, { t: 10, duration: 10, ease: 'none' }, 0);", "tl.to(proxy, { t: 60, duration: 60, ease: 'none' }, 0);")
    .replace('<title>SP-3c short</title>', '<title>SP-3c short 60s</title>');
  fs.writeFileSync(path.join(ROOT, dir, 'index.html'), h);
  console.log(`src-60s записан: ${durationInFrames} кадров, ${pages.length} страниц субтитров`);
}
