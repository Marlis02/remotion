// `C-01` — целочисленные помощники (ADR-0003 T1: «`floorDiv`/`ceilDiv` живут рядом с
// `msToSamples` и покрыты тем же property-тестом»; T2: проверка `Number.isSafeInteger`).
//
// ЭТАЛОН ДЛЯ ДЕЛЕНИЯ — НЕ ВТОРАЯ РЕАЛИЗАЦИЯ, А СВОЙСТВО. Для `floorDiv` проверяется
// `q·b ≤ a < (q+1)·b` (при `b > 0`; при `b < 0` неравенства переворачиваются) на `BigInt`.
// Это определение округления вниз, а не его копия: копия совпала бы с ошибкой, если бы
// ошибка была в самом определении.

import { describe, expect, it } from 'vitest';

import { SEED, nextInt, splitmix32 } from './etalon.js';
import { TimeModelError } from '../src/index.js';
import { addExact, assertSafeInteger, ceilDiv, floorDiv, mulExact } from '../src/index.js';

const DRAWS = 4000;

/** Диапазоны включают ноль, единицу, знаки и величины у границы безопасных целых. */
const EDGE_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
  [7, 2], [-7, 2], [7, -2], [-7, -2],
  [6, 3], [-6, 3], [6, -3], [-6, -3],
  [Number.MAX_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER, 3],
  [-Number.MAX_SAFE_INTEGER, 3], [Number.MAX_SAFE_INTEGER, -3],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  [Number.MAX_SAFE_INTEGER - 1, 2],
];

function checkFloor(a: number, b: number, provenance: string): void {
  const q = floorDiv(a, b);
  const [A, B, Q] = [BigInt(a), BigInt(b), BigInt(q)];
  const message = `${provenance}: floorDiv(${String(a)}, ${String(b)}) = ${String(q)}`;
  expect(Number.isSafeInteger(q), message).toBe(true);
  if (B > 0n) {
    expect(Q * B <= A, message).toBe(true);
    expect(A < (Q + 1n) * B, message).toBe(true);
  } else {
    expect(Q * B >= A, message).toBe(true);
    expect(A > (Q + 1n) * B, message).toBe(true);
  }
  expect(Object.is(q, -0), `${message}: результат не должен быть \`-0\``).toBe(false);
}

function checkCeil(a: number, b: number, provenance: string): void {
  const q = ceilDiv(a, b);
  const [A, B, Q] = [BigInt(a), BigInt(b), BigInt(q)];
  const message = `${provenance}: ceilDiv(${String(a)}, ${String(b)}) = ${String(q)}`;
  expect(Number.isSafeInteger(q), message).toBe(true);
  if (B > 0n) {
    expect(Q * B >= A, message).toBe(true);
    expect(A > (Q - 1n) * B, message).toBe(true);
  } else {
    expect(Q * B <= A, message).toBe(true);
    expect(A < (Q - 1n) * B, message).toBe(true);
  }
  expect(Object.is(q, -0), `${message}: результат не должен быть \`-0\``).toBe(false);
}

describe('T1/T2 — целочисленные помощники', () => {
  it('floorDiv/ceilDiv: краевые пары, включая обе границы безопасных целых', () => {
    for (const [a, b] of EDGE_PAIRS) {
      checkFloor(a, b, 'краевая пара');
      checkCeil(a, b, 'краевая пара');
    }
  });

  it(`floorDiv/ceilDiv: ${String(DRAWS)} случайных пар со знаками (сид печатается при падении)`, () => {
    const rng = splitmix32(SEED);
    for (let i = 0; i < DRAWS; i += 1) {
      const magnitude = [1e3, 1e6, 1e9, 1e15][nextInt(rng, 3)] ?? 1e3;
      const a = (nextInt(rng, magnitude) || 0) * (nextInt(rng, 1) === 0 ? 1 : -1);
      const b = ((nextInt(rng, 9999) || 0) + 1) * (nextInt(rng, 1) === 0 ? 1 : -1);
      const provenance = `сид 0x${SEED.toString(16)}, розыгрыш ${String(i)}`;
      checkFloor(a, b, provenance);
      checkCeil(a, b, provenance);
    }
  });

  it('floorDiv и ceilDiv совпадают ровно тогда, когда деление точное', () => {
    const rng = splitmix32(SEED + 1);
    for (let i = 0; i < 500; i += 1) {
      const b = nextInt(rng, 997) + 1;
      const a = nextInt(rng, 1e9) - 5e8;
      const exact = a % b === 0;
      const message = `сид 0x${(SEED + 1).toString(16)}, a=${String(a)}, b=${String(b)}`;
      expect(floorDiv(a, b) === ceilDiv(a, b), message).toBe(exact);
    }
  });

  it('деление на ноль — ошибка правила, а не `Infinity`', () => {
    expect(() => floorDiv(1, 0)).toThrow(TimeModelError);
    expect(() => ceilDiv(1, 0)).toThrow(/деление на ноль/);
  });

  it('нецелые и `NaN` отвергаются, а не округляются молча', () => {
    expect(() => floorDiv(1.5, 2)).toThrow(/Number\.isSafeInteger/);
    expect(() => floorDiv(1, Number.NaN)).toThrow(/Number\.isSafeInteger/);
    expect(() => assertSafeInteger(Number.POSITIVE_INFINITY, 'проба')).toThrow(/`проба`/);
  });

  it('T2: произведение за 2^53 — ошибка С ИМЕНЕМ ВЕЛИЧИНЫ, а не тихий float', () => {
    const a = 2 ** 40;
    const b = 48000;
    // Сначала показывается, что молчаливый путь действительно врёт: без проверки
    // произведение вышло бы за границу точности и уехало бы дальше как «целое».
    expect(Number.isSafeInteger(a * b)).toBe(false);
    expect(() => mulExact(a, b, 'f · sampleRate')).toThrow(TimeModelError);
    expect(() => mulExact(a, b, 'f · sampleRate')).toThrow(/`f · sampleRate`/);
    expect(() => mulExact(a, b, 'f · sampleRate')).toThrow(/2\^53/);
  });

  it('T2: сумма за 2^53 — тоже ошибка с именем величины', () => {
    const half = Number.MAX_SAFE_INTEGER;
    expect(() => addExact(half, half, '2 · x · fpsNum + sampleRate · fpsDen')).toThrow(
      /`2 · x · fpsNum \+ sampleRate · fpsDen`/,
    );
  });

  it('T2: имя величины называет ИМЕННО ТОТ множитель, который негоден', () => {
    expect(() => mulExact(1.5, 2, 'f · sampleRate')).toThrow(/левый множитель/);
    expect(() => mulExact(2, 1.5, 'f · sampleRate')).toThrow(/правый множитель/);
  });

  it('mulExact/addExact точны на всём диапазоне безопасных целых', () => {
    const rng = splitmix32(SEED + 2);
    for (let i = 0; i < 2000; i += 1) {
      const a = nextInt(rng, 3e7);
      const b = nextInt(rng, 3e7);
      const message = `сид 0x${(SEED + 2).toString(16)}, a=${String(a)}, b=${String(b)}`;
      expect(BigInt(mulExact(a, b, 'проба')), message).toBe(BigInt(a) * BigInt(b));
      expect(BigInt(addExact(a, b, 'проба')), message).toBe(BigInt(a) + BigInt(b));
    }
  });
});
