/**
 * SP-3f: порождение данных композиции и её вариантов.
 *
 * Всё, что композиция знает о времени и тексте, лежит в одном файле
 * `src/data/hook.js` (window.__HOOK). Текст берётся ДОСЛОВНО из
 * fixtures/minimal/source/01-intro.md (Charter V12: язык контента — английский);
 * маркер `[say: 200 | two hundred]` раскрывается по V5 в caption-форму «200».
 *
 * Таблица субтитров считается ЗДЕСЬ и только в кадрах (ADR-0003):
 * wordFrames = 11 кадров на слово (0.3667 с при 30 fps ≈ «~0.35 с на слово»
 * из задания; 10.5 кадра не выражается целым числом, а граница страницы
 * обязана лежать на кадре — T8). Страница — 2..4 слова, разрыв на конце
 * предложения. Ни одной секунды в модели нет: секунды появляются только
 * в адаптере F(n) = n / fps внутри композиции.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const DURATION = 450;

/** Дословно из fixtures/minimal/source/01-intro.md, первые три предложения. */
const SENTENCES = [
  'The morning began the same way for almost 200 years running.',
  'Ships came in on the night tide, and the town woke to their horns.',
  'The harbour warehouses held goods that nobody in town ever bought.',
];
const KEYWORD = '200'; // ключевое слово первого предложения — крупнее и другим цветом

const CAP = {startFrame: 40, wordFrames: 11, maxWordsPerPage: 4, maxCharsPerPage: 26};

/** Пословная раскладка: слово i начинается на startFrame + i*wordFrames. */
const words = [];
SENTENCES.forEach((s, si) => {
  s.split(/\s+/).forEach((w, wi, arr) => {
    words.push({i: words.length, text: w, sentence: si, lastInSentence: wi === arr.length - 1});
  });
});
words.forEach((w) => {
  w.startFrame = CAP.startFrame + w.i * CAP.wordFrames;
  w.endFrame = w.startFrame + CAP.wordFrames; // полуоткрытый [start, end)
});

/** Страницы: жадная группировка, разрыв обязателен на конце предложения. */
const pages = [];
let cur = null;
for (const w of words) {
  const wouldChars = cur ? cur.chars + 1 + w.text.length : w.text.length;
  if (!cur || cur.words.length >= CAP.maxWordsPerPage || wouldChars > CAP.maxCharsPerPage) {
    cur = {index: pages.length, words: [], chars: 0};
    pages.push(cur);
  }
  cur.words.push(w.i);
  cur.chars = cur.chars === 0 ? w.text.length : cur.chars + 1 + w.text.length;
  if (w.lastInSentence) cur = null;
}
pages.forEach((p) => {
  p.startFrame = words[p.words[0]].startFrame;
  p.endFrame = words[p.words[p.words.length - 1]].endFrame;
  p.text = p.words.map((i) => words[i].text).join(' ');
});

