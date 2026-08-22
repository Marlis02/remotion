// `S-01` — branded-типы. Охраняется одно: **в тип нельзя попасть, не пройдя проверку**.
//
// ADR-0007 §3 / roadmap `S-01`: время, индексы и счётчики — целые; double — только для
// геометрии. Здесь исполнимая форма первой половины: `Number.isSafeInteger` и `≥ 0`.
// Строка **T2** реестра инвариантов этим НЕ закрывается — см. отчёт `S-01` §5.

import { describe, expect, it } from 'vitest';

import { asBlake3, asFrames, asSamples, asSha256 } from '../src/index.js';

const COUNTABLE = [
  ['asSamples', asSamples],
  ['asFrames', asFrames],
] as const;

const HEX = [
  ['asSha256', asSha256],
  ['asBlake3', asBlake3],
] as const;

describe('S-01 — счётные типы: целое ≥ 0 в пределах безопасных целых', () => {
  it.each(COUNTABLE)('%s принимает 0, 1 и Number.MAX_SAFE_INTEGER', (_name, make) => {
    expect(make(0)).toBe(0);
    expect(make(1)).toBe(1);
    expect(make(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  // `2 ** 53` — граница, ради которой взят `isSafeInteger`, а не `isInteger`: за ней
  // `2 ** 53 + 1 === 2 ** 53`, то есть сложение перестаёт быть точным молча.
  const rejected: ReadonlyArray<readonly [string, unknown]> = [
    ['дробное', 1.5],
    ['отрицательное', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['-0', -0],
    ['2 ** 53 (за границей точного сложения)', 2 ** 53],
    ['строка', '5'],
    ['null', null],
    ['undefined', undefined],
  ];

  it.each(COUNTABLE)('%s отвергает всё, что не целое ≥ 0', (_name, make) => {
    for (const [why, value] of rejected) {
      expect(() => make(value as number), why).toThrow();
    }
  });

  it('2 ** 53 отвергается, а MAX_SAFE_INTEGER — нет: граница именно там', () => {
    expect(Number.isInteger(2 ** 53)).toBe(true); // `isInteger` пропустил бы
    expect(Number.isSafeInteger(2 ** 53)).toBe(false);
    expect(() => asFrames(2 ** 53)).toThrow(/Number\.isSafeInteger/);
  });

  it('`-0` отвергается тем же правилом, что и в canonicalJson', () => {
    // Согласованность обязательна: счётчик, прошедший конструктор, но роняющий канонизацию,
    // означал бы, что модель умеет создавать значения, которые нельзя захэшировать.
    expect(() => asSamples(-0)).toThrow(/-0/);
  });
});

describe('S-01 — hex-дайджесты: 64 строчных символа', () => {
  const valid = 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262';

  it.each(HEX)('%s принимает 64 строчных hex-символа', (_name, make) => {
    expect(make(valid)).toBe(valid);
  });

  it.each(HEX)('%s отвергает заглавные, длину и не-hex', (_name, make) => {
    expect(() => make(valid.toUpperCase())).toThrow(/строчный hex/);
    expect(() => make(valid.slice(0, 63))).toThrow(/64 hex-символов/);
    expect(() => make(`${valid}0`)).toThrow(/64 hex-символов/);
    expect(() => make(`${valid.slice(0, 63)}g`)).toThrow(/строчный hex/);
    expect(() => make('')).toThrow(/64 hex-символов/);
    expect(() => make(0 as unknown as string)).toThrow(/ожидалась строка/);
  });

  it('заглавный hex именно ОТВЕРГАЕТСЯ, а не приводится к нижнему регистру', () => {
    // Приведение означало бы две законные записи одного дайджеста; тогда сравнение строк
    // перестаёт быть сравнением, а имя файла в CAS — однозначным.
    let normalized: unknown;
    try {
      normalized = asSha256(valid.toUpperCase());
    } catch {
      normalized = 'отвергнуто';
    }
    expect(normalized).toBe('отвергнуто');
  });
});
