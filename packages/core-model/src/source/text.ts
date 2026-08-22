// Нормализация и адресация исходника — ПЕРВЫЙ шаг лексера (ADR-0002 §8, инвариант D8).
//
// ПОЧЕМУ ПЕРВЫЙ. Позиции, хэши и якоря считаются по нормализованному потоку. Если
// нормализовать позже, копипаста абзаца в NFD даст другие смещения, другие якоря и платную
// перегенерацию TTS при визуально идентичном тексте. Сырые байты после этого модуля не
// отдаются никому: наружу уходит только `SourceText`.
//
// ЕДИНИЦА СМЕЩЕНИЯ — CODE POINT, А НЕ UTF-16 CODE UNIT. Причина названа в roadmap `C-03`:
// «span-map монотонна в code points». В UTF-16 астральный символ занимает две позиции, и
// `строка:колонка`, посчитанные по ним, показывали бы автору колонку внутри суррогатной пары.
// Цена — массив `points`: файл сценария — единицы килобайт, копия допустима.
//
// ПРОБЕЛЬНЫЕ — РОВНО ТРИ СИМВОЛА: пробел, таб, `\n`. Не `\s` из регулярки: `\s` включает NBSP
// и другие пробельные Unicode, а они ПРОИЗНОСИМЫ в том смысле, что провайдер их видит
// (`FACT` SP-2: NBSP → пробел делает нормализатор провайдера, то есть символ доходит до него).
// Схлопывать их молча значило бы менять spoken-байты по правилу, которого нет ни в одном ADR.

import { SourceParseError, type SourceLocation, type SourceRule } from './errors.js';

const WHITESPACE = new Set([' ', '\t', '\n']);

/** Первая строка файла — шапка семейства (P1). Тело начинается со второй. */
const HEADER_PREFIX = 'schema:';

/**
 * NFC + `\r\n`/`\r` → `\n`. Порядок неважен: NFC не создаёт и не трогает `\r`/`\n`.
 * Возвращается СТРОКА, а не `SourceText`, чтобы тесты D8 могли сравнить сами потоки.
 */
export function normalizeSource(raw: string): string {
  return raw.replace(/\r\n?/gu, '\n').normalize('NFC');
}

/** Полутон между «строка» и «файл»: нормализованный поток плюс всё, чем адресуются позиции. */
export interface SourceText {
  readonly file: string;
  /** Нормализованный поток целиком, включая строку-шапку. */
  readonly text: string;
  /** Тот же поток в code points: `points[offset]`. */
  readonly points: readonly string[];
  /** Смещения начал строк, `lineStarts[0] === 0`. */
  readonly lineStarts: readonly number[];
  /** Смещение первого символа ТЕЛА — начала второй строки. */
  readonly bodyStart: number;
  /** Длина в code points. */
  readonly length: number;
}

/** Отрезок исходника. `end` не входит — полуоткрытый `[start, end)`, как везде в проекте. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Нормализует поток и строит адресацию.
 *
 * ШАПКУ ЛЕКСЕР НЕ РАЗБИРАЕТ. Он убеждается, что первая строка ЯВЛЯЕТСЯ шапкой, и начинает со
 * второй; семейство и версию читает `readFamily` из `@vpe/schema` (инвариант P3 — тело файла
 * читателю схемы недоступно, шапка лексеру не нужна). Проверка нужна ровно против одной
 * ошибки: если подать сюда тело без шапки, первая строка прозы исчезла бы МОЛЧА.
 */
export function sourceText(file: string, raw: string): SourceText {
  const text = normalizeSource(raw);
  const points = [...text];
  const lineStarts: number[] = [0];
  for (let i = 0; i < points.length; i += 1) {
    if (points[i] === '\n') lineStarts.push(i + 1);
  }
  const src: SourceText = {
    file,
    text,
    points,
    lineStarts,
    bodyStart: lineStarts[1] ?? points.length,
    length: points.length,
  };
  if (points.slice(0, HEADER_PREFIX.length).join('') !== HEADER_PREFIX) {
    throw new SourceParseError('ADR-0005 §3', { file, line: 1, column: 1 }, 
      'первая строка обязана быть шапкой `schema: <семейство>/<версия>` (P1); тело диалекта ' +
      'начинается со второй строки. Лексер шапку НЕ разбирает — это делает `readFamily`.');
  }
  return src;
}

/** Символ по смещению; за границами — пустая строка (а не `undefined`). */
export function at(src: SourceText, offset: number): string {
  return src.points[offset] ?? '';
}

export function isWhitespace(ch: string): boolean {
  return WHITESPACE.has(ch);
}

/** Подстрока по полуоткрытому отрезку смещений. */
export function sliceSource(src: SourceText, start: number, end: number): string {
  return src.points.slice(start, end).join('');
}

/** Длина строки в code points — единственная разрешённая мера длины в этом пакете. */
export function pointLength(value: string): number {
  return [...value].length;
}

/** `строка:колонка`, обе 1-based, обе в code points. Двоичный поиск по началам строк. */
export function positionAt(src: SourceText, offset: number): { line: number; column: number } {
  let low = 0;
  let high = src.lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((src.lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - (src.lineStarts[low] ?? 0) + 1 };
}

export function locationAt(src: SourceText, offset: number): SourceLocation {
  const { line, column } = positionAt(src, offset);
  return { file: src.file, line, column };
}

export function spanOf(src: SourceText, start: number, end: number): Span {
  const { line, column } = positionAt(src, start);
  return { start, end, line, column };
}

export function spanText(src: SourceText, span: Span): string {
  return sliceSource(src, span.start, span.end);
}

/** Снимает пробельные с обоих концов отрезка. Возвращает смещения, а не строку. */
export function trimRange(src: SourceText, start: number, end: number): { start: number; end: number } {
  let from = start;
  let to = end;
  while (from < to && isWhitespace(at(src, from))) from += 1;
  while (to > from && isWhitespace(at(src, to - 1))) to -= 1;
  return { start: from, end: to };
}

/** Первое вхождение символа в отрезке или `-1`. */
export function indexOfPoint(src: SourceText, start: number, end: number, ch: string): number {
  for (let i = start; i < end; i += 1) {
    if (at(src, i) === ch) return i;
  }
  return -1;
}

/** Единственный способ отказать: место + правило + причина. */
export function fail(src: SourceText, offset: number, rule: SourceRule, reason: string): never {
  throw new SourceParseError(rule, locationAt(src, offset), reason);
}
