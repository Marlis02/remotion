// Реестр РЕАЛИЗАЦИЙ шаблонов рендерера.
//
// ДВА РЕЕСТРА, И ЭТО НЕ ДУБЛИРОВАНИЕ. `templates-spec` (`TS-01`) держит СПЕК: схему `params`,
// чистые `declareAssets`/`declareFonts`, манифест с записями гейта. Здесь живёт РЕАЛИЗАЦИЯ:
// код, который рисует. Разделение несущее — карта ADR-0009: `compile` зависит от
// `templates-spec` и не имеет права видеть `gsap`; если бы реализация лежала рядом со спекой,
// `render-ir` потянул бы за собой рендерер и его библиотеку анимации.
//
// ~~РЕЕСТР ПУСТ, И ЭТО КРИТЕРИЙ, А НЕ НЕДОДЕЛКА.~~ *(изменено: `H-06`, 2026-08-29.)* **РЕЕСТР
// НАПОЛНЕН: ~~пять~~ ~~шесть~~ СЕМЬ реализаций.** *(дополнено: `E-07`, 2026-08-31 — `grade@1`;
// `E-02`, 2026-08-31 — `parallax25@1`.)*
// `H-01` доказывал СКВОЗНОЙ ПУТЬ одним синтетическим шаблоном,
// который регистрируется ТОЛЬКО из теста и в продакшн-реестр не попадает (охранник —
// `test/templates.test.ts`); теперь рядом с этим утверждением стоит второе — состав реестра
// совпадает с `TEMPLATE_LIBRARY` спеков поимённо.
//
// ШАБЛОН БЕЗ РЕАЛИЗАЦИИ — ОШИБКА ДО ЗАПУСКА БРАУЗЕРА, А НЕ ЗАГЛУШКА НА ЭКРАНЕ. Пустой слой
// вместо шаблона — это ролик, который собрался и выглядит не так; отказ — это ролик, который
// не собрался. Второе дешевле ровно на стоимость просмотра.

import { parseTemplateName, type TemplateName } from '@vpe/templates-spec';

import { RenderAdapterError } from '../errors.js';
// Импорты РЕАЛИЗАЦИЙ — ниже объявления типа по смыслу, но выше по файлу по требованию линта.
// Цикл `index → <id>@1 → index` существует только в ТИПАХ (`import type` стирается компиляцией),
// поэтому в рантайме стрелка одна: реестр тянет семь файлов, они его — нет.
import { bed1Impl } from './bed@1.js';
import { captionEmphasis1Impl } from './captionEmphasis@1.js';
import { flash1Impl } from './flash@1.js';
import { grade1Impl } from './grade@1.js';
import { kenburns1Impl } from './kenburns@1.js';
import { parallax251Impl } from './parallax25@1.js';
import { still1Impl } from './still@1.js';

/**
 * Реализация одного шаблона в браузере.
 *
 * `mount` исполняется В КОМПОЗИЦИИ (в браузере), а не в Node: сюда попадает только его
 * ИСХОДНЫЙ ТЕКСТ, который материализация кладёт в каталог. Поэтому тип описывает контракт
 * функции, а не даёт её вызвать из адаптера.
 */
export interface RendererTemplate {
  /** Имя БЕЗ версии — как у спека (`TemplateSpec.templateId`). */
  readonly templateId: string;
  readonly templateVersion: number;
  /**
   * Исходный текст функции монтирования, вставляемый в композицию.
   *
   * Строкой, а не функцией: композиция — HTML без сборщика (ADR-0009, «Композиция — каталог,
   * а не файл и не бандл»), и перенести туда замыкание из Node невозможно. Текст обязан быть
   * выражением-функцией вида `function (host, ctx) { … }`.
   *
   * `ctx` несёт: `params` клипа, `assets` (карта sha → относительный URL), `fonts`
   * (карта sha → `{url, family}`), `frames` (окно клипа ~~`{start, end}`~~
   * **`{frameStart, frameEnd}`** — `FrameInterval` модели, `L-01`, долг №168), `fps`, `gsap`.
   */
  readonly mountSource: string;
}

