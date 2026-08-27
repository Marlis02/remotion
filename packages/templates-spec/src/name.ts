// Грамматика имени вызова шаблона — **одно место в репозитории** (долг №37).
//
// ПОЧЕМУ ГРАММАТИКА ЖИВЁТ ЗДЕСЬ, А НЕ В `core-model` И НЕ В `@vpe/schema`. Схема `direction/1`
// объявляет поле `template: identifier()` — то есть непустую строку, и это осознанно:
// «грамматику `templateId` (включая допустимый префикс `local:` — Charter V3) нормирует
// манифест шаблона (`TS-01`)» (комментарий в `families/direction.ts`). `core-model` объявил
// ТИП `TemplateCall` и не написал функцию, которая его строит, по той же причине
// (`model/entities.ts`): она построила бы вторую грамматику раньше первой. Первая — здесь.
//
// ЧТО ИМЕННО НОРМИРУЕТСЯ. Строка файла (`kenburns@1`) → тройка Charter V3
// (`{templateId, templateVersion}`) плюс namespace. Версия обязана быть ОТДЕЛЬНОЙ величиной:
// V3 требует, чтобы она входила в ключ кэша сама по себе, а не куском имени.
//
// `local:` — ОДНА СТРОКА В ГРАММАТИКЕ, ВВОДИТСЯ СРАЗУ (ADR-0008, «Оспариваю V3 в части
// механизма eject»): «необратимая часть — допустимость namespace `local:` в `templateId` —
// вводится сразу, это одна строка в схеме». Команды `vpe template fork` в v1 нет, и здесь её
// тоже нет: разбор имени и механика форка — разные вещи.
//
// ДРУГИХ NAMESPACE'ОВ НЕТ, И ЭТО ОТКАЗ, А НЕ УМОЛЧАНИЕ. ADR-0008 называет ровно один префикс.
// Принять неизвестный namespace значило бы завести пространство имён, которого не решал
// никто, — и обнаружить его в первый раз на рендере.

import { TemplateSpecError } from './errors.js';

/**
 * Единственный namespace имени вызова — `local:` (Charter V3, ADR-0008). `null` — шаблон
 * библиотеки; `'local'` — форк в локальном реестре проекта.
 */
export type TemplateNamespace = 'local';

/** Разобранное имя вызова: тройка, которой оперирует Charter V3. */
export interface TemplateName {
  /** `null` — библиотечный шаблон; `'local'` — форк проекта (обязан нести `forkedFrom`). */
  readonly namespace: TemplateNamespace | null;
  /** Имя БЕЗ префикса и БЕЗ версии: `kenburns`. */
  readonly templateId: string;
  /** Целое ≥ 1. Версия — отдельная величина ключа кэша (V3), а не кусок строки. */
  readonly templateVersion: number;
}

/**
 * Регулярка имени — ЕДИНСТВЕННАЯ в репозитории.
 *
 * * `(?:(local):)?` — namespace, закрытый список из одного элемента;
 * * `[a-z][A-Za-z0-9]*` — id в lowerCamelCase: все пять имён фикстуры (`kenburns`, `still`,
 *   `flash`, `captionEmphasis`, `bed`) и все семь имён roadmap §5 (`shaderBg`, `parallax25`,
 *   `kineticType`, `particles`, `glassCard`, `lumaWipe`, `grade`) в него укладываются. Дефисы
 *   и подчёркивания не допускаются: два написания одного имени — это два ключа кэша;
 * * `@[1-9][0-9]*` — версия без ведущих нулей и без нуля. `kenburns@0` отвергается: версия
 *   шаблона нумеруется с единицы (`still@1` в ADR-0002 §4), а `@01` и `@1` были бы двумя
 *   строками для одной версии.
 */
const TEMPLATE_NAME = /^(?:(local):)?([a-z][A-Za-z0-9]*)@([1-9][0-9]*)$/;

/**
 * Разбирает имя вызова шаблона (Charter V3, ADR-0008).
 *
 * @throws {TemplateSpecError} `V3` — имя не соответствует грамматике.
 */
export function parseTemplateName(raw: string): TemplateName {
  if (typeof raw !== 'string') {
    throw new TemplateSpecError('V3', `имя вызова обязано быть строкой, получено ${typeof raw}`);
  }
  const m = TEMPLATE_NAME.exec(raw);
  if (m === null || m[2] === undefined || m[3] === undefined) {
    throw new TemplateSpecError(
      'V3',
      'имя вызова не разбирается. Форма — `<id>@<N>` либо `local:<id>@<N>`: id в ' +
        'lowerCamelCase, версия — целое ≥ 1 без ведущих нулей. Единственный допустимый ' +
        'namespace — `local:` (форк шаблона, ADR-0008); других пространств имён нет',
      { template: raw },
    );
  }
  return {
    namespace: m[1] === undefined ? null : 'local',
    templateId: m[2],
    // `[1-9][0-9]*` гарантирует целое без знака; `Number` здесь обратим по построению.
    templateVersion: Number(m[3]),
  };
}

/**
 * Каноническая запись имени — обратна `parseTemplateName`.
 *
 * Ключ реестра берётся отсюда, а не склеивается на месте: две склейки разъехались бы, и
 * `local:kenburns@1` попал бы в реестр под тем же ключом, что `kenburns@1`, — то есть форк
 * молча заместил бы библиотечный шаблон.
 */
export function formatTemplateName(name: TemplateName): string {
  const prefix = name.namespace === null ? '' : `${name.namespace}:`;
  return `${prefix}${name.templateId}@${String(name.templateVersion)}`;
}
