// `C-03` — три property-свойства трансдьюсера (ADR-0010 §10):
//   1. ТОТАЛЬНОСТЬ  — каждый code point spoken-текста либо имеет прообраз в исходнике,
//                     либо помечен вставленным (пришёл из `s` маркера `[say:]`);
//   2. МОНОТОННОСТЬ — span-map не переставляет символы, и считает она CODE POINTS;
//   3. ROUND-TRIP   — `reconstructDisplay(spoken, spanMap)` восстанавливает display-текст
//                     ПОБАЙТОВО.
//
// «Сильнее любого набора примеров» — формулировка самого ADR-0010 §10. Набор примеров
// (F1–F16) живёт в `source-transduce.test.ts` и проверяет НАЗВАННЫЕ ловушки; здесь те же
// ловушки перемешиваются случайно, вместе со случайными `[say: d | s]`.
//
// ОЖИДАНИЕ СТРОИТ ГЕНЕРАТОР, А НЕ ТРАНСДЬЮСЕР (см. `source-fuzz.ts`): иначе round-trip
// сравнивал бы функцию с самой собой.

import { describe, expect, it } from 'vitest';

import {
  chunksIn,
  isWhitespace,
  parseSource,
  pointLength,
  reconstructDisplay,
  sourceText,
  spokenOrigin,
  transduceChunk,
  type ChunkText,
} from '../src/index.js';
import { FUZZ_SEED, fuzzDocuments } from './source-fuzz.js';
import { SAMPLE_RATE } from './source-helpers.js';

/** Сколько случайных документов на свойство. Сид — константа, прогон воспроизводим. */
const RUNS = 200;

const SEED_NOTE = `сид ${String(FUZZ_SEED)} (константа \`FUZZ_SEED\` в \`test/source-fuzz.ts\`)`;

interface Case {
  readonly index: number;
  readonly file: string;
  readonly raw: string;
  /** Нормализованный поток исходника — прообразы ищутся ИМЕННО в нём (ADR-0002 §8, D8). */
  readonly points: readonly string[];
  readonly texts: readonly ChunkText[];
  readonly expected: readonly { readonly spoken: string; readonly display: string }[];
}

/** Разбирает `RUNS` случайных документов один раз на весь файл. */
const CASES: Case[] = fuzzDocuments(RUNS).map((generated, index) => {
  const file = `source/fuzz-${String(index)}.md`;
  const ast = parseSource(generated.text, { file, sampleRate: SAMPLE_RATE });
  return {
    index,
    file,
    raw: generated.text,
    points: sourceText(file, generated.text).points,
    texts: chunksIn(ast).map(transduceChunk),
    expected: generated.chunks,
  };
});

/** Вход печатается целиком: падение обязано быть починяемым без повторного запуска. */
function context(testCase: Case, chunk: number): string {
  return `${SEED_NOTE}, документ №${String(testCase.index)}, чанк №${String(chunk)}\n${testCase.raw}`;
}

describe('`C-03` property — свойство 1: ТОТАЛЬНОСТЬ (ADR-0010 §10)', () => {
  it(`каждый code point spoken имеет прообраз в исходнике либо помечен вставленным (${String(RUNS)} документов)`, () => {
    for (const testCase of CASES) {
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        const spoken = [...text.spoken];
        const display = [...text.display];
        const where = context(testCase, c);

        for (let i = 0; i < spoken.length; i += 1) {
          const origin = spokenOrigin(text, i);
          // Прообраз в ИСХОДНИКЕ есть всегда — в том числе у вставленных символов:
          // `s` маркера `[say:]` автор написал сам, и он лежит в потоке.
          const source = testCase.points[origin.sourceOffset];
          expect(source, where).toBeDefined();

          if (origin.kind === 'space') {
            // Схлопнутый ряд: в spoken стоит `U+0020`, в исходнике — ЛЮБОЙ пробельный ряда.
            expect(spoken[i], where).toBe(' ');
            expect(isWhitespace(source ?? ''), where).toBe(true);
            expect(origin.inserted, where).toBe(false);
            expect(display[origin.displayIndex ?? -1], where).toBe(' ');
            continue;
          }

          // `copy` и `say` — тождество символ-в-символ с исходником.
          expect(source, where).toBe(spoken[i]);

          if (origin.kind === 'say') {
            // ВСТАВКА: прообраза в display нет, и это ПОМЕЧЕНО, а не выведено молчанием.
            expect(origin.inserted, where).toBe(true);
            expect(origin.displayIndex, where).toBeUndefined();
          } else {
            expect(origin.inserted, where).toBe(false);
            expect(display[origin.displayIndex ?? -1], where).toBe(spoken[i]);
          }
        }
      }
    }
  });

  it('прогоны покрывают spoken-текст без дыр и нахлёстов, и покрывают его целиком', () => {
    for (const testCase of CASES) {
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        const where = context(testCase, c);
        let spokenSeen = 0;
        let displaySeen = 0;
        for (const run of text.runs) {
          expect(run.spokenStart, where).toBe(spokenSeen);
          expect(run.displayStart, where).toBe(displaySeen);
          expect(run.spokenLength, where).toBeGreaterThan(0);
          expect(run.displayLength, where).toBeGreaterThan(0);
          spokenSeen += run.spokenLength;
          displaySeen += run.displayLength;
        }
        expect(spokenSeen, where).toBe(pointLength(text.spoken));
        expect(displaySeen, where).toBe(pointLength(text.display));
      }
    }
  });

  it('индекс вне spoken-текста — `RangeError`, а не молчаливый `undefined`', () => {
    const text = CASES[0]?.texts[0] as ChunkText;
    expect(() => spokenOrigin(text, -1)).toThrow(RangeError);
    expect(() => spokenOrigin(text, pointLength(text.spoken))).toThrow(RangeError);
  });
});

