// Синтетический шаблон `solid@1` для живого теста команды `vpe template gate`.
//
// ПОЧЕМУ ВТОРАЯ КОПИЯ, А НЕ ИМПОРТ ИЗ `renderer-hyperframes/test/solid.ts`. Импорт тестового
// файла ЧУЖОГО пакета не собирается `tsc --build` (файл вне `rootDir` проекта), а выносить
// тестовый шаблон в публичную поверхность пакета нельзя: он не часть контракта. Копия названа
// здесь и стоит под тем же охранником — `tests/lints/d4-composition.test.ts` перечисляет ОБА
// файла поимённо, то есть `Math.random`, `Date` и `Intl` запрещены и в ней.
//
// ПОЧЕМУ ОН ВООБЩЕ НУЖЕН. Реализаций настоящих шаблонов нет ни одной до `H-06`, то есть живой
// прогон команды на ПРОД-паре сегодня невозможен по построению. `solid@1` доказывает сквозной
// путь КОМАНДЫ: аргументы → каталог → `runGate` → N прогонов браузера → запись на диске.

import type { RendererTemplateRegistry } from '@vpe/renderer-hyperframes';

/** Текст функции монтирования: исполняется В БРАУЗЕРЕ (композиция собирается без сборщика). */
const SOLID_MOUNT = `function (host, ctx) {
        var fill = document.createElement('div');
        fill.className = 'solid-fill';
        fill.style.position = 'absolute';
        fill.style.inset = '0';
        fill.style.background = String(ctx.params.color);
        host.appendChild(fill);
        host.style.opacity = '0';
        ctx.timeline.set(host, {opacity: 1}, ctx.toSeconds(ctx.frames.start));
        ctx.timeline.set(host, {opacity: 0}, ctx.toSeconds(ctx.frames.end));
      }`;

/** Реестр реализаций для живого теста: один синтетический шаблон, продакшн-реестр не тронут. */
export const TEST_TEMPLATES: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([
    { templateId: 'solid', templateVersion: 1, mountSource: SOLID_MOUNT },
  ]) as RendererTemplateRegistry['templates'],
});
