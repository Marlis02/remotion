// `C-01` — кадровая арифметика на рациональном `fps{num, den}` (ADR-0003 T2).
//
// ТРИ УРОВНЯ ПРОВЕРКИ:
//   1. контрольные точки, выписанные в самом ADR-0003 T2 («Проверка формулы»);
//   2. эталон на `BigInt` — точная рациональная величина, пятнадцать пар
//      (три `sampleRate` × пять fps, включая обе дробные), длительности до десяти часов;
//   3. свойства, которые ADR формулирует как критерии приёмки: «сумма длительностей кадров
//      за секунду == `sampleRate`» (T2) и «`max |frameStart · samplesPerFrame − startSample|
//      ≤ ½ кадра`» (ADR-0003, Consequences, AC5-a; ADR-0007 §9).

import { asFrames, asSamples } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import {
  SEED,
  TEN_HOURS_SECONDS,
  frameOfSampleBig,
  frameStartSampleBig,
  matrix,
  nextInt,
  reduceBig,
  splitmix32,
} from './etalon.js';
import {
  frameInterval,
  frameLengthInSamples,
  frameOfSample,
  frameStartSample,
  samplesPerFrame,
  timeGrid,
  clipDurationInFrames,
} from '../src/index.js';

const DRAWS = 600;

/** `f = 30 fps` при 24 кГц: `samplesPerFrame = 800`. Пара названа в ADR-0003 T2 поимённо. */
const ADR_GRID = timeGrid(24000, { num: 30, den: 1 });

describe('T2 — контрольные точки самого ADR-0003', () => {
  it('sampleRate=24000, fps=30 ⇒ frameOfSample(800)=1, (400)=1, (399)=0', () => {
    expect(frameOfSample(ADR_GRID, asSamples(800))).toBe(1);
    expect(frameOfSample(ADR_GRID, asSamples(400))).toBe(1);
    expect(frameOfSample(ADR_GRID, asSamples(399))).toBe(0);
  });

  it('round-half-up: ровно половина кадра округляется ВВЕРХ, а не к чётному и не вниз', () => {
    // 400 — это ровно ½ кадра при S = 800. Нижняя половина остаётся в кадре 0.
    expect(frameOfSample(ADR_GRID, asSamples(0))).toBe(0);
    expect(frameOfSample(ADR_GRID, asSamples(399))).toBe(0);
    expect(frameOfSample(ADR_GRID, asSamples(400))).toBe(1);
    expect(frameOfSample(ADR_GRID, asSamples(1199))).toBe(1);
    expect(frameOfSample(ADR_GRID, asSamples(1200))).toBe(2);
  });

  it('frameStartSample на целочисленной сетке — просто кратное', () => {
    expect(frameStartSample(ADR_GRID, asFrames(0))).toBe(0);
    expect(frameStartSample(ADR_GRID, asFrames(1))).toBe(800);
    expect(frameStartSample(ADR_GRID, asFrames(30))).toBe(24000);
  });
});

describe('T2 — `samplesPerFrame` рационален и точен', () => {
  it('целочисленный случай: 24000 при 30/1 — это 800/1, а не 800.0000001', () => {
    expect(samplesPerFrame(ADR_GRID)).toStrictEqual({ num: 800, den: 1 });
  });

  it('дробный случай 48000 при 30000/1001 не превращается во float', () => {
    const value = samplesPerFrame(timeGrid(48000, { num: 30000, den: 1001 }));
    // 1601.6 в двоичной дроби непредставимо; пара обязана остаться парой.
    expect(value.num % value.den).not.toBe(0);
    expect(value.num / value.den).toBeCloseTo(1601.6, 9);
    const exact = reduceBig(48000n * 1001n, 30000n);
    expect(BigInt(value.num)).toBe(exact.num);
    expect(BigInt(value.den)).toBe(exact.den);
  });

  it.each(matrix())('дробь сокращена и знаменатель > 0: sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const value = samplesPerFrame(timeGrid(rate, fps));
    const exact = reduceBig(BigInt(rate) * BigInt(fps.den), BigInt(fps.num));
    expect(value.den).toBeGreaterThan(0);
    expect(BigInt(value.num)).toBe(exact.num);
    expect(BigInt(value.den)).toBe(exact.den);
  });

  it.each(matrix())(
    '`frameStartSample(f) == floor(f · samplesPerFrame)`: sampleRate=$rate, fps=$fps.label',
    ({ rate, fps }) => {
      const grid = timeGrid(rate, fps);
      const spf = samplesPerFrame(grid);
      const rng = splitmix32(SEED ^ rate ^ fps.num);
      const maxFrame = Math.floor((TEN_HOURS_SECONDS * fps.num) / fps.den);
      for (let i = 0; i < 200; i += 1) {
        const f = nextInt(rng, maxFrame);
        const expected = (BigInt(f) * BigInt(spf.num)) / BigInt(spf.den);
        expect(BigInt(frameStartSample(grid, asFrames(f))), `f=${String(f)}`).toBe(expected);
      }
    },
  );
});

