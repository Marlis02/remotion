/**
 * SP-3: офлайн-генерация пословных таймингов субтитров.
 * Запускается ОДИН РАЗ, результат (src/captions.json) — статические данные.
 * V9: рендерер ничего не вычисляет, все тайминги precomputed.
 * V8: никакого Math.random / Date.now — только целочисленная арифметика.
 */
import {writeFileSync} from 'node:fs';

const FPS = 30;
const DURATION_IN_FRAMES = 300; // 10 c
const LEAD_IN_FRAMES = 12;      // речь начинается не с нулевого кадра
const TAIL_FRAMES = 15;         // хвост тишины в конце

const TEXT =
  'Порт просыпается раньше города. Первый кран поднимает контейнер, ' +
  'и над водой загорается полоса рассвета. Здесь начинается путь каждой вещи, ' +
  'которую ты держишь в руках.';

const words = TEXT.split(/\s+/).filter(Boolean);

// Вес слова = длина без пунктуации + константа (пауза после точки/запятой — отдельным весом).
const weights = words.map((w) => {
  const bare = w.replace(/[^\p{L}\p{N}]/gu, '');
  const punct = /[.,]$/u.test(w) ? 4 : 0;
  return bare.length + 4 + punct;
});
const totalWeight = weights.reduce((a, b) => a + b, 0);
const span = DURATION_IN_FRAMES - LEAD_IN_FRAMES - TAIL_FRAMES;

// Целочисленное распределение: границы считаются через накопленный вес,
// поэтому суммы сходятся точно и не зависят от порядка сложения float.
let acc = 0;
const tokens = words.map((w, i) => {
  const startFrame = LEAD_IN_FRAMES + Math.floor((acc * span) / totalWeight);
  acc += weights[i];
  const endFrame = LEAD_IN_FRAMES + Math.floor((acc * span) / totalWeight);
  return {index: i, text: w, startFrame, endFrame}; // [start, end) — ADR-0003, полуоткрытый интервал
});

// Группировка в страницы: 2..4 токена (compile.yaml captions.tokensPerGroupMin/Max),
// разрыв страницы форсируется после точки.
const MIN = 2;
const MAX = 4;
const pages = [];
let current = [];
for (const t of tokens) {
  current.push(t);
  const sentenceEnd = /[.]$/u.test(t.text);
  if (current.length >= MAX || (sentenceEnd && current.length >= MIN)) {
    pages.push(current);
    current = [];
  }
}
if (current.length) {
  if (current.length < MIN && pages.length) pages[pages.length - 1].push(...current);
  else pages.push(current);
}

const captionPages = pages.map((toks, i) => ({
  index: i,
  startFrame: toks[0].startFrame,
  endFrame: toks[toks.length - 1].endFrame,
  tokens: toks,
}));

const minGroup = Math.min(...captionPages.map((p) => p.endFrame - p.startFrame));
if (minGroup < 6) throw new Error(`группа короче minGroupDurationFrames: ${minGroup}`);

writeFileSync(
  new URL('./src/captions.json', import.meta.url),
  JSON.stringify({fps: FPS, durationInFrames: DURATION_IN_FRAMES, pages: captionPages}, null, 2) + '\n',
);
console.log(`слов: ${words.length}, страниц: ${captionPages.length}, минимум по группе: ${minGroup} кадров`);
