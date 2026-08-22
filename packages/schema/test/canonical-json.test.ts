// `S-01` — канонический JSON (ADR-0007 §3).
//
// Охраняется три вещи:
//   1. **идемпотентность** — property-тест на сгенерированных значениях;
//   2. **порядок ключей** не зависит ни от порядка вставки, ни от вложенности, и считается
//      по БАЙТАМ UTF-8, а не по UTF-16 code units и не `localeCompare` (Charter V8);
//   3. **каждый запрещённый тип отвергается с путём** — `NaN`, `±Infinity`, `-0`, `undefined`,
//      `bigint`, `symbol`, функция, `Map`, `Set` (R4), `Date`, `RegExp`, класс, цикл.
//
// Генератор — СВОЙ, seeded (xorshift32 от константы), а не `fast-check`: ноль зависимостей и
// детерминизм по построению (Charter V8 — «только seeded random»). Что именно он порождает,
// проверяет отдельный тест-контроль прибора, а не комментарий.

import { describe, expect, it } from 'vitest';

import { CanonicalJsonError, canonicalJson } from '../src/index.js';

// ── Генератор ──────────────────────────────────────────────────────────────────────────────

/** xorshift32. Seed — константа: два прогона обязаны дать одинаковый корпус. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[rng() % items.length];
  if (item === undefined) throw new Error('пустой список вариантов в генераторе');
  return item;
}

/**
 * Числа. Экспоненциальная форма обязана присутствовать: `String(1e21)` даёт `1e+21`,
 * `String(5e-7)` — `5e-7`, `String(-1.5e-300)` — `-1.5e-300`. Если бы канонизация писала
 * числа иначе (например, через `toFixed`), round-trip сломался бы именно на них.
 */
const NUMBERS: readonly number[] = [
  0, 1, -1, 42, -7,
  0.1, 0.5, -0.25, 1 / 3,
  1e21, 5e-7, -1.5e-300, 1e-323,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON,
];

const STRINGS: readonly string[] = [
  '', 'a', 'proza', 'with "quotes"', 'back\\slash', 'line\nbreak', 'tab\t',
  '\u0000\u001f' /* управляющие: JSON обязан их экранировать */,
  'caf\u00e9' /* NFC */, 'cafe\u0301' /* NFD */,
  '\u{1F600}', '\u{1D11E}', '\uFFFF',
];

/** Ключи. Астральные и `\uFFFF` — материал теста про байтовый порядок ниже. */
const KEYS: readonly string[] = [
  '', 'a', 'b', 'A', 'Z', '_', '0', 'aa', 'a.b', 'kl\u044ech',
  'caf\u00e9' /* NFC */, 'cafe\u0301' /* NFD: это РАЗНЫЕ ключи, и это правильно —
                            NFC делает лексер (ADR-0007 §6), а не канонизатор */,
  '\uFFFF', '\u{1D11E}', '\u{1F600}', 'z',
];

const LEAF_KINDS = ['null', 'true', 'false', 'number', 'string'] as const;

function genLeaf(rng: () => number): unknown {
  switch (pick(rng, LEAF_KINDS)) {
    case 'null': return null;
    case 'true': return true;
    case 'false': return false;
    case 'number': return pick(rng, NUMBERS);
    default: return pick(rng, STRINGS);
  }
}

/** `depth` — сколько уровней контейнеров ещё разрешено. Пустые контейнеры порождаются явно. */
function genValue(rng: () => number, depth: number): unknown {
  if (depth <= 0 || rng() % 100 < 35) return genLeaf(rng);

  if (rng() % 2 === 0) {
    const length = rng() % 5; // 0 ⇒ пустой массив
    return Array.from({ length }, () => genValue(rng, depth - 1));
  }

  const size = rng() % 5; // 0 ⇒ пустой объект
  const object: Record<string, unknown> = {};
  for (let i = 0; i < size; i += 1) {
    object[pick(rng, KEYS)] = genValue(rng, depth - 1);
  }
  return object;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Глубина вложенности: 0 у листа, 1 у пустого контейнера. */
function depthOf(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length === 0 ? 1 : 1 + Math.max(...value.map(depthOf));
  }
  if (isPlainObject(value)) {
    const children = Object.values(value);
    return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOf));
  }
  return 0;
}