describe('T2 — эталон `BigInt` на пятнадцати парах, до десяти часов', () => {
  it.each(matrix())('frameStartSample: sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    const maxFrame = Math.floor((TEN_HOURS_SECONDS * fps.num) / fps.den);
    const seed = SEED ^ rate ^ (fps.num << 3);
    const rng = splitmix32(seed);
    const probes = [0, 1, 2, maxFrame - 1, maxFrame];
    for (let i = 0; i < DRAWS; i += 1) probes.push(nextInt(rng, maxFrame));
    for (const f of probes) {
      const actual = frameStartSample(grid, asFrames(f));
      expect(
        BigInt(actual),
        `сид 0x${seed.toString(16)}: f=${String(f)}, sampleRate=${String(rate)}, fps=${fps.label} ` +
          `⇒ frameStartSample вернул ${String(actual)}`,
      ).toBe(frameStartSampleBig(f, rate, fps.num, fps.den));
    }
  });

  it.each(matrix())('frameOfSample: sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    const maxSample = TEN_HOURS_SECONDS * rate;
    const seed = SEED ^ rate ^ (fps.num << 5);
    const rng = splitmix32(seed);
    const probes = [0, 1, 2, maxSample - 1, maxSample];
    for (let i = 0; i < DRAWS; i += 1) probes.push(nextInt(rng, maxSample));
    for (const x of probes) {
      const actual = frameOfSample(grid, asSamples(x));
      expect(
        BigInt(actual),
        `сид 0x${seed.toString(16)}: x=${String(x)}, sampleRate=${String(rate)}, fps=${fps.label} ` +
          `⇒ frameOfSample вернул ${String(actual)}`,
      ).toBe(frameOfSampleBig(x, rate, fps.num, fps.den));
    }
  });

  it.each(matrix())('границы кадра перебраны исчерпывающе: sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    // Вокруг каждой из первых двадцати границ кадра и вокруг каждой полукадровой зоны.
    for (let f = 0; f < 20; f += 1) {
      const start = Number(frameStartSampleBig(f, rate, fps.num, fps.den));
      for (const x of [start - 1, start, start + 1]) {
        if (x < 0) continue;
        expect(BigInt(frameOfSample(grid, asSamples(x))), `f=${String(f)}, x=${String(x)}`).toBe(
          frameOfSampleBig(x, rate, fps.num, fps.den),
        );
      }
    }
  });
});

describe('T2 — сумма длительностей кадров за секунду равна `sampleRate` точно', () => {
  // ЧТО ЗНАЧИТ «ЗА СЕКУНДУ» ПРИ ДРОБНОМ fps. При 30000/1001 в одной секунде нецелое число
  // кадров (29.97), и утверждение «сумма кадров за секунду» в буквальном виде ЛОЖНО — суммы
  // просто не из чего составить. Точная форма того же утверждения: за `den` секунд проходит
  // ровно `num` кадров, и их суммарная длительность равна `den · sampleRate`. При `den = 1`
  // это дословно строка ADR; при `den = 1001` — её единственное осмысленное обобщение.
  it.each(matrix())('sampleRate=$rate, fps=$fps.label — несколько периодов подряд', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    const expected = BigInt(rate) * BigInt(fps.den);
    // Для целых fps берётся десять секунд подряд плюс дальняя (десятый час) — чтобы тест
    // не держался на первой секунде, где всё сходится тривиально.
    const periods = fps.den === 1 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 3599] : [0, 1, 2];
    for (const k of periods) {
      let sum = 0n;
      for (let i = 0; i < fps.num; i += 1) {
        sum += BigInt(frameLengthInSamples(grid, asFrames(k * fps.num + i)));
      }
      expect(
        sum,
        `sampleRate=${String(rate)}, fps=${fps.label}, период ${String(k)} ` +
          `(секунды ${String(k * fps.den)}…${String((k + 1) * fps.den)})`,
      ).toBe(expected);
    }
  });

  it('при дробном fps длительности кадров РАЗНЫЕ — иначе тест был бы тавтологией', () => {
    const grid = timeGrid(48000, { num: 30000, den: 1001 });
    const lengths = new Set<number>();
    for (let f = 0; f < 50; f += 1) lengths.add(frameLengthInSamples(grid, asFrames(f)));
    expect([...lengths].sort((a, b) => a - b)).toStrictEqual([1601, 1602]);
  });

  it('при целом fps все кадры одинаковы и равны `samplesPerFrame`', () => {
    for (let f = 0; f < 50; f += 1) {
      expect(frameLengthInSamples(ADR_GRID, asFrames(f))).toBe(800);
    }
  });
});

