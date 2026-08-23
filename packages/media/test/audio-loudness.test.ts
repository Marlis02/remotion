// `M-03` — контроль громкости: точный целочисленный пик, честное отсутствие LUFS.

import { describe, expect, it } from 'vitest';

import {
  AudioError,
  FULL_SCALE,
  PCM_SAMPLE_MAX,
  PCM_SAMPLE_MIN,
  checkLoudness,
  dbFsOf,
  measureLoudness,
  pcmS16,
  peakLimitFromDb,
} from '../src/index.js';

import { audioProfileFixture, constant, projectSampleRateFixture, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();
const PROFILE = audioProfileFixture();

describe('целая граница амплитуды из `truePeakDb`', () => {
  it('−1.0 dBFS → 29204 (литерал; требование владельца — сверять с вычислением)', () => {
    // Литерал слева, вычисление справа: если реализация `Math.pow` когда-нибудь съедет,
    // покраснеет ЭТО равенство, а не поведение тракта на настоящем ролике.
    expect(peakLimitFromDb(-1.0)).toBe(29204);
    expect(peakLimitFromDb(-1.0)).toBe(Math.floor(Math.pow(10, -1 / 20) * FULL_SCALE));
  });

  it('порог фикстуры — тот же −1.0, и граница считается из него, а не из литерала', () => {
    expect(PROFILE.loudness.truePeakDb).toBe(-1.0);
    expect(peakLimitFromDb(PROFILE.loudness.truePeakDb)).toBe(29204);
  });

  it('−14 dBFS → 6538; полная шкала — 32768', () => {
    expect(peakLimitFromDb(-14)).toBe(6538);
    expect(FULL_SCALE).toBe(32768);
  });

  it('порог ≥ 0 dBFS ограничением не является и считается без float', () => {
    expect(peakLimitFromDb(0)).toBe(FULL_SCALE);
    expect(peakLimitFromDb(3)).toBe(FULL_SCALE);
  });

  it('ИЗМЕРЕНО: порог, чьё произведение ложится ТОЧНО на целое, отвергается', () => {
    // 20·log10(29204/32768). Произведение в double равно 29204 ровно, а истинная величина
    // отличается в неизвестную сторону — на другой реализации `pow` граница стала бы 29203.
    const treacherous = 20 * Math.log10(29204 / FULL_SCALE);
    expect(Math.pow(10, treacherous / 20) * FULL_SCALE).toBe(29204);
    expect(() => peakLimitFromDb(treacherous)).toThrow(AudioError);
  });

  it('нечисловой порог — отказ', () => {
    expect(() => peakLimitFromDb(Number.NaN)).toThrow(AudioError);
    expect(() => peakLimitFromDb(Number.NEGATIVE_INFINITY)).toThrow(AudioError);
  });
});

describe('измерение — целое и точное', () => {
  it('пик модуля, счёт сэмплов на краю шкалы, `lufs` отсутствует', () => {
    const report = measureLoudness(pcmS16(RATE, samplesOf([0, 100, -12345, 999, PCM_SAMPLE_MIN])));
    expect(report.samplePeak).toBe(32768);
    expect(report.fullScaleSamples).toBe(1);
    expect(report.lufs).toBeNull();
  });

  it('тишина даёт пик 0, а `dbFsOf(0)` — минус бесконечность, а не ошибку', () => {
    const report = measureLoudness(pcmS16(RATE, constant(16, 0)));
    expect(report.samplePeak).toBe(0);
    expect(report.fullScaleSamples).toBe(0);
    expect(dbFsOf(report.samplePeak)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('положительный край шкалы тоже считается краем', () => {
    expect(measureLoudness(pcmS16(RATE, samplesOf([PCM_SAMPLE_MAX, 1]))).fullScaleSamples).toBe(1);
  });
});

describe('сверка с профилем — отчёт, а не автонормализация', () => {
  it('дорожка под порогом: нарушений нет', () => {
    const check = checkLoudness(measureLoudness(pcmS16(RATE, constant(64, 29204))), PROFILE.loudness);
    expect(check.problems).toEqual([]);
    expect(check.peakLimit).toBe(29204);
  });

  it('на единицу выше порога — нарушение, и в нём видны обе величины', () => {
    const check = checkLoudness(measureLoudness(pcmS16(RATE, constant(64, 29205))), PROFILE.loudness);
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]).toContain('29205');
    expect(check.problems[0]).toContain('29204');
  });

  it('сэмплы на краю шкалы — отдельное нарушение (клиппинг уже случился)', () => {
    const check = checkLoudness(
      measureLoudness(pcmS16(RATE, samplesOf([PCM_SAMPLE_MAX, PCM_SAMPLE_MIN, 0]))),
      PROFILE.loudness,
    );
    expect(check.problems).toHaveLength(2);
    expect(check.problems.join(' ')).toContain('клиппинг');
  });

  it('громкость НЕ подкручивается: проверка возвращает список и ничего не возвращает сверх', () => {
    const source = pcmS16(RATE, constant(8, 32000));
    const before = [...source.samples];
    checkLoudness(measureLoudness(source), PROFILE.loudness);
    expect([...source.samples]).toEqual(before);
  });

  it('«что НЕ проверялось» лежит в самом результате, а не в комментарии рядом', () => {
    const check = checkLoudness(measureLoudness(pcmS16(RATE, constant(4, 1))), PROFILE.loudness);
    expect(check.notMeasured).toHaveLength(2);
    expect(check.notMeasured.join(' ')).toContain('targetLufs');
    expect(check.notMeasured.join(' ')).toContain('-14');
    expect(check.notMeasured.join(' ')).toContain('X-02');
    expect(check.notMeasured.join(' ')).toContain('true peak');
  });
});
