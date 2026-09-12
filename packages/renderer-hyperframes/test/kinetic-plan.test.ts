// **РАСПИСАНИЕ `kineticType@1` — ТАБЛИЧНО, БЕЗ БРАУЗЕРА (`KT-01`).**
//
// ═══ ЧТО ИМЕННО ЗДЕСЬ ИСПЫТЫВАЕТСЯ И ПОЧЕМУ ЭТО НЕ ПЕРЕСКАЗ ═══
// Шаблон живёт СТРОКОЙ (`mountSource`), которую исполняет браузер; `tsc` в неё не смотрит.
// Тест поднимает через `Function` ТЕ ЖЕ строковые константы, которые вставлены в `mount`, —
// то есть меряет буквально тот код, который поедет в композицию. Вторая реализация тех же
// формул на TypeScript была бы вторым источником правды и разошлась бы с первым в день первой
// правки; здесь разойтись негде по построению.
//
// ЧЕГО ЗДЕСЬ НЕТ: пикселей. «Слово видно на кадре» проверяется браузерным охранником
// (`kinetic-timing.test.ts`); здесь проверяется, что РАСПИСАНИЕ, по которому он это делает,
// считается правильно. Два разных вопроса, и оба обязаны иметь ответ.

import { describe, expect, it } from 'vitest';

import {
  KINETIC_CHARS_SOURCE,
  KINETIC_COUNTER_SOURCE,
  KINETIC_EVEN_PIECES_SOURCE,
  KINETIC_FORMAT_SOURCE,
  KINETIC_PLAN_SOURCE,
  KINETIC_WINDOW_PIECES_SOURCE,
} from '../src/templates/kineticType@1/impl.js';

/**
 * Поднять исходник чистой функции шаблона в вызываемую функцию.
 *
 * `Function`, а не `eval`: у неё нет доступа к области видимости теста, то есть функция
 * поднимается ровно такой, какой её увидит браузер, — без единой переменной снаружи. Если бы
 * она молча читала что-то из окружения, здесь бы это упало, а в композиции — нет.
 */
function lift<T extends (...args: never[]) => unknown>(source: string): T {
  return new Function(`return (${source});`)() as T;
}

interface Piece { readonly text: string; readonly startFrame: number }
interface Step { readonly text: string; readonly from: number; readonly to: number }

const plan = lift<(p: readonly Piece[], frameEnd: number, stack: boolean) => Step[]>(KINETIC_PLAN_SOURCE);
const counterAt = lift<(n: number, from: number, to: number, a: number, b: number) => number>(
  KINETIC_COUNTER_SOURCE,
);
const charsAt = lift<(n: number, a: number, charFrames: number, length: number) => number>(
  KINETIC_CHARS_SOURCE,
);
const format = lift<(value: number, separator: string, suffix: string) => string>(KINETIC_FORMAT_SOURCE);
const windowPieces = lift<(captions: unknown, a: number, b: number) => Piece[]>(
  KINETIC_WINDOW_PIECES_SOURCE,
);
const evenPieces = lift<(texts: readonly string[], a: number, b: number) => Piece[]>(
  KINETIC_EVEN_PIECES_SOURCE,
);

/** Пять слов с окнами — норма охранника 1 задания. */
const FIVE: readonly Piece[] = [
  { text: 'then', startFrame: 10 },
  { text: 'the', startFrame: 14 },
  { text: 'whole', startFrame: 19 },
  { text: 'country', startFrame: 25 },
  { text: 'greece', startFrame: 33 },
];

