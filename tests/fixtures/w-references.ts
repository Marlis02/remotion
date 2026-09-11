// Инструмент охранника **A1**: «ни один override и ни одна direction-запись не ссылаются на `w:`»
// (ADR-0004 §2; ADR-0004 §2a называет этот тест прямо — «исполнимый охранник, которого не было»).
//
// ПОЧЕМУ ЭТО ВООБЩЕ ПРОВЕРЯЕТСЯ ТЕСТОМ. `w:` — внутреннее пространство ledger'а: его id минтятся
// случайно, живут ревизиями и человеку не показываются. Ссылка на `w:` из артефакта, который
// правит человек, означала бы, что правка привязана к id, которого он нигде не видит и который
// переминтится при первой же правке текста. До `C-04` правило было декларативным, а самый частый
// способ позиционирования визуала (`[img:]`, 8 записей на ролик по AC1) его НАРУШАЛ (M1).
//
// КОММЕНТАРИИ ИСКЛЮЧЕНЫ, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Инвариант — про ССЫЛКИ, то есть про значения.
// В `fixtures/minimal/direction/01-intro.yaml` подстрока `w:` есть — в комментарии, который
// объясняет, что ссылок на `w:` тут не бывает. Дословный греп по байтам (так критерий записан у
// `L-03`) покраснел бы на этом объяснении; расхождение записано в отчёте `C-04` как находка для
// `L-03`, а не заметено сюда.
//
// ПОЧЕМУ КОРЕНЬ — ПАРАМЕТР: чтобы протокол нарушений направил тот же сканер на ВРЕМЕННУЮ копию
// с настоящей ссылкой `at: { kind: anchor, anchor: "w:…" }`. `fixtures/` не изменяется.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Каталоги, в которых ссылка на `w:` запрещена (ADR-0004 §2). */
export const GUARDED_DIRS = ['direction', 'overrides'] as const;

export interface WReference {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
}

function walk(dir: string, visit: (abs: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, visit);
    else if (entry.isFile()) visit(abs);
  }
}

/** Все файлы `fixtures/**\/direction/**` и `fixtures/**\/overrides/**` дерева. */
export function guardedFiles(root: string): string[] {
  const out: string[] = [];
  walk(path.join(root, 'fixtures'), (abs) => {
    const rel = path.relative(root, abs);
    const parts = rel.split(path.sep);
    if (parts.some((part) => (GUARDED_DIRS as readonly string[]).includes(part))) out.push(rel);
  });
  return out;
}

/**
 * Строка без YAML-комментария.
 *
 * Полного разбора здесь нет намеренно (`yaml` — зависимость `@vpe/schema`, а не корня, и импорт
 * её из `tests/` завёл бы необъявленную зависимость — то, что стерегут тесты границ `R-01`).
 * Двух правил достаточно: строка, начинающаяся с `#`, — комментарий целиком; ` #` в середине —
 * хвостовой комментарий. Значения якорей кавычены и `#` не содержат.
 */
export function withoutComments(line: string): string {
  if (/^\s*#/u.test(line)) return '';
  const at = line.indexOf(' #');
  return at === -1 ? line : line.slice(0, at);
}

/**
 * Ссылка ли это на `w:` — **`w:` НА ГРАНИЦЕ СЛОВА, а не подстрока `w:` где угодно**.
 *
 * ═══ ПОЧЕМУ ПРАВИЛО СУЗИЛОСЬ (`CAPTION-01`, 2026-09-11) И ПОЧЕМУ ЭТО НЕ ОСЛАБЛЕНИЕ ═══
 * Дословный `code.includes('w:')` покраснел на строке `shadow: { dxPx: 0, … }` в
 * `fixtures/minimal/direction/01-intro.yaml` — то есть на ИМЕНИ ПОЛЯ `params`, которое просто
 * кончается на `w`. Ложное срабатывание не теоретическое: под него попадает ЛЮБОЕ имя поля,
 * оканчивающееся буквой `w` (`shadow`, `glow`, `flow`), и обойти его переименованием нельзя —
 * запрет получился бы на букву алфавита, а не на ссылку.
 *
 * ЧТО ИМЕННО ЗАПРЕЩАЕТ ИНВАРИАНТ (ADR-0004 §2): **ссылку**, то есть ЗНАЧЕНИЕ вида `w:<id>`.
 * В файле она всегда стоит после кавычки, пробела, `{`, `:` или в начале строки — и НИКОГДА
 * не приклеена к букве или цифре слева, потому что слева от неё синтаксис YAML, а не слово.
 * Поэтому условие «перед `w:` не буква, не цифра, не `_` и не `-`» отсекает ровно имена полей
 * и не отсекает ни одной настоящей ссылки. Охранник это ДОКАЗЫВАЕТ, а не обещает: проба на
 * временной копии с настоящей ссылкой `anchor: "w:7f2q9x1bdk3m4n5p"` осталась на месте и
 * по-прежнему краснеет.
 *
 * Расхождение с `L-03` («дословный греп по байтам») от этого не выросло, а уменьшилось: там
 * оно было записано находкой `C-04` про КОММЕНТАРИИ, здесь к нему добавляется вторая половина
 * того же — имена полей. Обе живут в одном месте, а не растащены по вызывающим.
 */
export function hasWReference(code: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])w:/u.test(code);
}

/** Все ссылки на `w:` в охраняемых каталогах. Пустой список — инвариант A1 держится. */
export function scanWReferences(root: string): WReference[] {
  const out: WReference[] = [];
  for (const rel of guardedFiles(root)) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const code = withoutComments(lines[i] ?? '');
      if (!hasWReference(code)) continue;
      out.push({ file: rel, line: i + 1, excerpt: code.trim() });
    }
  }
  return out;
}

/** Человекочитаемый список — им падает тест. */
export function formatWReferences(references: readonly WReference[]): string {
  return references
    .map((r) => `${r.file}:${String(r.line)}: ссылка на \`w:\` — ${r.excerpt}`)
    .join('\n');
}
