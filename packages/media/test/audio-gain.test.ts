// `X-02` — усиление, duck по окнам речи и укладка подложки в окно клипа.
//
// ПРАВИЛО ЭТИХ ТЕСТОВ ТО ЖЕ, ЧТО У СОСЕДЕЙ (`audio-mix`, `audio-fade`): ни одного бинарника,
// всякий сигнал синтезируется из констант, а ожидание записано ФОРМУЛОЙ — `round(10^(дБ/20) ·
// 32768)`, — чтобы его можно было проверить калькулятором, а не доверять числу в скобках.

import { describe, expect, it } from 'vitest';

import {
  AudioError,
  FULL_SCALE,
  UNITY_GAIN,
  applyDuck,
  applyGain,
  clipWindow,
  gainFromDb,
  pcmS16,
} from '../src/index.js';

import { constant, projectSampleRateFixture, ramp, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();
const track = (values: Int16Array | readonly number[]): ReturnType<typeof pcmS16> =>
  pcmS16(RATE, values instanceof Int16Array ? values : samplesOf(values));

/** Ожидание, записанное формулой, а не числом: то же выражение, что в шапке `gain.ts`. */
const expectedNumerator = (db: number): number => Math.round(Math.pow(10, db / 20) * FULL_SCALE);

describe('`gainFromDb` — децибелы в целую дробь, один раз на клип', () => {
  it('уровни фикстуры: −18 дБ подложки и −24 дБ под речью', () => {
    // `fixtures/minimal`: `gainDb: -18`, `duckUnderSpeechDb: -6`; под речью уровни СКЛАДЫВАЮТСЯ.
    expect(gainFromDb(-18)).toEqual({ numerator: expectedNumerator(-18), denominator: FULL_SCALE });
    expect(gainFromDb(-18).numerator).toBe(4125);
    expect(gainFromDb(-24).numerator).toBe(2068);
  });

  it('пресеты duck `SP-VID` A6 переводятся без потери устойчивости', () => {
    // soft −1.2 / mid −6.3 / hard −14.7 дБ (`SP-VID` A6) — вход `VID-02b`. Ни один из трёх не
    // попадает на полуцелое, и это проверяется, а не предполагается.
    for (const db of [-1.2, -6.3, -14.7]) {
      expect(gainFromDb(db).numerator).toBe(expectedNumerator(db));
    }
  });

  it('`0 дБ` — единица БЕЗ `Math.pow`: точное значение, а не округлённое', () => {
    expect(gainFromDb(0)).toEqual(UNITY_GAIN);
    expect(UNITY_GAIN.numerator).toBe(UNITY_GAIN.denominator);
  });

  it('усиление ВЫШЕ нуля дБ — отказ: тракт не поднимает уровень выше принесённого', () => {
    expect(() => gainFromDb(0.5)).toThrow(AudioError);
    expect(() => gainFromDb(6)).toThrow(/не поднимает уровень/);
  });

  it('неустойчивое округление — отказ, а не молчаливый выбор стороны', () => {
    // Порог, у которого числитель лежит ровно на полуцелом: `20·log10(4125.5/32768)`.
    const db = 20 * Math.log10(4125.5 / FULL_SCALE);
    expect(() => gainFromDb(db)).toThrow(/полуцелому/);
  });

  it('бесконечность и NaN отвергаются до всякой арифметики', () => {
    expect(() => gainFromDb(Number.NEGATIVE_INFINITY)).toThrow(/конечное число/);
    expect(() => gainFromDb(Number.NaN)).toThrow(/конечное число/);
  });
});

describe('`applyGain` — целочисленное умножение с единственным правилом округления', () => {
  it('постоянный уровень умножается дробью и округляется к ближайшему', () => {
    const gain = gainFromDb(-6);
    const out = applyGain(track(constant(4, 10000)), gain);
    const expected = Math.round((10000 * gain.numerator) / gain.denominator);
    expect([...out.samples]).toEqual([expected, expected, expected, expected]);
  });

  it('знак не вносит смещения: ничьи округляются ОТ нуля симметрично', () => {
    const out = applyGain(track([1, -1, 3, -3]), { numerator: 1, denominator: 2 });
    expect([...out.samples]).toEqual([1, -1, 2, -2]);
  });

  it('единичное усиление отдаёт КОПИЮ, а не тот же массив', () => {
    const source = track([1, 2, 3]);
    const out = applyGain(source, UNITY_GAIN);
    expect([...out.samples]).toEqual([1, 2, 3]);
    expect(out.samples).not.toBe(source.samples);
  });
});

describe('`applyDuck` — огибающая по ОКНАМ ПЛАНА, а не по сигналу', () => {
  const base = gainFromDb(-18);
  const ducked = gainFromDb(-24);
  const level = 20000;

  it('под окном — уровень с duck, вне окна и вне рампы — базовый', () => {
    const out = applyDuck(track(constant(1000, level)), {
      windows: [{ fromSample: 400, toSample: 600 }],
      base,
      ducked,
      rampSamples: 100,
    });
    const outside = Math.round((level * base.numerator) / base.denominator);
    const inside = Math.round((level * ducked.numerator) / ducked.denominator);
    // Вне рампы — базовый уровень (первый сэмпл и последний).
    expect(out.samples[0]).toBe(outside);
    expect(out.samples[999]).toBe(outside);
    // Внутри окна — ровно подавленный, и это НЕ «примерно»: дробь целая, сэмпл постоянный.
    expect(out.samples[400]).toBe(inside);
    expect(out.samples[500]).toBe(inside);
    expect(out.samples[599]).toBe(inside);
  });

  it('рампа МОНОТОННА и стоит ПЕРЕД окном, а не внутри него', () => {
    const out = applyDuck(track(constant(1000, level)), {
      windows: [{ fromSample: 400, toSample: 600 }],
      base,
      ducked,
      rampSamples: 100,
    });
    // Спуск занимает `[300, 400)`: к первому сэмплу речи подложка уже внизу.
    for (let i = 300; i < 400; i += 1) {
      expect(out.samples[i] ?? 0).toBeLessThanOrEqual(out.samples[i - 1] ?? 0);
    }
    // Подъём — `[600, 700)`, зеркально.
    for (let i = 601; i < 700; i += 1) {
      expect(out.samples[i] ?? 0).toBeGreaterThanOrEqual(out.samples[i - 1] ?? 0);
    }
    // Граница рампы: на её краю уровень уже базовый.
    expect(out.samples[299]).toBe(Math.round((level * base.numerator) / base.denominator));
    expect(out.samples[700]).toBe(Math.round((level * base.numerator) / base.denominator));
  });

  it('между двумя близкими фразами подложка НЕ ВОЗВРАЩАЕТСЯ к базовому уровню', () => {
    const out = applyDuck(track(constant(1000, level)), {
      windows: [
        { fromSample: 300, toSample: 400 },
        { fromSample: 420, toSample: 500 },
      ],
      base,
      ducked,
      rampSamples: 100,
    });
    const inside = Math.round((level * ducked.numerator) / ducked.denominator);
    const outside = Math.round((level * base.numerator) / base.denominator);
    // ПРАВИЛО — «УРОВЕНЬ ПО РАССТОЯНИЮ ДО БЛИЖАЙШЕЙ ФРАЗЫ» (минимум по рампам). Промежуток
    // 20 сэмплов при рампе 100 означает, что дальше 10 сэмплов от речи уйти негде: подложка
    // поднимается не более чем на десятую часть хода и тут же ныряет обратно.
    const worst = Math.max(...[...out.samples.subarray(400, 420)]);
    expect(worst).toBeGreaterThanOrEqual(inside);
    expect(worst).toBeLessThan(inside + (outside - inside) / 5);
    // Ни один сэмпл промежутка не дотягивает до базового уровня — «всплыла между фразами»
    // выглядело бы именно так.
    expect(worst).toBeLessThan(outside);
    // Края промежутка держит речь: последний сэмпл первой фразы и первый сэмпл второй — на
    // подавленном уровне ровно, подъём начинается ЗА окном и успевает на один шаг рампы.
    expect(out.samples[399]).toBe(inside);
    expect(out.samples[420]).toBe(inside);
    expect(out.samples[400] ?? 0).toBeGreaterThan(inside);
  });

  it('порядок окон на результат не влияет — огибающая есть минимум, а не последовательность', () => {
    const windows = [
      { fromSample: 100, toSample: 200 },
      { fromSample: 500, toSample: 600 },
    ];
    const options = { base, ducked, rampSamples: 50 };
    const straight = applyDuck(track(constant(800, level)), { ...options, windows });
    const reversed = applyDuck(track(constant(800, level)), { ...options, windows: [...windows].reverse() });
    expect([...reversed.samples]).toEqual([...straight.samples]);
  });

  it('рампа нулевой длины — ступенька, законное значение', () => {
    const out = applyDuck(track(constant(10, level)), {
      windows: [{ fromSample: 5, toSample: 7 }],
      base,
      ducked,
      rampSamples: 0,
    });
    expect(out.samples[4]).toBe(Math.round((level * base.numerator) / base.denominator));
    expect(out.samples[5]).toBe(Math.round((level * ducked.numerator) / ducked.denominator));
  });

  it('разные знаменатели уровней — отказ: рампа считалась бы в двух шкалах', () => {
    expect(() =>
      applyDuck(track(constant(10, level)), {
        windows: [],
        base: { numerator: 1, denominator: 2 },
        ducked: { numerator: 1, denominator: 4 },
        rampSamples: 1,
      }),
    ).toThrow(/знаменател/);
  });
});

describe('`clipWindow` — точка входа, петля, паузы и микрофейд на стыках', () => {
  it('окно короче ассета: байты идут с `inPoint`, края погашены', () => {
    const source = track(constant(1000, 10000));
    const out = clipWindow(source, { inPointSamples: 100, lengthSamples: 500, fadeSamples: 10, loop: true });
    expect(out.samples.length).toBe(500);
    // Первый сэмпл гасится в НОЛЬ ровно: щёлкает именно скачок из тишины (T7).
    expect(out.samples[0]).toBe(0);
    expect(out.samples[499]).toBe(0);
    // Середина — байты ассета как есть, без единого изменения.
    expect(out.samples[250]).toBe(10000);
  });

  it('ПЕТЛЯ возвращается в `inPoint`, а не в ноль ассета', () => {
    // Ассет — пила: по значению сэмпла видно, откуда он взят.
    const source = track(ramp(100, 0, 10));
    const out = clipWindow(source, { inPointSamples: 60, lengthSamples: 120, fadeSamples: 0, loop: true });
    // Единица петли — `[60, 100)`, то есть 40 сэмплов: 120 = три повторения ровно.
    expect(out.samples[0]).toBe(600);
    expect(out.samples[39]).toBe(990);
    expect(out.samples[40]).toBe(600);
    expect(out.samples[80]).toBe(600);
  });

  it('стык петли ПОГАШЕН: скачок на стыке меньше, чем без фейда', () => {
    const source = track(ramp(100, 0, 300));
    const seam = 40;
    const withFade = clipWindow(source, { inPointSamples: 60, lengthSamples: 120, fadeSamples: 8, loop: true });
    const without = clipWindow(source, { inPointSamples: 60, lengthSamples: 120, fadeSamples: 0, loop: true });
    const jump = (samples: Int16Array): number =>
      Math.abs((samples[seam] ?? 0) - (samples[seam - 1] ?? 0));
    // Без фейда на стыке скачок во всю амплитуду петли; с фейдом обе стороны в нуле.
    expect(jump(without.samples)).toBeGreaterThan(10000);
    expect(jump(withFade.samples)).toBe(0);
    expect(withFade.samples[seam]).toBe(0);
    expect(withFade.samples[seam - 1]).toBe(0);
  });

  it('`loop: false` — остаток окна ТИШИНА, а не вторая копия', () => {
    const source = track(constant(50, 10000));
    const out = clipWindow(source, { inPointSamples: 0, lengthSamples: 120, fadeSamples: 0, loop: false });
    expect(out.samples[49]).toBe(10000);
    expect(out.samples[50]).toBe(0);
    expect(out.samples[119]).toBe(0);
  });

  it('длина результата — РОВНО окно клипа, сколько бы ни было повторов', () => {
    const source = track(constant(37, 5000));
    for (const length of [37, 74, 100, 1000]) {
      expect(clipWindow(source, { inPointSamples: 0, lengthSamples: length, fadeSamples: 4, loop: true }).samples.length).toBe(
        length,
      );
    }
  });

  it('in-point за концом ассета — отказ: играть было бы нечего', () => {
    const source = track(constant(10, 1000));
    expect(() => clipWindow(source, { inPointSamples: 10, lengthSamples: 20, fadeSamples: 0, loop: true })).toThrow(
      /за концом ассета/,
    );
  });

  it('ПАУЗА ИСТОЧНИКА: тишина ровно её длины, а после неё звук продолжается с того же места', () => {
    // Источник — пила: по значению сэмпла видно, ОТКУДА он взят, и это единственный способ
    // отличить «после паузы продолжили» от «после паузы перемотали».
    const source = track(ramp(200, 0, 10));
    const out = clipWindow(source, {
      inPointSamples: 0,
      lengthSamples: 60,
      fadeSamples: 0,
      loop: false,
      pauses: [{ atSourceSample: 10, lengthSamples: 20 }],
    });
    // До паузы — первые десять сэмплов источника.
    expect([...out.samples.subarray(0, 10)]).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    // Пауза — ровно 20 сэмплов тишины, ни одним больше.
    expect([...out.samples.subarray(10, 30)]).toEqual(new Array(20).fill(0));
    // После паузы источник продолжается С ОДИННАДЦАТОГО сэмпла, а не с нулевого и не с 31-го:
    // во время паузы время источника СТОЯЛО.
    expect(out.samples[30]).toBe(100);
    expect(out.samples[31]).toBe(110);
  });

  it('края паузы ПОГАШЕНЫ микрофейдом — стык «звук ↔ тишина» тот же, что стык петли', () => {
    const source = track(constant(200, 10000));
    const out = clipWindow(source, {
      inPointSamples: 0,
      lengthSamples: 60,
      fadeSamples: 4,
      loop: false,
      pauses: [{ atSourceSample: 20, lengthSamples: 20 }],
    });
    // Последний сэмпл перед паузой — ноль (фейд вниз), первый после — тоже (фейд вверх).
    expect(out.samples[19]).toBe(0);
    expect(out.samples[40]).toBe(0);
    // А в двух сэмплах от стыка звук уже есть: фейд короткий и границ не двигает.
    expect(out.samples[15]).toBe(10000);
    expect(out.samples[45]).toBe(10000);
  });

  it('петля и паузы вместе — ОТКАЗ: такой пары никто не объявлял', () => {
    const source = track(constant(100, 1000));
    expect(() =>
      clipWindow(source, {
        inPointSamples: 0,
        lengthSamples: 60,
        fadeSamples: 0,
        loop: true,
        pauses: [{ atSourceSample: 10, lengthSamples: 5 }],
      }),
    ).toThrow(/петля и паузы/);
  });

  it('окно короче двух микрофейдов — отказ, а не молча укороченный фейд', () => {
    const source = track(constant(100, 1000));
    expect(() => clipWindow(source, { inPointSamples: 0, lengthSamples: 10, fadeSamples: 6, loop: true })).toThrow(
      /короче двух микрофейдов/,
    );
  });
});
