// `C-01` — `msToSamples` (ADR-0003 T1).
//
// Проверяется три вещи: (1) значение совпадает с точной рациональной величиной на `BigInt`;
// (2) границы ведут себя как решено — ноль даёт ноль, отрицательное отвергается;
// (3) отказ называет ПРАВИЛО, а не следствие.

import { asSamples } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { SAMPLE_RATES, SEED, TEN_HOURS_SECONDS, msToSamplesBig, nextInt, splitmix32 } from './etalon.js';
import { TimeModelError, msToSamples } from '../src/index.js';

/** Десять часов в миллисекундах — верхняя граница, названная заданием `C-01`. */
const TEN_HOURS_MS = TEN_HOURS_SECONDS * 1000;

const DRAWS = 3000;

describe('T1 — `msToSamples` единственная функция перевода', () => {
  it.each(SAMPLE_RATES)('точные значения на sampleRate=%i', (rate) => {
    expect(msToSamples(0, rate)).toBe(0);
    expect(msToSamples(1000, rate)).toBe(rate);
    expect(msToSamples(2000, rate)).toBe(2 * rate);
  });

  it('дробный сэмпл усекается ВНИЗ, а не округляется', () => {
    // 1 мс при 44100 — это 44.1 сэмпла (ADR-0003, Context п. 4: ровно здесь в компилятор
    // просачивался бы float). `floorDiv` даёт 44, а не 44.1 и не 45.
    expect(msToSamples(1, 44100)).toBe(44);
    expect(msToSamples(3, 44100)).toBe(132);
    expect(msToSamples(400, 24000)).toBe(9600);
    expect(msToSamples(1, 24000)).toBe(24);
    expect(msToSamples(1, 1)).toBe(0);
  });

  it.each(SAMPLE_RATES)(
    `эталон \`BigInt\`: ${String(DRAWS)} значений до десяти часов, sampleRate=%i`,
    (rate) => {
      const rng = splitmix32(SEED ^ rate);
      for (let i = 0; i < DRAWS; i += 1) {
        const ms = nextInt(rng, TEN_HOURS_MS);
        const actual = msToSamples(ms, rate);
        expect(
          BigInt(actual),
          `сид 0x${(SEED ^ rate).toString(16)}, розыгрыш ${String(i)}: ms=${String(ms)}, ` +
            `sampleRate=${String(rate)} ⇒ msToSamples вернул ${String(actual)}`,
        ).toBe(msToSamplesBig(ms, rate));
      }
    },
  );

  it.each(SAMPLE_RATES)('границы диапазона перебраны исчерпывающе, sampleRate=%i', (rate) => {
    const edges = [0, 1, 2, 999, 1000, 1001, TEN_HOURS_MS - 1, TEN_HOURS_MS];
    for (const ms of edges) {
      expect(BigInt(msToSamples(ms, rate)), `ms=${String(ms)}, sampleRate=${String(rate)}`).toBe(
        msToSamplesBig(ms, rate),
      );
    }
  });

  it('результат — брендированные `Samples`, то есть прошёл конструктор', () => {
    const value = msToSamples(1234, 24000);
    // Присваивание в `Samples` без каста компилируется только потому, что тип уже такой.
    const asBrand = value;
    expect(asBrand).toBe(asSamples(29616));
  });

  it('отрицательные миллисекунды ОТВЕРГАЮТСЯ, а не округляются к нулю', () => {
    // Решение `C-01`: ADR-0003 про знак молчит, но `floorDiv(-1 · 24000, 1000) = -24`
    // увело бы результат ОТ нуля, а `asSamples` затем отказал бы сообщением про бренд.
    // Отказ здесь называет причину, а не следствие.
    expect(() => msToSamples(-1, 24000)).toThrow(TimeModelError);
    expect(() => msToSamples(-1, 24000)).toThrow(/ADR-0003 T1/);
    expect(() => msToSamples(-1, 24000)).toThrow(/неотрицательны/);
    expect(() => msToSamples(-1000, 24000)).toThrow(/nudgeSamples/);
  });

  it('негодные аргументы: дробные, `NaN`, нулевая и отрицательная частота', () => {
    expect(() => msToSamples(1.5, 24000)).toThrow(/`ms`/);
    expect(() => msToSamples(Number.NaN, 24000)).toThrow(/`ms`/);
    expect(() => msToSamples(100, 0)).toThrow(/`sampleRate`.*> 0/s);
    expect(() => msToSamples(100, -24000)).toThrow(/`sampleRate`/);
    expect(() => msToSamples(100, 24000.5)).toThrow(/`sampleRate`/);
  });

  it('T2: произведение `ms · sampleRate` за 2^53 — ошибка с именем величины', () => {
    expect(() => msToSamples(Number.MAX_SAFE_INTEGER, 48000)).toThrow(/`ms · sampleRate`/);
  });

  it('монотонность: больше миллисекунд — не меньше сэмплов', () => {
    const rng = splitmix32(SEED + 3);
    for (let i = 0; i < 500; i += 1) {
      const ms = nextInt(rng, TEN_HOURS_MS);
      const step = nextInt(rng, 5000);
      expect(
        msToSamples(ms + step, 44100) >= msToSamples(ms, 44100),
        `сид 0x${(SEED + 3).toString(16)}: ms=${String(ms)}, шаг=${String(step)}`,
      ).toBe(true);
    }
  });
});