/** Пересобирает то же значение с перемешанным порядком ключей. Порядок массивов НЕ трогает. */
function reorderKeys(value: unknown, rng: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => reorderKeys(item, rng));
  if (!isPlainObject(value)) return value;

  const entries = Object.entries(value).map(
    ([key, child]) => [key, reorderKeys(child, rng)] as [string, unknown],
  );
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = rng() % (i + 1);
    const a = entries[i];
    const b = entries[j];
    if (a !== undefined && b !== undefined) {
      entries[i] = b;
      entries[j] = a;
    }
  }
  return Object.fromEntries(entries);
}

const SAMPLE_COUNT = 400;
const MAX_DEPTH = 4;

function corpus(): unknown[] {
  const rng = makeRng(0x5eed_1234);
  return Array.from({ length: SAMPLE_COUNT }, () => genValue(rng, MAX_DEPTH));
}

// ── 1. Контроль прибора ────────────────────────────────────────────────────────────────────

describe('S-01 — генератор порождает то, что обещано', () => {
  it('вложенность ≥ 3, массивы, пустые контейнеры, астральные ключи, экспоненциальные числа', () => {
    const samples = corpus();
    let maxDepth = 0;
    let arrays = 0;
    let emptyArrays = 0;
    let emptyObjects = 0;
    let astralKeys = 0;

    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        arrays += 1;
        if (value.length === 0) emptyArrays += 1;
        value.forEach(walk);
        return;
      }
      if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 0) emptyObjects += 1;
        // Астральный символ = суррогатная пара: длина в code units больше длины в code points.
        if (keys.some((key) => [...key].length !== key.length)) astralKeys += 1;
        keys.forEach((key) => { walk(value[key]); });
      }
    };

    for (const sample of samples) {
      maxDepth = Math.max(maxDepth, depthOf(sample));
      walk(sample);
    }

    const exponential = samples
      .map((sample) => canonicalJson(sample))
      .filter((text) => /\de[+-]\d/.test(text)).length;

    expect(maxDepth, 'вложенность ≥ 3').toBeGreaterThanOrEqual(3);
    expect(arrays, 'массивы').toBeGreaterThan(0);
    expect(emptyArrays, 'пустые массивы').toBeGreaterThan(0);
    expect(emptyObjects, 'пустые объекты').toBeGreaterThan(0);
    expect(astralKeys, 'ключи с астральными символами').toBeGreaterThan(0);
    expect(exponential, 'числа в экспоненциальной форме').toBeGreaterThan(0);
  });

  it('генератор детерминирован: два прогона дают один корпус', () => {
    // Иначе property-тест «зелёный сегодня» ничего не говорит про завтра (Charter V8).
    expect(corpus().map((v) => canonicalJson(v))).toEqual(corpus().map((v) => canonicalJson(v)));
  });
});

// ── 2. Property-тесты ──────────────────────────────────────────────────────────────────────

describe('S-01 — свойства канонизации на сгенерированном корпусе', () => {
  it('идемпотентность: canonicalJson(parse(canonicalJson(v))) === canonicalJson(v)', () => {
    for (const sample of corpus()) {
      const once = canonicalJson(sample);
      const twice = canonicalJson(JSON.parse(once));
      expect(twice, once.slice(0, 120)).toBe(once);
    }
  });

  it('порядок ключей не зависит от порядка вставки', () => {
    const rng = makeRng(0x0f0f_1111);
    for (const sample of corpus()) {
      expect(canonicalJson(reorderKeys(sample, rng))).toBe(canonicalJson(sample));
    }
  });

  it('вывод — валидный JSON, и числа переживают round-trip побитово', () => {
    const sameNumbers = (a: unknown, b: unknown): boolean => {
      if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
      if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => sameNumbers(x, b[i]));
      }
      if (isPlainObject(a) && isPlainObject(b)) {
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameNumbers(a[k], b[k]));
      }
      return Object.is(a, b);
    };

    for (const sample of corpus()) {
      const parsed: unknown = JSON.parse(canonicalJson(sample));
      expect(sameNumbers(parsed, sample), canonicalJson(sample).slice(0, 120)).toBe(true);
    }
  });
});

