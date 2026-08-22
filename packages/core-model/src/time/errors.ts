// Ошибка модели времени.
//
// ОШИБКА НАЗЫВАЕТ ПРАВИЛО, А НЕ СЛЕДСТВИЕ (`S-02` §3.3). «`NaN` в аргументе» — следствие;
// «T2: промежуточное произведение вышло за 2^53» — причина, и по ней сразу понятно, какую
// строку ADR-0003 читать. Поэтому у ошибки есть поле `rule`, а не только текст.
//
// Численные конструкторы `asSamples`/`asFrames` из `@vpe/schema` продолжают бросать свои
// `RangeError`/`TypeError` — они охраняют ГРАНИЦУ типа и к правилам ADR-0003 не привязаны
// (`S-01`). Здесь — правила.

/** Правила, на которые ссылаются ошибки этого пакета. */
export type TimeRule =
  | 'ADR-0001 gridPoint'
  | 'ADR-0003 T1'
  | 'ADR-0003 T2'
  | 'ADR-0003 T3'
  | 'ADR-0003 T4';

/** Нарушение правила модели времени: несёт имя правила, а не только текст. */
export class TimeModelError extends RangeError {
  readonly rule: TimeRule;

  constructor(rule: TimeRule, reason: string) {
    super(`${rule}: ${reason}`);
    this.name = 'TimeModelError';
    this.rule = rule;
  }
}
