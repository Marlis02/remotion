// Ошибка ledger'а якорей.
//
// ОШИБКА НАЗЫВАЕТ ПРАВИЛО, А НЕ СЛЕДСТВИЕ — как `TimeModelError` (`C-01`) и `SourceParseError`
// (`C-02`). «Дубль id» — следствие; «A3: все якоря со `status: live` уникальны» — причина, и по
// ней сразу видно, какую строку реестра инвариантов и какой раздел ADR-0004 читать.
//
// ПОЧЕМУ НЕ `SourceParseError`. Тот несёт `файл:строка:колонка` исходника и означает «автор
// написал не то». Здесь ошибки другого класса: файл ledger'а машинный, его пишет движок, и
// нарушения в нём означают либо merge двух веток (A3), либо переписанную историю (A8), либо
// разошедшийся контекст (§6). Место в ошибке — номер строки `anchors.lock.jsonl`, а не позиция
// в прозе, поэтому это отдельный класс.

/** Правила, на которые ссылаются ошибки ledger'а. */
export type AnchorRule =
  | 'ADR-0004 §1'
  | 'ADR-0004 §2a'
  | 'ADR-0004 §4'
  | 'ADR-0004 §6'
  | 'ADR-0005 §10'
  | 'A3'
  | 'A8';

/** Нарушение правила ledger'а: несёт имя правила и, где применимо, номер строки файла. */
export class AnchorLedgerError extends Error {
  readonly rule: AnchorRule;
  /** Номер строки `anchors.lock.jsonl`, 1-based; `null` — нарушение не привязано к строке. */
  readonly line: number | null;

  constructor(rule: AnchorRule, reason: string, line: number | null = null) {
    super(line === null ? `${rule}: ${reason}` : `anchors.lock.jsonl:${String(line)}: ${rule}: ${reason}`);
    this.name = 'AnchorLedgerError';
    this.rule = rule;
    this.line = line;
  }
}
