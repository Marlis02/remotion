// Ошибка модели: семантика поверх схемы.
//
// ОШИБКА НАЗЫВАЕТ ПРАВИЛО, А НЕ СЛЕДСТВИЕ — как `TimeModelError` (`C-01`), `SourceParseError`
// (`C-02`) и `AnchorLedgerError` (`C-04`). «Дубль id» — следствие; «D3: `recordId` уникальны» —
// причина, и по ней сразу видно, какую строку реестра инвариантов читать.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ КЛАСС, А НЕ ОДИН ИЗ ТРЁХ СУЩЕСТВУЮЩИХ. Место здесь — **файл и запись**
// (`direction/01-intro.yaml`, `recordId: a3f19c2b`), а не позиция в прозе (`SourceParseError`),
// не номер строки ledger'а (`AnchorLedgerError`) и не «правило арифметики времени»
// (`TimeModelError`). Человек, читающий такую ошибку, идёт править YAML — адрес обязан быть
// адресом YAML.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ошибок схемы. Форму файла проверяет `parseFamilyText` (`@vpe/schema`) и
// бросает `FamilyReadError`/`z.ZodError` с путём к полю; дублировать это здесь значило бы
// держать вторую копию контракта формата.

/** Правила, на которые ссылаются ошибки модели. */
export type ModelRule =
  /** Инвариант A1 — ни одна direction-запись не ссылается на `w:` (ADR-0004 §2). */
  | 'A1'
  /** Инвариант D3 — `recordId` уникальны (ADR-0007 §1, Consequences). */
  | 'D3'
  /** Сетки ассетов в v1 не реализуются (ADR-0001; артефакт сетки — ADR-0006 §14). */
  | 'ADR-0001 gridPoint'
  /** Цель ссылки не существует: «верни id или удали ссылки» (ADR-0004 §9). */
  | 'ADR-0004 §9'
  /** Иерархия seed'ов (ADR-0007 §1). */
  | 'ADR-0007 §1';

/** Где именно нарушено правило. Оба поля необязательны: не у всякого нарушения есть запись. */
export interface ModelErrorPlace {
  /** Путь файла режиссуры, как он был подан на вход. */
  readonly file?: string;
  /** `recordId` записи, на которой нарушение обнаружено. */
  readonly recordId?: string;
  /** Исходная ошибка, если правило проверял кто-то другой (например, `assertRealizable`). */
  readonly cause?: unknown;
}

/** Нарушение правила модели: несёт правило, файл и запись, а не только текст. */
export class ModelError extends Error {
  readonly rule: ModelRule;
  readonly file: string | null;
  readonly recordId: string | null;

  constructor(rule: ModelRule, reason: string, place: ModelErrorPlace = {}) {
    const where = place.file === undefined ? '' : `${place.file}: `;
    const which = place.recordId === undefined ? '' : `запись \`${place.recordId}\`: `;
    super(`${where}${rule}: ${which}${reason}`, place.cause === undefined ? undefined : { cause: place.cause });
    this.name = 'ModelError';
    this.rule = rule;
    this.file = place.file ?? null;
    this.recordId = place.recordId ?? null;
  }
}