const DATA = {
  schema: 'sp3f-data/1',
  comment: 'SP-3f: все значения композиции. Время только в кадрах. Никакого Math.random/Date.now (Charter V8/V9).',
  fps: FPS,
  durationInFrames: DURATION,
  width: 1080,
  height: 1920,
  compositionId: 'hook',
  scale: 1,
  layers: {shader: true, depth: true, type: true, particles: true, card: true, melt: true, captions: true},
  palette: {
    ink: '#05070c', ember: '#ff7a2f', emberHi: '#ffb347', gold: '#ffd28a',
    cold: '#dff3ff', dim: 'rgba(223,243,255,0.42)', line: 'rgba(255,180,110,0.55)',
  },
  windows: {
    bg: {from: 0, to: 450},
    depth: {from: 0, to: 360},
    type: {from: 30, to: 160},
    particles: {from: 120, to: 215},
    card: {from: 200, to: 305},
    melt: {from: 290, to: 362},
    final: {from: 300, to: 450},
    captions: {from: 40, to: 447},
  },
  // 1. шейдерный фон
  shader: {w: 360, h: 640, breatheFrames: 450},
  // 2. 2.5D-параллакс: коэффициенты камеры на слой (дальние — медленнее)
  depth: {
    pushFrames: 150,
    layers: [
      {file: 'depth-0.jpg', scaleFrom: 1.00, scaleTo: 1.045, yFrom: 0, yTo: -14, blurPx: 5.0, opacity: 0.55, fadeFrames: 44},
      {file: 'depth-1.jpg', scaleFrom: 1.00, scaleTo: 1.085, yFrom: 0, yTo: -30, blurPx: 3.0, opacity: 0.70, fadeFrames: 40},
      {file: 'depth-2.jpg', scaleFrom: 1.00, scaleTo: 1.135, yFrom: 0, yTo: -52, blurPx: 1.4, opacity: 0.82, fadeFrames: 36},
      {file: 'depth-3.jpg', scaleFrom: 1.00, scaleTo: 1.200, yFrom: 0, yTo: -84, blurPx: 0.0, opacity: 0.92, fadeFrames: 32},
    ],
  },
  // 3. кинетическая типографика
  type: {
    text: SENTENCES[0], keyword: KEYWORD,
    staggerFrames: 3, riseFrames: 15, blurPx: 8, riseY: 66,
    shineFrom: 96, shineFrames: 34,
    outFrom: 146, outFrames: 14,
  },
  // 4. частицы: сборка хаоса в силуэт факела
  particles: {
    count: 2600, assembleFrames: 62, holdFrames: 16, outFrames: 16,
    cx: 540, cy: 880, flameH: 660, flameW: 320, chaosR: 780, dotPx: 3.0,
  },
  // 5. стеклянная карточка + морфинг иконки
  card: {
    text: SENTENCES[1],
    inFrames: 26, rotYFrom: 26, xFrom: 210, outFrom: 288, outFrames: 17,
    morphFrom: 232, morphFrames: 34, nodes: 12,
  },
  // 6. luma-переход
  melt: {w: 270, h: 480, thresholdFrames: 54, cell: 7.5},
  // 7. финальный кадр
  final: {text: SENTENCES[2], inFrom: 322, inFrames: 22, top: 620, fontPx: 74},
  // 8. субтитры
  captions: {
    ...CAP, safeBottom: 320, safeSide: 60,
    scrimTop: 1100, plateTop: 1424, bandTop: 1444, bandBottom: 1592,
    fontPx: 54, words, pages,
  },
};

/** Вариант композиции = тот же src с другой data.js. */
const variants = {
  'src-draft': {scale: 0.5},
  'src-full60': {durationInFrames: 60},
  'src-noshader': {durationInFrames: 60, layers: {shader: false}},
  'src-noparticles': {durationInFrames: 60, layers: {particles: false}},
  'src-noglass': {durationInFrames: 60, layers: {card: false}},
  'src-probe': {durationInFrames: 2, probe: true},
  // Полнодлинные варианты для цены слоя: выключен ровно один тяжёлый слой,
  // всё остальное — как в основной сцене. Короткие 60-кадровые пробы меряют
  // только стоимость инициализации: частиц и карточки на кадрах 0..60 нет.
  'src-L450-noshader': {layers: {shader: false}},
  'src-L450-noparticles': {layers: {particles: false}},
  'src-L450-noglass': {layers: {card: false}},
};

const writeData = (dir, d) => {
  fs.mkdirSync(path.join(ROOT, dir, 'data'), {recursive: true});
  fs.writeFileSync(path.join(ROOT, dir, 'data', 'hook.js'),
    'window.__HOOK = ' + JSON.stringify(d, null, 1) + ';\n');
};

writeData('src', DATA);
fs.writeFileSync(path.join(ROOT, 'results/captions.json'),
  JSON.stringify({schema: 'sp3f-captions/1', fps: FPS, wordFrames: CAP.wordFrames,
    note: 'Границы страниц и слов — целые кадры. Проверяется прибором captiontest.mjs (ADR-0003 T8).',
    words, pages}, null, 2) + '\n');

for (const [dir, patch] of Object.entries(variants)) {
  const d = {...DATA, ...patch, layers: {...DATA.layers, ...(patch.layers ?? {})}};
  const abs = path.join(ROOT, dir);
  fs.rmSync(abs, {recursive: true, force: true});
  fs.mkdirSync(abs, {recursive: true});
  for (const f of ['index.html']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(abs, f));
  for (const d2 of ['vendor', 'assets', 'fonts']) {
    fs.mkdirSync(path.join(abs, d2), {recursive: true});
    for (const f of fs.readdirSync(path.join(ROOT, 'src', d2)).sort()) {
      fs.symlinkSync(path.join(ROOT, 'src', d2, f), path.join(abs, d2, f));
    }
  }
  writeData(dir, d);
}

console.log(`слов ${words.length}, страниц ${pages.length}, субтитры ${words[0].startFrame}..${words[words.length - 1].endFrame} кадр`);
for (const p of pages) console.log(`  стр.${String(p.index).padStart(2)} [${p.startFrame}..${p.endFrame}) «${p.text}»`);
