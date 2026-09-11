// Синтетический шаблон `markers@1` — ЛИНЕЙКА ГЕОМЕТРИИ, только для `scale-render.test.ts`.
//
// ЗАЧЕМ ОН НУЖЕН ОТДЕЛЬНО ОТ `solid@1`. `solid@1` заливает слой целиком, и по его кадру
// нельзя отличить «кадр занят композицией» от «кадр занят ЧЕТВЕРТЬЮ композиции, растянутой
// на весь кадр»: доля нечёрных пикселей равна 100 в обоих случаях. Ровно на этом сломался
// прежний охранник №182 — дефект №265 (`DEMO-POMPEII`) он держал зелёным полгода. Линейка
// отвечает на другой вопрос: ГДЕ в кадре оказалась известная точка композиции.
//
// ЧТО РИСУЕТ: непрозрачный фон `rgb(32,32,32)` во весь слой, четыре квадрата 100×100 по углам
// БАЗОВОЙ композиции (красный ЛВ, зелёный ПВ, синий ЛН, жёлтый ПН) и полосу во всю ширину
// высотой 120 px на `bottom: 500px` — ровно там, где `runtime.js` держит полосу субтитров
// (`BAND.bottomPx`). Числа взяты у полосы намеренно: дефект №265 был виден именно как
// пропавшие субтитры, и линейка обязана мерить ту же строку.
//
// ЦВЕТА ПОДОБРАНЫ ТАК, ЧТОБЫ ВЫЖИТЬ ПОСЛЕ УМЕНЬШЕНИЯ: чистые основные и фон, отличный от
// нуля, — тогда `bbox` по цвету с допуском не слипается ни с фоном, ни с соседом.
//
// D4 ДЕЙСТВУЕТ И ЗДЕСЬ (как у `solid.ts`): `mountSource` едет в композицию, то есть в
// рендер-путь, и греп `tests/lints/d4-composition.test.ts` смотрит на этот файл. Ни `Date`,
// ни `Math.random`, ни `Intl` в нём нет и быть не может.

import type { RendererTemplate, RendererTemplateRegistry } from '../src/templates/index.js';

import { SOLID_TEMPLATE } from './solid.js';

/** Сторона углового маркера в БАЗОВЫХ пикселях композиции. */
export const MARKER_SIZE = 100;
/** Высота полосы и её отступ от низа — числа полосы субтитров `runtime.js`. */
export const BAND_HEIGHT = 120;
export const BAND_BOTTOM = 500;

/** Цвета линейки: имя → `[r, g, b]`. Порядок — ЛВ, ПВ, ЛН, ПН, полоса. */
export const MARKER_COLORS = Object.freeze({
  topLeft: [255, 0, 0],
  topRight: [0, 255, 0],
  bottomLeft: [0, 0, 255],
  bottomRight: [255, 255, 0],
  band: [255, 0, 255],
  background: [32, 32, 32],
} as const);

const MARKERS_MOUNT = `function (host, ctx) {
        var W = window.__VPE_MANIFEST.baseWidth;
        var H = window.__VPE_MANIFEST.baseHeight;
        var S = ${String(MARKER_SIZE)};
        function box(left, top, w, h, color, id) {
          var d = document.createElement('div');
          d.id = id;
          d.style.position = 'absolute';
          d.style.left = String(left) + 'px';
          d.style.top = String(top) + 'px';
          d.style.width = String(w) + 'px';
          d.style.height = String(h) + 'px';
          d.style.background = color;
          host.appendChild(d);
        }
        box(0, 0, W, H, 'rgb(32,32,32)', 'm-bg');
        box(0, 0, S, S, 'rgb(255,0,0)', 'm-tl');
        box(W - S, 0, S, S, 'rgb(0,255,0)', 'm-tr');
        box(0, H - S, S, S, 'rgb(0,0,255)', 'm-bl');
        box(W - S, H - S, S, S, 'rgb(255,255,0)', 'm-br');
        box(0, H - ${String(BAND_BOTTOM + BAND_HEIGHT)}, W, ${String(BAND_HEIGHT)}, 'rgb(255,0,255)', 'm-band');
        ctx.timeline.set(host, {opacity: 1}, ctx.toSeconds(ctx.frames.frameStart));
      }`;

export const MARKERS_TEMPLATE: RendererTemplate = Object.freeze({
  templateId: 'markers',
  templateVersion: 1,
  mountSource: MARKERS_MOUNT,
});

/** Реестр линейки: продакшн-реестр пуст, поэтому здесь только синтетика. */
export const MARKERS_REGISTRY: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([SOLID_TEMPLATE, MARKERS_TEMPLATE]) as readonly RendererTemplate[],
});