describe('охранник 1 — слово видно С КАДРА своего токена и не раньше', () => {
  it('`stack: true`: каждое слово начинается РОВНО на своём кадре и стоит до конца окна', () => {
    const steps = plan(FIVE, 60, true);
    expect(steps.map((s) => s.from)).toEqual([10, 14, 19, 25, 33]);
    // Накопление: фраза набирается и остаётся стоять целиком — конец у всех один.
    expect(steps.map((s) => s.to)).toEqual([60, 60, 60, 60, 60]);
    expect(steps.map((s) => s.text)).toEqual(['then', 'the', 'whole', 'country', 'greece']);
  });

  it('`stack: false`: слово стоит РОВНО до появления следующего — в кадре всегда одно', () => {
    const steps = plan(FIVE, 60, false);
    expect(steps.map((s) => [s.from, s.to])).toEqual([
      [10, 14],
      [14, 19],
      [19, 25],
      [25, 33],
      [33, 60],
    ]);
    // Интервалы полуоткрыты (**T4**) и не пересекаются: конец одного есть начало следующего.
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i - 1]?.to).toBe(steps[i]?.from);
    }
  });

  it('НИ ОДНОЙ ПОПРАВКИ К КАДРУ ТОКЕНА: `from` равен `startFrame` буквально', () => {
    for (const stack of [true, false]) {
      const steps = plan(FIVE, 60, stack);
      for (const [i, step] of steps.entries()) {
        expect(step.from, `слово №${String(i)} сдвинулось относительно своего токена`).toBe(
          FIVE[i]?.startFrame,
        );
      }
    }
  });

  it('кусок, начинающийся НА конце окна или позже, отбрасывается — своих кадров у него нет', () => {
    const steps = plan(FIVE, 25, true);
    expect(steps.map((s) => s.text)).toEqual(['then', 'the', 'whole']);
  });
});

describe('охранник 2 — счётчик: чистота, монотонность, `to` на последнем кадре', () => {
  it('на последнем кадре окна значение РОВНО `to`, на первом — РОВНО `from`', () => {
    expect(counterAt(10, 300, 381, 10, 70)).toBe(300);
    expect(counterAt(69, 300, 381, 10, 70)).toBe(381);
  });

  it('монотонен и не выходит за `[from, to]` на всём окне — и вверх, и вниз', () => {
    for (const [from, to] of [
      [300, 381],
      [381, 300],
      [0, 1],
      [-50, 50],
    ] as const) {
      let previous = counterAt(10, from, to, 10, 70);
      for (let n = 10; n < 70; n += 1) {
        const value = counterAt(n, from, to, 10, 70);
        if (to >= from) {
          expect(value, `счётчик ${String(from)}→${String(to)} пошёл вспять на кадре ${String(n)}`)
            .toBeGreaterThanOrEqual(previous);
          expect(value).toBeLessThanOrEqual(to);
        } else {
          expect(value).toBeLessThanOrEqual(previous);
          expect(value).toBeGreaterThanOrEqual(to);
        }
        previous = value;
      }
      expect(counterAt(69, from, to, 10, 70)).toBe(to);
    }
  });

  it('ЧИСТОТА: два вызова с теми же пятью числами дают то же значение', () => {
    for (let n = 10; n < 70; n += 1) {
      expect(counterAt(n, 300, 381, 10, 70)).toBe(counterAt(n, 300, 381, 10, 70));
    }
  });

  it('окно в ОДИН кадр показывает ЦЕЛЬ: единственный кадр есть и первый, и последний', () => {
    expect(counterAt(10, 300, 381, 10, 11)).toBe(381);
  });

  it('за окном значение прижато к краям, а не продолжает расти', () => {
    expect(counterAt(0, 300, 381, 10, 70)).toBe(300);
    expect(counterAt(999, 300, 381, 10, 70)).toBe(381);
  });
});

describe('охранник 3 — `typewriter`: на кадре `n` ровно `floor((n − a) / charFrames)` символов', () => {
  it('критерий приёмки дословно, на всём окне', () => {
    const length = 4;
    for (const charFrames of [1, 3, 7]) {
      for (let n = 10; n < 60; n += 1) {
        const expected = Math.min(Math.max(Math.floor((n - 10) / charFrames), 0), length);
        expect(charsAt(n, 10, charFrames, length)).toBe(expected);
      }
    }
  });

  it('«2008» при трёх кадрах на символ: 2 → 20 → 200 → 2008 на кадрах 3, 6, 9, 12', () => {
    const text = '2008';
    const at = (n: number): string => text.slice(0, charsAt(n, 0, 3, text.length));
    expect([at(3), at(6), at(9), at(12)]).toEqual(['2', '20', '200', '2008']);
    // ПЕРВЫЕ ТРИ КАДРА ОКНА ПУСТЫ, И ЭТО КРИТЕРИЙ, А НЕ ДЕФЕКТ: «набрано `floor(n/charFrames)`
    // символов» на кадре 0 даёт НОЛЬ, то есть в начале окна не набрано ещё ничего. Показать
    // первый символ сразу значило бы, что первый символ набирается за ноль кадров, а
    // остальные — за три; шаблон такого куска и не создаёт (`count === 0` пропускается).
    expect(at(0)).toBe('');
    // Между шагами строка НЕ меняется: набор идёт по три кадра на символ, а не по кадру.
    expect([at(4), at(5)]).toEqual(['2', '2']);
  });

  it('после последнего символа строка стоит целиком, а не растёт в пустоту', () => {
    expect(charsAt(500, 0, 3, 4)).toBe(4);
  });
});

