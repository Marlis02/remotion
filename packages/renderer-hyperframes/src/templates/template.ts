// **КОНТРАКТ РЕАЛИЗАЦИИ ШАБЛОНА И РАЗРЕШЕНИЕ ИМЕНИ** — рукописная половина реестра.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ (`TPL-01a`, 2026-09-09). Соседний `index.ts` стал ПРОИЗВОДНЫМ от
// листинга каталога (`scripts/gen-template-registry.mjs`), а типы контракта, версия реестра и
// текст отказа `resolveTemplate` из листинга не выводятся ничем. Держать их внутри
// генерируемого файла значило бы держать код в строковом литерале генератора: правка контракта
// шла бы мимо `tsc` и мимо ESLint. Здесь они — обычный TypeScript.
//
// ЧТО ЗДЕСЬ НЕ ЖИВЁТ: состав реестра. Он в `index.ts`, и он генерируется.

import { parseTemplateName, type TemplateName } from '@vpe/templates-spec';

import { RenderAdapterError } from '../errors.js';

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
 * Версия реестра реализаций — та же величина, что `compileProfile.templateRegistryVersion`.
 *
 * **ОНА НЕ МЕНЯЕТСЯ НАПОЛНЕНИЕМ РЕЕСТРА, И ЭТО РАССУЖДЕНИЕ `H-06`:** сменилась бы она —
 * сменились бы ключи кэша ВСЕХ сегментов ради появления кода, которого ни один существующий
 * сегмент не зовёт. Живёт здесь, а не в генерируемом `index.ts`, ровно потому, что из листинга
 * каталога не выводится: генератор, взявший её из числа папок, менял бы ключи кэша на каждом
 * новом шаблоне — то самое, чего это правило не разрешает.
 */
export const RENDERER_TEMPLATE_REGISTRY_VERSION = '1';

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
