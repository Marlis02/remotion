/**
 * SP-3c: предвычисление помадровых значений композиции ТЕМИ ЖЕ функциями,
 * которыми их считает SP-3 — remotion `interpolate` и `Easing`.
 *
 * Зачем не «повторить формулу в HTML»: `Easing.inOut(Easing.ease)` — это
 * bezier-solver с ньютоновскими итерациями, а не CSS cubic-bezier. Любой
 * пересказ дал бы расхождение в младших битах, и оно смешалось бы с тем
 * расхождением растеризации, ради которого спайк и затевался. Здесь значения
 * берутся из самого remotion, поэтому геометрия совпадает точно, а различие
 * между рендерерами остаётся чистым.
 *
 * V8: никакого Math.random / Date.now. Выход — статические данные.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, 'control/package.json'));
const remotionPath = require.resolve('remotion');
const {interpolate, Easing} = await import(remotionPath);

const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/captions.json'), 'utf8'));
const durationInFrames = captions.durationInFrames;
const last = durationInFrames - 1;

const scaleAt = (frame) =>
  interpolate(frame, [0, last], [1.0, 1.15], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
const txAt = (frame) =>
  interpolate(frame, [0, last], [0, -36], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
const tyAt = (frame) =>
  interpolate(frame, [0, last], [0, 28], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
const fadeAt = (frame) =>
  interpolate(frame, [0, 15, durationInFrames - 16, durationInFrames - 1], [1, 0, 0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const out = {
  schema: 'sp3c-motion/1',
  durationInFrames,
  fps: captions.fps,
  scale: [],
  tx: [],
  ty: [],
  fade: [],
  pageIndex: [],
  appear: [],
};

for (let frame = 0; frame < durationInFrames; frame++) {
  out.scale.push(scaleAt(frame));
  out.tx.push(txAt(frame));
  out.ty.push(tyAt(frame));
  out.fade.push(fadeAt(frame));
  // .find() — ровно как в Short.tsx: первая страница, покрывающая кадр.
  const idx = captions.pages.findIndex((p) => frame >= p.startFrame && frame < p.endFrame);
  out.pageIndex.push(idx);
  if (idx < 0) {
    out.appear.push(0);
  } else {
    const p = captions.pages[idx];
    out.appear.push(
      interpolate(frame, [p.startFrame, p.startFrame + 4], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
  }
}

fs.writeFileSync(path.join(ROOT, 'src/motion.json'), JSON.stringify(out, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'src/motion.js'), 'window.MOTION = ' + JSON.stringify(out) + ';\n');
console.log(
  `motion.js: ${durationInFrames} кадров; scale[0]=${out.scale[0]} scale[149]=${out.scale[149]} scale[299]=${out.scale[299]}; ` +
    `кадров без страницы субтитров: ${out.pageIndex.filter((i) => i < 0).length}`,
);
