// Ошибка разбора исходника. ОДИН класс на весь лексер — так требует задание `C-02`.
//
// СООБЩЕНИЕ НАЧИНАЕТСЯ С `файл:строка:колонка`, потому что без этого линт прозы (ADR-0002 §3)
// и вся диагностика компилятора бесполезны: автор правит текст в редакторе, а не в AST.
//
// ПРАВИЛО НАЗЫВАЕТСЯ ЯВНО (образец `C-01`, `TimeModelError`): «неизвестный маркер» — следствие,
// «ADR-0002 §1: список маркеров закрыт» — причина, по которой сразу понятно, какую строку
// какого документа читать и что расширение списка требует НОВОГО ADR, а не правки лексера.
//
// ПОЧЕМУ `SyntaxError`, а не `Error`. Разбор текста в грамматику — ровно тот случай, для
// которого этот встроенный класс существует; `instanceof SyntaxError` не обещает ничего сверх
// «формат входа нарушен», и это здесь истина.

/** Правила, на которые ссылаются ошибки лексера. */
export type SourceRule =
  | 'ADR-0002 §1'
  | 'ADR-0002 §2'
  | 'ADR-0002 §3'
  | 'ADR-0002 §8'
  | 'ADR-0003 T1'
  | 'ADR-0004 §1'
  | 'ADR-0005 §3'
  | 'ADR-0010 §3a';

/** Точка в исходнике: файл, строка и колонка — ОБЕ считаются в code points (см. `text.ts`). */
export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** Нарушение диалекта `source/`: несёт место в файле и правило, а не только текст. */
export class SourceParseError extends SyntaxError {
  readonly rule: SourceRule;
  readonly location: SourceLocation;

  constructor(rule: SourceRule, location: SourceLocation, reason: string) {
    super(`${location.file}:${String(location.line)}:${String(location.column)}: ${rule}: ${reason}`);
    this.name = 'SourceParseError';
    this.rule = rule;
    this.location = location;
  }
}
