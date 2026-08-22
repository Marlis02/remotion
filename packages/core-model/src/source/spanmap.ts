// Span-map: символ spoken-текста ↔ символ исходника. Фундамент V1 и V5 (ADR-0002 §5).
//
// ПОЧЕМУ БЕЗ НЕЁ ЗАДАЧА НЕ СДЕЛАНА. `replace(/\[[^\]]*\]/g, '')` даёт тот же spoken-текст и
// теряет позиции: сказать, какому байту исходника соответствует символ №137, нельзя ⇒ привязка
// токенов (V1) не строится ⇒ нет субтитров ⇒ нет AC5. Именно это доказательство стоит в
// ADR-0002 §5 как обоснование существования AST.
//
// ФОРМА КАРТЫ — ПРОГОНЫ, А НЕ МАССИВ НА СИМВОЛ. Все прогоны тождественны (`copy`), кроме
// схлопнутого ряда пробельных (`space`, длина 1). Массив «символ → смещение» был бы той же
// информацией, занимал бы в 6 раз больше и в дампе прятал бы структуру.

import type { Chunk, SpanRun } from './ast.js';
import { locationAt, type SourceText } from './text.js';
import type { SourceLocation } from './errors.js';

/** Прогон, покрывающий индекс `spokenIndex`, или `undefined` за границами. */
export function runAtSpoken(chunk: Chunk, spokenIndex: number): SpanRun | undefined {
  let low = 0;
  let high = chunk.spanMap.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const run = chunk.spanMap[mid];
    if (run === undefined) return undefined;
    if (spokenIndex < run.spokenStart) high = mid - 1;
    else if (spokenIndex >= run.spokenStart + run.length) low = mid + 1;
    else return run;
  }
  return undefined;
}

/**
 * Смещение в нормализованном потоке исходника для символа spoken-текста.
 *
 * @throws {RangeError} индекс вне spoken-текста чанка — это дефект вызывающего, а не входа.
 */
export function spokenToSource(chunk: Chunk, spokenIndex: number): number {
  const run = runAtSpoken(chunk, spokenIndex);
  if (run === undefined) {
    throw new RangeError(`span-map: символ №${String(spokenIndex)} вне spoken-текста чанка`);
  }
  return run.sourceStart + (run.kind === 'space' ? 0 : spokenIndex - run.spokenStart);
}

/** То же, но сразу `файл:строка:колонка` — форма, в которой позицию читает человек. */
export function spokenToLocation(src: SourceText, chunk: Chunk, spokenIndex: number): SourceLocation {
  return locationAt(src, spokenToSource(chunk, spokenIndex));
}

/**
 * Обратное направление: смещение исходника → индекс в spoken-тексте чанка.
 *
 * `undefined` — законный ответ: символы маркеров, display-часть `[say:]` и схлопнутые пробельные
 * (кроме первого символа ряда) в spoken не уходят вовсе.
 */
export function sourceToSpoken(chunk: Chunk, sourceOffset: number): number | undefined {
  for (const run of chunk.spanMap) {
    const size = run.kind === 'space' ? 1 : run.length;
    if (sourceOffset >= run.sourceStart && sourceOffset < run.sourceStart + size) {
      return run.spokenStart + (run.kind === 'space' ? 0 : sourceOffset - run.sourceStart);
    }
  }
  return undefined;
}