export interface RendererTemplateRegistry {
  readonly version: string;
  readonly templates: readonly RendererTemplate[];
}

/**
 * Продакшн-реестр реализаций — ~~**пять единиц** (`H-06`)~~ ~~шесть~~ **СЕМЬ единиц**
 * (`E-07`, `E-02`).
 *
 * Версия — та же величина, что `compileProfile.templateRegistryVersion` у спеков: если
 * реализации разъедутся со спеками, ключ кэша обязан это заметить (**K6**). Сверку версий
 * ставит `L-01`, здесь только значение; версия НЕ меняется наполнением реестра — менялись бы
 * ключи кэша всех сегментов ради появления кода, которого до `H-06` просто не звали.
 *
 * ПОРЯДОК — ПОРЯДОК `TEMPLATE_LIBRARY` спеков, то есть порядок записей
 * `fixtures/minimal/direction/01-intro.yaml`, а шестым — `grade@1`, которого фикстура не
 * зовёт вовсе, седьмым — `parallax25@1`, которого она не зовёт тоже. Он ни на что не влияет
 * (реестр адресует по имени), и именно поэтому взят тот же: любой другой пришлось бы
 * объяснять.
 *
 * **ВЕРСИЯ РЕЕСТРА ОТ ШЕСТОГО ШАБЛОНА НЕ МЕНЯЕТСЯ, И ЭТО ТО ЖЕ РАССУЖДЕНИЕ, ЧТО У `H-06`:**
 * сменилась бы она — сменились бы ключи кэша ВСЕХ сегментов ради появления кода, которого
 * ни один существующий сегмент не зовёт. Композиция несёт только ИСПОЛЬЗОВАННЫЕ шаблоны
 * (`materialize.ts`), поэтому `bundle.hash` прежних запросов гейта от `grade@1` не двигается
 * — измерено `E-07` побайтовой сверкой восьми файлов `gate-requests/`. **`E-02` повторил тот
 * же опыт на СЕДЬМОМ шаблоне и получил тот же ответ:** десять прежних файлов `gate-requests/`
 * побайтово те же, версия реестра не менялась.
 */
export const rendererTemplates: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([
    kenburns1Impl,
    flash1Impl,
    bed1Impl,
    still1Impl,
    captionEmphasis1Impl,
    grade1Impl,
    parallax251Impl,
  ]) as readonly RendererTemplate[],
});

/**
 * Находит реализацию по имени вызова из IR (`solid@1`, `local:kenburns@1`).
 *
 * Грамматику имени разбирает `templates-spec` (`TS-01`, единственная регулярка в
 * репозитории, долг №37) — второй разбор здесь означал бы вторую грамматику.
 *
 * @throws {RenderAdapterError} `V3` — имя не разбирается или реализации нет.
 */
export function resolveTemplate(
  registry: RendererTemplateRegistry,
  call: string,
  at: string,
): RendererTemplate {
  let name: TemplateName;
  try {
    name = parseTemplateName(call);
  } catch (err) {
    throw new RenderAdapterError('V3', `${at}: имя вызова \`${call}\` не разбирается`, [
      { rule: 'V3', at, message: String((err as Error).message) },
    ]);
  }
  const found = registry.templates.find(
    (t) => t.templateId === name.templateId && t.templateVersion === name.templateVersion,
  );
  if (found !== undefined) return found;

  const known =
    registry.templates.length === 0
      ? 'реестр реализаций ПУСТ (реализации шаблонов — задача `H-06`)'
      : `реестр знает: ${registry.templates.map((t) => `${t.templateId}@${String(t.templateVersion)}`).join(', ')}`;
  throw new RenderAdapterError('V3', `${at}: у шаблона \`${call}\` нет реализации`, [
    {
      rule: 'V3',
      at,
      message:
        `${known}. Отказ выдан ДО запуска браузера и намеренно: заглушка вместо шаблона дала ` +
        'бы собравшийся ролик, выглядящий не так, — а это дороже несобравшегося ровно на ' +
        'стоимость просмотра',
    },
  ]);
}
