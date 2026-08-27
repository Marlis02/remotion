// Ошибка контракта шаблона: реестр, манифест, гейт.
//
// ОШИБКА НАЗЫВАЕТ ПРАВИЛО, А НЕ СЛЕДСТВИЕ — как `ModelError` (`C-05`), `TimeModelError`
// (`C-01`) и `AnchorLedgerError` (`C-04`). «Шаблон не найден» — следствие; «V3: имя вызова
// не разбирается» — причина, и по ней сразу видно, какую строку Charter или реестра
// инвариантов читать.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ КЛАСС. Место здесь — **шаблон**, а не файл режиссуры (`ModelError`), не
// позиция в прозе (`SourceParseError`) и не строка ledger'а. Человек, читающий такую ошибку,
// идёт править спек шаблона или снимать гейт командой `vpe template gate` (`E-00`) — адрес
// обязан быть именем шаблона.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ошибок zod. Форму манифеста и форму `params` проверяют zod-схемы и бросают
// `z.ZodError` с путём к полю; дублировать это здесь значило бы держать вторую копию
// контракта. Ошибка ниже поднимается там, где zod не судья: имя вызова, состав реестра,
// наличие записи гейта для пары.

/** Правила, на которые ссылаются ошибки контракта шаблона. */
export type TemplateRule =
  /** Charter V3 — вызов `{template, params}`; грамматика имени, включая `local:` (ADR-0008). */
  | 'V3'
  /** Charter V13 / инвариант R12 — сборка не стартует без записи гейта для пары. */
  | 'R12'
  /** Реестр шаблонов: состав, дубли, отказ регистрации (roadmap `TS-01`, `E-00`). */
  | 'TS-01 реестр'
  /** ADR-0008 «Декларация ресурсов шаблона» — чистые `declareAssets`/`declareFonts`. */
  | 'ADR-0008 декларация';

/** Где именно нарушено правило. Оба поля необязательны: не у всякого нарушения есть шаблон. */
export interface TemplateErrorPlace {
  /** Имя вызова, как оно записано в режиссуре (`kenburns@1`, `local:kenburns@1`). */
  readonly template?: string;
  /** Исходная ошибка, если форму проверял кто-то другой (например, zod). */
  readonly cause?: unknown;
}

/** Нарушение контракта шаблона: несёт правило и имя шаблона, а не только текст. */
export class TemplateSpecError extends Error {
  readonly rule: TemplateRule;
  readonly template: string | null;

  constructor(rule: TemplateRule, reason: string, place: TemplateErrorPlace = {}) {
    const which = place.template === undefined ? '' : `\`${place.template}\`: `;
    super(`${rule}: ${which}${reason}`, place.cause === undefined ? undefined : { cause: place.cause });
    this.name = 'TemplateSpecError';
    this.rule = rule;
    this.template = place.template ?? null;
  }
}