describe('T2 — свойства, названные в ADR как критерии приёмки', () => {
  it.each(matrix())(
    'AC5-a: |frameStart · samplesPerFrame − startSample| ≤ ½ кадра, sampleRate=$rate, fps=$fps.label',
    ({ rate, fps }) => {
      const grid = timeGrid(rate, fps);
      const maxSample = TEN_HOURS_SECONDS * rate;
      const seed = SEED ^ rate ^ (fps.num << 7);
      const rng = splitmix32(seed);
      for (let i = 0; i < 300; i += 1) {
        const x = nextInt(rng, maxSample);
        const f = BigInt(frameOfSample(grid, asSamples(x)));
        // |f·S − x| ≤ S/2, где S = rate·den/num. Всё умножено на 2·num, чтобы остаться целым.
        const deviation = f * BigInt(rate) * BigInt(fps.den) - BigInt(x) * BigInt(fps.num);
        const bound = BigInt(rate) * BigInt(fps.den);
        expect(
          2n * (deviation < 0n ? -deviation : deviation) <= bound,
          `сид 0x${seed.toString(16)}: x=${String(x)} ⇒ кадр ${String(f)}, отклонение вне ½ кадра`,
        ).toBe(true);
      }
    },
  );

  it.each(matrix())('frameOfSample(frameStartSample(f)) == f, sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    const maxFrame = Math.floor((TEN_HOURS_SECONDS * fps.num) / fps.den);
    const seed = SEED ^ rate ^ (fps.num << 9);
    const rng = splitmix32(seed);
    for (let i = 0; i < 200; i += 1) {
      const f = nextInt(rng, maxFrame);
      expect(frameOfSample(grid, frameStartSample(grid, asFrames(f))), `сид 0x${seed.toString(16)}, f=${String(f)}`).toBe(f);
    }
  });

  it.each(matrix())('обе функции монотонны, sampleRate=$rate, fps=$fps.label', ({ rate, fps }) => {
    const grid = timeGrid(rate, fps);
    const rng = splitmix32(SEED ^ rate ^ (fps.num << 11));
    for (let i = 0; i < 200; i += 1) {
      const f = nextInt(rng, 100000);
      const x = nextInt(rng, 10000000);
      expect(frameStartSample(grid, asFrames(f + 1))).toBeGreaterThanOrEqual(frameStartSample(grid, asFrames(f)));
      expect(frameOfSample(grid, asSamples(x + 1))).toBeGreaterThanOrEqual(frameOfSample(grid, asSamples(x)));
    }
  });
});

describe('T2 — отказы называют величину, а не следствие', () => {
  it('переполнение в frameStartSample называет `f · sampleRate`', () => {
    expect(() => frameStartSample(timeGrid(48000, { num: 30, den: 1 }), asFrames(2 ** 40))).toThrow(
      /`f · sampleRate`/,
    );
  });

  it('переполнение в frameOfSample называет `2 · x · fpsNum`', () => {
    expect(() => frameOfSample(timeGrid(48000, { num: 30000, den: 1001 }), asSamples(2 ** 45))).toThrow(
      /`2 · x · fpsNum`/,
    );
  });

  it('негодная сетка отвергается на входе каждой функции', () => {
    const broken = { sampleRate: 0, fps: { num: 30, den: 1 } };
    expect(() => samplesPerFrame(broken)).toThrow(/`sampleRate`/);
    expect(() => frameStartSample(broken, asFrames(1))).toThrow(/`sampleRate`/);
    expect(() => frameOfSample(broken, asSamples(1))).toThrow(/`sampleRate`/);
    expect(() => timeGrid(24000, { num: 0, den: 1 })).toThrow(/`fps.num`/);
    expect(() => timeGrid(24000, { num: 30, den: -1 })).toThrow(/`fps.den`/);
  });

  it('умолчаний нет: сетка обязана быть передана целиком', () => {
    // 30 fps — величина `compileProfile`, а не константа модели (ADR-0003, «fps = 30 —
    // решение, а не умолчание»). Ни одна функция не подставляет её сама.
    expect(timeGrid(24000, { num: 30, den: 1 })).toStrictEqual({ sampleRate: 24000, fps: { num: 30, den: 1 } });
    expect(Object.isFrozen(timeGrid(24000, { num: 30, den: 1 }))).toBe(true);
  });
});

describe('T3 — `clipDurationInFrames`', () => {
  it('длительность клипа — это `frameEnd − frameStart`', () => {
    expect(clipDurationInFrames(frameInterval(asFrames(0), asFrames(1)))).toBe(1);
    expect(clipDurationInFrames(frameInterval(asFrames(10), asFrames(45)))).toBe(35);
  });

  it('нулевая длительность непредставима: интервал её не пропускает', () => {
    expect(() => frameInterval(asFrames(7), asFrames(7))).toThrow(/полуоткрыт/);
  });
});
