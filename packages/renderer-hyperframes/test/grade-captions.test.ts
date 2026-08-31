// **Н2 `E-07`: СУБТИТРЫ НЕ ГРЕЙДЯТСЯ — И ЭТО ИЗМЕРЯЕТСЯ ПИКСЕЛЯМИ, А НЕ ОБЪЯВЛЯЕТСЯ.**
//
// ═══ ТРЕБУЕТ БРАУЗЕРА, ffmpeg И СИСТЕМНОГО ШРИФТА. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у соседних браузерных файлов (решение владельца `H-01`, §4 п. 2):
// тест либо зелёный, либо красный, но не «пропущен».
//
// ЧТО ЗА ПРАВИЛО. `grade@1` — слой поверх сцены, и он обязан лежать НАД визуальными слоями и
// ПОД `#captions` (`z-index: 1000`, `runtime.js`). Субтитры — не часть картинки: их читают, и
// тон канала не имеет права менять их цвет. Правило держится ОДНИМ числом — `z` клипа в
// режиссуре, — и число легко поставить не то: `z: 2000` вместо `z: 25` компилируется,
// рендерится и даёт ролик, который просто выглядит не так.
//
// ПОЧЕМУ ИМЕННО ЭТОТ ПРИБОР. Текст полосы — `#ffffff` (`BAND.textColor`), то есть РОВНО
// нейтральный: `R − B = 0` по построению. Сепия белое greyscale-нейтральным не оставляет:
// матрица `sepia(1)` даёт из (255, 255, 255) примерно (255, 255, 239). Значит «субтитры
// покрашены» есть измеримая величина — ТЕПЛОТА белых пикселей внутри плашки, — и она равна
// нулю ровно тогда, когда грейд до субтитров не достаёт.
//
// ОХРАННИК ДВУСТОРОННИЙ, И ВТОРАЯ СТОРОНА — САМО НАРУШЕНИЕ Н2. Один и тот же запрос
// рендерится дважды: с `z: 25` (грейд под субтитрами) и с `z: 2000` (грейд НАД `#captions`).
// Первый обязан дать нейтральный текст, второй — тёплый. Без второй половины тест был бы
// зелёным и от того, что грейда нет вовсе.
//
// **ВИЗУАЛЬНЫХ СЛОЁВ ПОД ГРЕЙДОМ В ПЕРВОЙ ПРОБЕ НЕТ, И ЭТО ВЫБОР ПРИБОРА, А НЕ ЭКОНОМИЯ.**
// Плашка ищется как «самое тёмное в кадре»; картинка 32×32 фикстуры несёт тёмные клетки
// шахматки, и рамка «самого тёмного» расползлась бы на весь кадр, а «белые пиксели внутри
// рамки» перестали бы быть текстом. Поэтому под грейдом здесь только белый фон страницы.
//
// **ИЗМЕРЕНО ЗДЕСЬ ЖЕ И НАЗВАНО ВСЛУХ: НАД ПУСТОТОЙ `backdrop-filter` НЕ КРАСИТ НИЧЕГО.**
// Белый фон кадра в обеих пробах даёт `R − B = 0.00` — он рисуется НЕ слоем, а поверхностью
// страницы, и в backdrop элемента не входит. Это ровно то основание, по которому запрос
// гейта `grade@1` СМЕШАННЫЙ (`still@1` под грейдом): гейт над пустотой мерил бы
// воспроизводимость ничего. Поэтому «грейд вообще работает» проверяется ВТОРЫМ `it` — на
// настоящем слое под ним и без субтитров, где прибор плашки не нужен вовсе.
//
// **ПОЧЕМУ `scale: 1`, А НЕ ДЕШЁВЫЙ `0.25`.** То же основание, что у
// `captions-visibility.test.ts`: при 270×480 полоса занимает несколько пикселей высоты, и
// счёт белых пикселей внутри плашки перестаёт быть измерением. Цена — ~2–3 с на рендер.

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { rendererTemplates } from '../src/templates/index.js';
import { decodeRgb, pngSize } from '../src/where.js';
import { FIXTURE_PARAMS, makeTemplateFixture, readyRequest } from './fixture.js';

const FRAMES = 3;
/** Измерено: одиночный рендер 3 кадров 1080×1920 на этой машине — 2–3 с. Запас ×100. */
const TIMEOUT = 300_000;

const realClock = (): (() => number) => () => performance.now();

