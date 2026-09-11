// **ФАЙЛ СГЕНЕРИРОВАН — `node scripts/gen-template-registry.mjs`. РУКАМИ НЕ ПРАВИТЬ.**
// Правка руками краснеет в `tests/lints/template-registry-generated.test.ts`; текст шапки и
// форма файла живут в генераторе, состав — в листинге каталога.
//
// Реестр РЕАЛИЗАЦИЙ шаблонов рендерера. Единица — ПАПКА `<id>@<n>/impl.ts` (`TPL-01a`).
//
// ДВА РЕЕСТРА, И ЭТО НЕ ДУБЛИРОВАНИЕ. `templates-spec` (`TS-01`) держит СПЕК: схему `params`,
// чистые `declareAssets`/`declareFonts`, манифест с записями гейта. Здесь живёт РЕАЛИЗАЦИЯ:
// код, который рисует. Разделение несущее — карта ADR-0009: `compile` зависит от
// `templates-spec` и не имеет права видеть `gsap`; если бы реализация лежала рядом со спекой,
// `render-ir` потянул бы за собой рендерер и его библиотеку анимации. Поэтому «папка шаблона»
// — это ДВЕ папки с одним именем, по одной в каждом пакете, а не одна.
//
// ШАБЛОН БЕЗ РЕАЛИЗАЦИИ — ОШИБКА ДО ЗАПУСКА БРАУЗЕРА, А НЕ ЗАГЛУШКА НА ЭКРАНЕ. Пустой слой
// вместо шаблона — это ролик, который собрался и выглядит не так; отказ — это ролик, который
// не собрался. Второе дешевле ровно на стоимость просмотра. Отказ поднимает `resolveTemplate`
// в рукописном [`./template.ts`](./template.ts) — там же живут типы контракта и версия
// реестра, потому что генератору выводить их не из чего.
//
// Цикл `index → <id>@<n>/impl → index` существует только в ТИПАХ (`import type` стирается
// компиляцией), поэтому в рантайме стрелка одна: реестр тянет файлы реализаций, они его — нет.

import {
  RENDERER_TEMPLATE_REGISTRY_VERSION,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './template.js';

import { bed1Impl } from './bed@1/impl.js';
import { captionEmphasis1Impl } from './captionEmphasis@1/impl.js';
import { flash1Impl } from './flash@1/impl.js';
import { grade1Impl } from './grade@1/impl.js';
import { kenburns1Impl } from './kenburns@1/impl.js';
import { parallax251Impl } from './parallax25@1/impl.js';
import { still1Impl } from './still@1/impl.js';
import { video1Impl } from './video@1/impl.js';

export {
  resolveTemplate,
  RENDERER_TEMPLATE_REGISTRY_VERSION,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './template.js';

/**
 * Продакшн-реестр реализаций — 8 единиц.
 *
 * Версия — та же величина, что `compileProfile.templateRegistryVersion` у спеков: если
 * реализации разъедутся со спеками, ключ кэша обязан это заметить (**K6**). Она НЕ меняется
 * наполнением реестра — менялись бы ключи кэша всех сегментов ради появления кода, которого
 * ни один существующий сегмент не зовёт. Композиция несёт только ИСПОЛЬЗОВАННЫЕ шаблоны
 * (`materialize.ts`), и это измерено дважды: `E-07` и `E-02` сверили прежние файлы
 * `gate-requests/` побайтово после добавления шестого и седьмого шаблона.
 */
export const rendererTemplates: RendererTemplateRegistry = Object.freeze({
  version: RENDERER_TEMPLATE_REGISTRY_VERSION,
  templates: Object.freeze([
    bed1Impl,
    captionEmphasis1Impl,
    flash1Impl,
    grade1Impl,
    kenburns1Impl,
    parallax251Impl,
    still1Impl,
    video1Impl,
  ]) as readonly RendererTemplate[],
});
