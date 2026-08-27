// Реестр РЕАЛИЗАЦИЙ шаблонов рендерера.
//
// ДВА РЕЕСТРА, И ЭТО НЕ ДУБЛИРОВАНИЕ. `templates-spec` (`TS-01`) держит СПЕК: схему `params`,
// чистые `declareAssets`/`declareFonts`, манифест с записями гейта. Здесь живёт РЕАЛИЗАЦИЯ:
// код, который рисует. Разделение несущее — карта ADR-0009: `compile` зависит от
// `templates-spec` и не имеет права видеть `gsap`; если бы реализация лежала рядом со спекой,
// `render-ir` потянул бы за собой рендерер и его библиотеку анимации.
//
// РЕЕСТР ПУСТ, И ЭТО КРИТЕРИЙ, А НЕ НЕДОДЕЛКА. Реализации фикстурных шаблонов (`still@1`,
// `kenburns@1`, `flash@1`, `captionEmphasis@1`, `bed@1`) — задача `H-06`. `H-01` доказывает
// СКВОЗНОЙ ПУТЬ, и для этого достаточно одного синтетического шаблона, который регистрируется
// ТОЛЬКО из теста и в продакшн-реестр не попадает (охранник — `templates.test.ts`).
//
// ШАБЛОН БЕЗ РЕАЛИЗАЦИИ — ОШИБКА ДО ЗАПУСКА БРАУЗЕРА, А НЕ ЗАГЛУШКА НА ЭКРАНЕ. Пустой слой
// вместо шаблона — это ролик, который собрался и выглядит не так; отказ — это ролик, который
// не собрался. Второе дешевле ровно на стоимость просмотра.

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
   * (карта sha → `{url, family}`), `frames` (`{start, end}` клипа), `fps`, `gsap`.
   */
  readonly mountSource: string;
}

export interface RendererTemplateRegistry {
  readonly version: string;
  readonly templates: readonly RendererTemplate[];
}

/**
 * Продакшн-реестр реализаций. ПУСТ до `H-06`.
 *
 * Версия — та же величина, что `compileProfile.templateRegistryVersion` у спеков: если
 * реализации разъедутся со спеками, ключ кэша обязан это заметить (**K6**). Сверку версий
 * ставит `L-01`, здесь только значение.
 */
export const rendererTemplates: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([]) as readonly RendererTemplate[],
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
