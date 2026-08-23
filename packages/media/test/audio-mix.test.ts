// `M-03` — микс: сложение целых сэмплов с насыщением, длины, граница «только своя частота».

import { describe, expect, it } from 'vitest';

import {
  AudioError,
  PCM_SAMPLE_MAX,
  PCM_SAMPLE_MIN,
  applyEdgeFade,
  mixSaturating,
  pcmS16,
  silence,
} from '../src/index.js';

import { constant, projectSampleRateFixture, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();
const track = (values: readonly number[]): ReturnType<typeof pcmS16> => pcmS16(RATE, samplesOf(values));

describe('микс двух известных сигналов — точное ожидание по сэмплам', () => {
  it('сумма поэлементна и целочисленна', () => {
    const result = mixSaturating([track([100, -100, 0, 5]), track([1, 2, 3, -5])], RATE);
    expect([...result.mixed.samples]).toEqual([101, -98, 3, 0]);
    expect(result.clippedSamples).toBe(0);
    expect(result.mixed.sampleRate).toBe(RATE);
  });

  it('три дорожки складываются так же', () => {
    const result = mixSaturating([track([1, 2]), track([10, 20]), track([100, 200])], RATE);
    expect([...result.mixed.samples]).toEqual([111, 222]);
  });

  it('два прогона одного входа дают побайтово равный выход', () => {
    const inputs = [track([1, -2, 3, -4, 5]), track([-1, 2, -3, 4, -5])];
    const first = mixSaturating(inputs, RATE);
    const second = mixSaturating(inputs, RATE);
    expect([...first.mixed.samples]).toEqual([...second.mixed.samples]);
  });
});

describe('насыщение на переполнении', () => {
  it('обе границы шкалы, и обрезка сосчитана', () => {
    const result = mixSaturating([track([30000, -30000, 0]), track([10000, -10000, 0])], RATE);
    expect([...result.mixed.samples]).toEqual([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN, 0]);
    expect(result.clippedSamples).toBe(2);
  });

  it('ровно на границе обрезки нет, на единицу дальше — есть', () => {
    const exact = mixSaturating([track([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN]), track([0, 0])], RATE);
    expect(exact.clippedSamples).toBe(0);
    expect([...exact.mixed.samples]).toEqual([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN]);

    const over = mixSaturating([track([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN]), track([1, -1])], RATE);
    expect(over.clippedSamples).toBe(2);
    expect([...over.mixed.samples]).toEqual([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN]);
  });

  it('насыщение — факт в отчёте, а не отказ (решение владельца: решает `CP-05`)', () => {
    expect(() => mixSaturating([track([32000]), track([32000])], RATE)).not.toThrow();
  });

  it('самая громкая пара шкалы не переполняет промежуточную сумму', () => {
    const rail = pcmS16(RATE, constant(4, PCM_SAMPLE_MIN));
    const result = mixSaturating([rail, rail], RATE);
    expect([...result.mixed.samples]).toEqual([PCM_SAMPLE_MIN, PCM_SAMPLE_MIN, PCM_SAMPLE_MIN, PCM_SAMPLE_MIN]);
    expect(result.clippedSamples).toBe(4);
  });
});

describe('порядок операций: фейд ДО микса, к КАЖДОЙ дорожке', () => {
  // Требование владельца (ответ A, сессия `M-03`), и оно проверяемо ровно здесь: у суммы
  // нет своих краёв T7 — края есть у дорожек. Дорожки разной длины, обе отфейдены ДО микса.
  const FADE = 2;
  const short = applyEdgeFade(pcmS16(RATE, constant(8, 1000)), FADE);
  const long = applyEdgeFade(pcmS16(RATE, constant(12, 100)), FADE);
  const { mixed } = mixSaturating([short, long], RATE);

  it('край КОРОТКОЙ дорожки отфейден внутри суммы', () => {
    // Последний сэмпл короткой погашен в ноль, поэтому в позиции 7 суммы от неё ровно 0,
    // а не 1000: край контента, кончающегося В СЕРЕДИНЕ суммы, погашен.
    expect(short.samples[7]).toBe(0);
    expect(mixed.samples[7]).toBe(100);
    expect(short.samples[6]).toBe(500);
    expect(mixed.samples[6]).toBe(600);
  });

  it('хвост ДЛИННОЙ после конца короткой не тронут ни одним сэмплом', () => {
    expect([...mixed.samples.subarray(8)]).toEqual([...long.samples.subarray(8)]);
  });

  it('сумма поэлементна на всей длине — микс ничего не гасит и ничего не сдвигает', () => {
    expect([...mixed.samples]).toEqual([0, 550, 1100, 1100, 1100, 1100, 600, 100, 100, 100, 50, 0]);
  });

  it('к САМОЙ сумме фейд не применён: неотфейденная дорожка выходит из микса как есть', () => {
    // Дорожка без фейда — единственный способ отличить «фейд до микса» от «фейд после»:
    // если бы `mixSaturating` гасил свой результат, край суммы обнулился бы и здесь.
    const raw = pcmS16(RATE, constant(12, 100));
    const result = mixSaturating([short, raw], RATE);
    expect(result.mixed.samples[0]).toBe(100);
    expect(result.mixed.samples[11]).toBe(100);
    expect([...result.mixed.samples.subarray(8)]).toEqual([100, 100, 100, 100]);
  });
});

describe('дорожки разной длины: максимум, короткие дополняются тишиной', () => {
  it('длина результата — максимум, хвост равен длинной дорожке', () => {
    const result = mixSaturating([track([1, 1, 1, 1]), track([10, 10])], RATE);
    expect([...result.mixed.samples]).toEqual([11, 11, 1, 1]);
    expect(result.inputLengths).toEqual([4, 2]);
  });

  it('дополнение наблюдаемо: длины входов возвращаются в порядке аргументов', () => {
    const result = mixSaturating([silence(RATE, 1), track([7, 7, 7])], RATE);
    expect(result.inputLengths).toEqual([1, 3]);
    expect([...result.mixed.samples]).toEqual([7, 7, 7]);
  });

  it('дорожка нулевой длины законна и ничего не меняет', () => {
    const result = mixSaturating([track([1, 2]), silence(RATE, 0)], RATE);
    expect([...result.mixed.samples]).toEqual([1, 2]);
  });
});

describe('в микс попадает ТОЛЬКО приведённое к `projectSampleRate`', () => {
  it('дорожка на 44100 отвергается — ресемплинг живёт на ingest, а не здесь', () => {
    const alien = pcmS16(44100, samplesOf([1, 2]));
    let error: unknown;
    try {
      mixSaturating([track([1, 2]), alien], RATE);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('ADR-0003 «Разделение sampleRate»');
    expect((error as AudioError).message).toContain('дорожка №2');
  });

  it('микс без дорожек — отказ: пустая сумма это тишина неизвестной длины', () => {
    expect(() => mixSaturating([], RATE)).toThrow(AudioError);
  });
});
