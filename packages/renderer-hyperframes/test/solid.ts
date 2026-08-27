// Синтетический шаблон `solid@1` — ТОЛЬКО для тестов `H-01`.
//
// ПОЧЕМУ ОН ЖИВЁТ В `test/`, А НЕ В `src/templates/`. Реализации фикстурных шаблонов —
// задача `H-06`, и попадание сюда чего бы то ни было настоящего размыло бы её границу.
// `solid@1` доказывает СКВОЗНОЙ ПУТЬ (IR → каталог → браузер → PNG → артефакт) и ничего
// сверх: заливка цветом из `params` плюс `<img>` объявленного ассета. Он не рисует движения,
// не читает шрифт и не претендует на гейт V13.
//
// ОХРАННИК ТОГО, ЧТО ОН НЕ УТЁК В ПРОДАКШН, — `templates.test.ts`: продакшн-реестр обязан
// быть пуст, и `solid@1` в нём не находится.
//
// D4 ДЕЙСТВУЕТ И ЗДЕСЬ: `mountSource` попадает в композицию, то есть в рендер-путь. Ни
// `Math.random`, ни `Date`, ни `Intl` — греп-охранник `tests/lints/d4-composition.test.ts`
// смотрит и на этот файл.

import type { RendererTemplate, RendererTemplateRegistry } from '../src/templates/index.js';

/**
 * Текст функции монтирования. Строкой — потому что она исполняется В БРАУЗЕРЕ, а композиция
 * собирается конкатенацией без сборщика (ADR-0009: «источник и есть HTML»).
 *
 * `ctx.params.color` приходит из IR как есть: `params` уже прогнаны через `paramsSchema`
 * шаблона компилятором (`CP-07`), и второй проверки здесь быть не должно.
 */
const SOLID_MOUNT = `function (host, ctx) {
        var fill = document.createElement('div');
        fill.className = 'solid-fill';
        fill.style.position = 'absolute';
        fill.style.inset = '0';
        fill.style.background = String(ctx.params.color);
        host.appendChild(fill);
        if (ctx.assets.length > 0) {
          var img = document.createElement('img');
          img.className = 'solid-asset';
          img.src = ctx.assetUrl(ctx.assets[0].sha256);
          img.style.position = 'absolute';
          img.style.left = '0';
          img.style.top = '0';
          img.style.width = '50%';
          img.style.height = '50%';
          img.style.imageRendering = 'pixelated';
          host.appendChild(img);
        }
        host.style.opacity = '0';
        ctx.timeline.set(host, {opacity: 1}, ctx.toSeconds(ctx.frames.start));
        ctx.timeline.set(host, {opacity: 0}, ctx.toSeconds(ctx.frames.end));
      }`;

export const SOLID_TEMPLATE: RendererTemplate = Object.freeze({
  templateId: 'solid',
  templateVersion: 1,
  mountSource: SOLID_MOUNT,
});

/** Реестр тестов: продакшн-реестр + один синтетический шаблон. */
export const TEST_REGISTRY: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([SOLID_TEMPLATE]) as readonly RendererTemplate[],
});