// ── 3. Порядок ключей — детерминированные утверждения ──────────────────────────────────────

describe('S-01 — порядок ключей', () => {
  it('сортировка на ВСЕХ уровнях, без единого незначимого пробела', () => {
    const value = { b: 1, a: [1, { d: 2, c: 3 }], c: {} };
    expect(canonicalJson(value)).toBe('{"a":[1,{"c":3,"d":2}],"b":1,"c":{}}');
  });

  it('порядок элементов массива значим и не сортируется', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('байтовый порядок UTF-8, а не UTF-16 code units — они расходятся', () => {
    // `\uFFFF`     → UTF-8 EF BF BF, UTF-16 code unit 0xFFFF
    // `\u{1D11E}`   → UTF-8 F0 9D 84 9E, UTF-16 суррогаты 0xD834 0xDD1E
    // По UTF-16 суррогат (0xD834) МЕНЬШЕ 0xFFFF ⇒ голое `.sort()` ставит астральный ключ первым.
    // По UTF-8 первый байт F0 БОЛЬШЕ EF ⇒ канонизация ставит его последним.
    const astral = '\u{1D11E}';
    const bmp = '\uFFFF';

    expect([astral, bmp].sort()).toEqual([astral, bmp]); // порядок UTF-16
    expect(canonicalJson({ [astral]: 1, [bmp]: 2 })).toBe(
      `{${JSON.stringify(bmp)}:2,${JSON.stringify(astral)}:1}`,
    );
  });

  it('пустой ключ и ключ с точкой канонизируются как обычные строки', () => {
    expect(canonicalJson({ 'a.b': 1, '': 2, a: 3 })).toBe('{"":2,"a":3,"a.b":1}');
  });
});

// ── 4. Запрещённые значения — каждое с путём ───────────────────────────────────────────────

describe('S-01 — запрещённое отвергается с путём, а не приводится молча', () => {
  class Custom {
    readonly x = 1;
  }

  const forbidden: ReadonlyArray<readonly [string, unknown]> = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['-0', -0],
    ['undefined', undefined],
    ['bigint', 1n],
    ['symbol', Symbol('s')],
    ['функция', () => 1],
    ['Map (R4)', new Map([['a', 1]])],
    ['Set (R4)', new Set([1])],
    ['Date', new Date(0)],
    ['RegExp', /x/],
    ['экземпляр класса', new Custom()],
  ];

  it.each(forbidden)('%s на глубине даёт CanonicalJsonError с путём `$.a[1].b`', (_why, value) => {
    const wrapped = { a: [0, { b: value }] };
    let caught: unknown;
    try {
      canonicalJson(wrapped);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CanonicalJsonError);
    expect((caught as CanonicalJsonError).path).toBe('$.a[1].b');
  });

  it.each(forbidden)('%s в корне даёт путь `$`', (_why, value) => {
    let caught: unknown;
    try {
      canonicalJson(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CanonicalJsonError);
    expect((caught as CanonicalJsonError).path).toBe('$');
  });

  it('`JSON.stringify` на тех же значениях НЕ падает — в этом и смысл собственной реализации', () => {
    // Контроль: если бы штатный сериализатор ловил их сам, правило линта было бы лишним.
    expect(JSON.stringify({ a: Number.NaN })).toBe('{"a":null}');
    expect(JSON.stringify({ a: -0 })).toBe('{"a":0}');
    expect(JSON.stringify({ a: undefined })).toBe('{}');
    expect(JSON.stringify({ a: new Set([1]) })).toBe('{"a":{}}');
  });

  it('цикл ловится и не уводит в переполнение стека', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(cyclic)).toThrow(/цикл/);
  });

  it('повторная ссылка БЕЗ цикла законна — это дерево, а не граф', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('объект с `null`-прототипом законен: это plain-данные', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 });
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
  });
});