/**
 * `params` пробы — ЧИСТАЯ СЕПИЯ, без виньетки и без зерна.
 *
 * Виньетка затемнила бы углы и спутала поиск плашки (она ищется как «самое тёмное»); зерно
 * добавило бы дисперсию в те самые белые пиксели, по которым считается теплота, и удорожило
 * бы прогон вчетверо по байтам. Предмет теста — ДОСТАЁТ ЛИ грейд до субтитров, и для него
 * нужна ровно одна ось.
 */
const SEPIA_ONLY = {
  saturate: 1,
  contrast: 1,
  sepia: 1,
  hueRotate: 0,
  vignette: 0,
  grain: 0,
} as const;

/** `z` штатный (под `#captions` = 1000) и `z` нарушения Н2 (над ним). */
const Z_UNDER_CAPTIONS = 25;
const Z_ABOVE_CAPTIONS = 2000;

interface Ink {
  /** Тёплость белых пикселей ВНУТРИ плашки: средний `R − B`. */
  readonly textWarmth: number;
  /** Сколько таких пикселей нашлось: ноль означал бы, что мерили пустоту. */
  readonly textPixels: number;
  /** Тёплость фона кадра (первая строка пикселей — заведомо вне плашки). */
  readonly backgroundWarmth: number;
}

/**
 * Прибор: находит плашку как самое тёмное в кадре, затем считает теплоту светлых пикселей
 * ВНУТРИ её рамки.
 *
 * Пороги названы числами. Тёмное — все три канала < 64 (плашка 5/7/12). Светлое — все три
 * канала ≥ 180: берёт тело глифа и не берёт растушёвку тени. Второго PNG-декодера не
 * заводится: `decodeRgb` — тот же, которым `where` считает PSNR.
 */
function inkOf(rgb: Uint8Array, width: number, height: number): Ink {
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if ((rgb[i] ?? 0) >= 64 || (rgb[i + 1] ?? 0) >= 64 || (rgb[i + 2] ?? 0) >= 64) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  let sum = 0;
  let count = 0;
  for (let y = Math.max(top, 0); y <= bottom; y++) {
    for (let x = Math.max(left, 0); x <= right; x++) {
      const i = (y * width + x) * 3;
      const r = rgb[i] ?? 0;
      const g = rgb[i + 1] ?? 0;
      const b = rgb[i + 2] ?? 0;
      if (r < 180 || g < 180 || b < 180) continue;
      sum += r - b;
      count += 1;
    }
  }

  let bgSum = 0;
  for (let x = 0; x < width; x++) {
    const i = x * 3;
    bgSum += (rgb[i] ?? 0) - (rgb[i + 2] ?? 0);
  }

  return {
    textWarmth: count === 0 ? 0 : sum / count,
    textPixels: count,
    backgroundWarmth: bgSum / width,
  };
}

/** Один рендер: грейд на заданном `z`, субтитры со шрифтом, полное разрешение. */
async function measure(z: number): Promise<Ink> {
  const fixture = makeTemplateFixture(
    [
      { template: 'grade@1', params: SEPIA_ONLY, z },
      // Клип эмфазы нужен ТОЛЬКО чтобы в запросе оказался шрифт: раскладку полосы ставит
      // ТРЕК (`H-07`), а `withFont` объявляется клипом.
      {
        template: 'captionEmphasis@1',
        params: FIXTURE_PARAMS.captionEmphasis,
        z: 30,
        withFont: true,
        window: { frameStart: 0, frameEnd: FRAMES },
      },
    ],
    { frames: FRAMES, scale: 1, workers: 1, withCaptions: true, captionWindows: [[0, FRAMES]] },
  );
  const request = await readyRequest(fixture.request);
  const response = await renderSegment(request, {
    clock: realClock(),
    registry: rendererTemplates,
    parentEnv: process.env,
    gate: { mode: 'skip', why: 'проба Н2 `E-07`: грейд и субтитры; гейт здесь не снимается' },
  });
  if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);
  const name = readdirSync(response.frames.dir)
    .filter((n) => n.endsWith('.png'))
    .sort()[0];
  if (name === undefined) throw new Error('кадров на диске нет');
  const file = path.join(response.frames.dir, name);
  const size = pngSize(file);
  if (size === null) throw new Error(`PNG не прочитан: ${file}`);
  return inkOf(await decodeRgb(file), size.width, size.height);
}