describe('`C-03` property — свойство 2: МОНОТОННОСТЬ span-map в CODE POINTS (ADR-0010 §10)', () => {
  it(`все четыре координаты строго возрастают по прогонам (${String(RUNS)} документов)`, () => {
    for (const testCase of CASES) {
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        const where = context(testCase, c);
        let spoken = -1;
        let display = -1;
        let spokenSource = -1;
        let displaySource = -1;
        for (const run of text.runs) {
          expect(run.spokenStart, where).toBeGreaterThan(spoken);
          expect(run.displayStart, where).toBeGreaterThan(display);
          expect(run.spokenSource, where).toBeGreaterThan(spokenSource);
          expect(run.displaySource, where).toBeGreaterThan(displaySource);
          spoken = run.spokenStart;
          display = run.displayStart;
          spokenSource = run.spokenSource;
          displaySource = run.displaySource;
        }
      }
    }
  });

  it('посимвольно: смещение в исходнике строго растёт вместе с индексом spoken', () => {
    for (const testCase of CASES) {
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        const where = context(testCase, c);
        let previous = -1;
        for (let i = 0; i < pointLength(text.spoken); i += 1) {
          const offset = spokenOrigin(text, i).sourceOffset;
          expect(offset, where).toBeGreaterThan(previous);
          previous = offset;
        }
      }
    }
  });

  it('единица — CODE POINT: на документах с эмодзи длина в UTF-16 отличается, и карта её не знает', () => {
    const astral = CASES.flatMap((testCase) => testCase.texts).filter(
      (text) => text.spoken.length !== pointLength(text.spoken),
    );
    // Алфавит генератора содержит `🚢` и `👍🏽` — документов с астральными символами обязано
    // быть много; если их нет, тест перестал проверять то, ради чего написан.
    expect(astral.length).toBeGreaterThan(20);
    for (const text of astral) {
      const total = text.runs.reduce((sum, run) => sum + run.spokenLength, 0);
      expect(total).toBe(pointLength(text.spoken));
      expect(total).not.toBe(text.spoken.length);
    }
  });
});

describe('`C-03` property — свойство 3: ROUND-TRIP (ADR-0010 §10)', () => {
  it(`\`reconstructDisplay(spoken, runs)\` восстанавливает display побайтово (${String(RUNS)} документов)`, () => {
    for (const testCase of CASES) {
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        expect(reconstructDisplay(text.spoken, text.runs), context(testCase, c)).toBe(text.display);
      }
    }
  });

  it('и spoken, и display совпадают с ожиданием ГЕНЕРАТОРА, а не с выходом того же кода', () => {
    for (const testCase of CASES) {
      expect(testCase.texts.length, context(testCase, 0)).toBe(testCase.expected.length);
      for (let c = 0; c < testCase.texts.length; c += 1) {
        const text = testCase.texts[c] as ChunkText;
        const where = context(testCase, c);
        expect(text.spoken, where).toBe(testCase.expected[c]?.spoken);
        expect(text.display, where).toBe(testCase.expected[c]?.display);
      }
    }
  });

  it('вставки в наборе есть — иначе round-trip проверял бы только тождество', () => {
    const inserts = CASES.flatMap((testCase) => testCase.texts).flatMap((text) =>
      text.runs.filter((run) => run.kind === 'say'),
    );
    expect(inserts.length).toBeGreaterThan(100);
    // Вставка — это РАЗНАЯ длина сторон хотя бы иногда: карта только с удалениями не годится
    // (ADR-0010 §10: «`[emph]`… обязана иметь span-map со ВСТАВКАМИ, а не только с удалениями»).
    expect(inserts.some((run) => run.displayLength > run.spokenLength)).toBe(true);
    expect(inserts.some((run) => run.displayLength < run.spokenLength)).toBe(true);
  });
});