describe('число строкой — БЕЗ `toLocaleString` (**D4**)', () => {
  it('группировка по три знака разделителем из `params`', () => {
    expect(format(48900, ' ', '')).toBe('48 900');
    expect(format(48900, ',', '')).toBe('48,900');
    expect(format(48900, '', '')).toBe('48900');
    expect(format(1234567, ' ', '')).toBe('1 234 567');
  });

  it('до тысячи разделителя нет ни при каком значении', () => {
    expect(format(381, ' ', '')).toBe('381');
    expect(format(0, ' ', '')).toBe('0');
  });

  it('минус выносится ВПЕРЁД и в группировке не участвует', () => {
    expect(format(-1000, ' ', '')).toBe('-1 000');
  });

  it('приписка идёт справа и группировки не касается', () => {
    expect(format(48900, ' ', ' текстов')).toBe('48 900 текстов');
  });
});

describe('захват окна — слова субтитров, попавшие В ОКНО КЛИПА', () => {
  const captions = [
    {
      text: 'then the whole',
      tokens: [
        { text: 'then', highlight: { frameStart: 5, frameEnd: 9 } },
        { text: 'the', highlight: null },
        { text: 'whole', highlight: { frameStart: 14, frameEnd: 19 } },
      ],
    },
    {
      text: 'country of greece',
      tokens: [
        { text: 'country', highlight: { frameStart: 25, frameEnd: 31 } },
        { text: 'of', highlight: { frameStart: 31, frameEnd: 33 } },
        { text: 'greece', highlight: { frameStart: 60, frameEnd: 70 } },
      ],
    },
  ];

  it('берётся слово, чей `frameStart` лежит в `[a, b)`, — и ни одно чужое', () => {
    expect(windowPieces(captions, 10, 40).map((p) => p.text)).toEqual(['whole', 'country', 'of']);
  });

  it('слово БЕЗ `highlight` пропускается: своего кадра у него нет, а выдумывать его нечем', () => {
    expect(windowPieces(captions, 0, 100).map((p) => p.text)).not.toContain('the');
  });

  it('результат упорядочен по кадру появления — `stack: false` читает соседа по индексу', () => {
    const frames = windowPieces(captions, 0, 100).map((p) => p.startFrame);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
  });

  it('границы полуоткрыты: слово НА `b` не берётся, слово НА `a` берётся', () => {
    expect(windowPieces(captions, 5, 25).map((p) => p.text)).toEqual(['then', 'whole']);
    expect(windowPieces(captions, 25, 60).map((p) => p.text)).toEqual(['country', 'of']);
  });
});

describe('`literal`: окно делится между кусками ровно и без накопления ошибки', () => {
  it('пять слов на шестьдесят кадров — кадры считаются ОТ НАЧАЛА окна, а не от соседа', () => {
    const pieces = evenPieces(['2', '+', '2', '=', '4'], 10, 70);
    expect(pieces.map((p) => p.startFrame)).toEqual([10, 22, 34, 46, 58]);
  });

  it('первый кусок всегда на первом кадре окна', () => {
    expect(evenPieces(['a', 'b', 'c'], 7, 8)[0]?.startFrame).toBe(7);
  });

  it('кусков больше, чем кадров: лишние схлопываются в один кадр и отбрасываются планом', () => {
    const pieces = evenPieces(['a', 'b', 'c', 'd'], 0, 2);
    // Два куска получают кадр 0, два — кадр 1; расписание с `stack: false` отбросит те, у
    // которых `to <= from`, — то есть пропажа ВИДНА, а не спрятана наложением.
    const steps = plan(pieces, 2, false);
    expect(steps.length).toBeLessThan(pieces.length);
    for (const step of steps) expect(step.to).toBeGreaterThan(step.from);
  });
});