describe('**Н2** `E-07` — грейд лежит ПОД `#captions`: белый текст остаётся белым', () => {
  it(
    'при `z` под субтитрами текст нейтрален, при `z` над ними — тёплый, фон тёплый всегда',
    async () => {
      const under = await measure(Z_UNDER_CAPTIONS);
      const above = await measure(Z_ABOVE_CAPTIONS);
      const where =
        `z=${String(Z_UNDER_CAPTIONS)}: текст R−B ${under.textWarmth.toFixed(2)} ` +
        `на ${String(under.textPixels)} пикселях, фон R−B ${under.backgroundWarmth.toFixed(2)}; ` +
        `z=${String(Z_ABOVE_CAPTIONS)}: текст R−B ${above.textWarmth.toFixed(2)} ` +
        `на ${String(above.textPixels)} пикселях, фон R−B ${above.backgroundWarmth.toFixed(2)}`;

      // 0. МЕРИЛИ НЕ ПУСТОТУ. Ноль белых пикселей внутри плашки означал бы, что полосы в
      //    кадре нет вовсе, и оба утверждения ниже стали бы зелёными ни о чём.
      expect(under.textPixels, where).toBeGreaterThan(2000);
      expect(above.textPixels, where).toBeGreaterThan(2000);

      // 1. ШТАТНЫЙ `z`: ТЕКСТ НЕЙТРАЛЕН. `BAND.textColor` — `#ffffff`, то есть `R − B = 0`
      //    по построению; допуск 1.0 — это сглаживание глифов и тень, а не тон.
      //    ИЗМЕРЕНО (`E-07`, эта машина): −0.07.
      expect(under.textWarmth, where).toBeLessThan(1);

      // 2. НАРУШЕНИЕ Н2: грейд над `#captions` — и текст ПОТЕПЛЕЛ. Это вторая половина
      //    охранника: без неё утверждение 1 было бы зелёным и на грейде, которого нет.
      //    ИЗМЕРЕНО там же: 18.31 — вдвое выше порога, то есть порог не подогнан под замер.
      expect(above.textWarmth, where).toBeGreaterThan(8);

      // 3. ФОН СТРАНИЦЫ НЕ КРАСИТСЯ НИ В ОДНОМ ИЗ ДВУХ, и это ЗАПИСАННОЕ ИЗМЕРЕНИЕ, а не
      //    недосмотр (см. шапку): белый кадра рисует поверхность страницы, а не слой, и в
      //    backdrop он не входит. Утверждение стоит здесь, чтобы день, когда `backdrop-filter`
      //    начнёт доставать до подложки страницы, был виден тестом — от этого зависит форма
      //    запроса гейта.
      expect(Math.abs(under.backgroundWarmth), where).toBeLessThan(1);
      expect(Math.abs(above.backgroundWarmth), where).toBeLessThan(1);
    },
    TIMEOUT,
  );
});

describe('`E-07` — грейд КРАСИТ слой под собой: пиксельный охранник самого шаблона', () => {
  /** Средняя теплота кадра целиком. Субтитров в этой пробе нет — рамка не нужна. */
  const warmthOf = (rgb: Uint8Array): number => {
    let sum = 0;
    const pixels = rgb.length / 3;
    for (let i = 0; i < rgb.length; i += 3) sum += (rgb[i] ?? 0) - (rgb[i + 2] ?? 0);
    return sum / pixels;
  };

  async function frameWarmth(withGrade: boolean): Promise<number> {
    const clips = [
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      ...(withGrade ? [{ template: 'grade@1', params: SEPIA_ONLY, z: Z_UNDER_CAPTIONS }] : []),
    ];
    const fixture = makeTemplateFixture(clips, { frames: FRAMES, scale: 1, workers: 1 });
    const request = await readyRequest(fixture.request);
    const response = await renderSegment(request, {
      clock: realClock(),
      registry: rendererTemplates,
      parentEnv: process.env,
      gate: { mode: 'skip', why: 'проба `E-07`: грейд красит слой под собой' },
    });
    if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);
    const name = readdirSync(response.frames.dir)
      .filter((n) => n.endsWith('.png'))
      .sort()[0];
    if (name === undefined) throw new Error('кадров на диске нет');
    return warmthOf(await decodeRgb(path.join(response.frames.dir, name)));
  }

  it(
    'та же картинка под грейдом теплеет, без грейда — нейтральна',
    async () => {
      // Картинка фикстуры — СЕРАЯ шахматка с градиентом, то есть `R − B = 0` по построению.
      // Значит теплота кадра есть чистая мера того, что сделал грейд, а не свойство ассета.
      const plain = await frameWarmth(false);
      const graded = await frameWarmth(true);
      const where = `без грейда R−B ${plain.toFixed(2)}, под грейдом R−B ${graded.toFixed(2)}`;
      expect(Math.abs(plain), where).toBeLessThan(1);
      expect(graded, where).toBeGreaterThan(8);
    },
    TIMEOUT,
  );
});
