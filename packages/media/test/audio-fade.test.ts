// `M-03` — микрофейд: длина из профиля, правило округления, границы интервала.

import { msToSamples } from '@vpe/core-model';
import { describe, expect, it } from 'vitest';

import { AudioError, applyEdgeFade, pcmS16, scaleSample } from '../src/index.js';

import { audioProfileFixture, constant, projectSampleRateFixture, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();
const PROFILE = audioProfileFixture();

describe('длина микрофейда живёт в профиле, а не в коде', () => {
  it('`crossfadeSamples` фикстуры равен `msToSamples(3, projectSampleRate)`', () => {
    // Не «72 == 72»: правая часть считается той же функцией, которой считает движок (T1).
    expect(PROFILE.crossfadeSamples).toBe(msToSamples(3, RATE));
  });

  it('и это 72 сэмпла при 24 кГц — величина из ADR-0003 T7', () => {
    expect(PROFILE.crossfadeSamples).toBe(72);
  });
});

describe('правило округления — к ближайшему, ничьи от нуля', () => {
  it('точные значения на ничьей: 0.5 уходит ОТ нуля в обе стороны', () => {
    expect(scaleSample(1, 1, 2)).toBe(1);
    expect(scaleSample(-1, 1, 2)).toBe(-1);
    expect(scaleSample(3, 1, 2)).toBe(2);
    expect(scaleSample(-3, 1, 2)).toBe(-2);
  });

  it('симметрично по знаку — иначе фейд вносил бы постоянную составляющую (T7)', () => {
    for (const value of [1, 7, 999, 12345, 32767]) {
      for (const i of [0, 1, 5, 71]) {
        expect(scaleSample(-value, i, 72)).toBe(-scaleSample(value, i, 72));
      }
    }
  });

  it('усиление 0 гасит в ноль, усиление 1 не меняет ничего', () => {
    expect(scaleSample(12345, 0, 72)).toBe(0);
    expect(scaleSample(12345, 72, 72)).toBe(12345);
    expect(scaleSample(-32768, 72, 72)).toBe(-32768);
  });

  it('отвергает нулевой и отрицательный знаменатель', () => {
    expect(() => scaleSample(1, 1, 0)).toThrow(AudioError);
    expect(() => scaleSample(1, 1, -2)).toThrow(AudioError);
  });
});

describe('рампа — первый, последний и середина точными числами', () => {
  const FADE = 4;
  const faded = applyEdgeFade(pcmS16(RATE, constant(16, 1000)), FADE);

  it('вход: `g_i = i/N`, нулевой сэмпл гасится ровно в ноль', () => {
    expect([...faded.samples.subarray(0, 5)]).toEqual([0, 250, 500, 750, 1000]);
  });

  it('выход: зеркально, последний сэмпл гасится ровно в ноль', () => {
    expect([...faded.samples.subarray(11, 16)]).toEqual([1000, 750, 500, 250, 0]);
  });

  it('середина интервала не тронута', () => {
    expect([...faded.samples.subarray(4, 12)]).toEqual(new Array<number>(8).fill(1000));
  });

  it('длина дорожки не изменилась — фейд живёт ВНУТРИ интервала (T7)', () => {
    expect(faded.samples.length).toBe(16);
    expect(faded.sampleRate).toBe(RATE);
  });

  it('на настоящей длине профиля (72) края тоже точные', () => {
    const long = applyEdgeFade(pcmS16(RATE, constant(200, 3600)), PROFILE.crossfadeSamples);
    expect(long.samples[0]).toBe(0);
    expect(long.samples[1]).toBe(50); // 3600 · 1/72
    expect(long.samples[36]).toBe(1800); // 3600 · 36/72
    expect(long.samples[71]).toBe(3550); // 3600 · 71/72 = 3550.0
    expect(long.samples[72]).toBe(3600);
    expect(long.samples[199]).toBe(0);
    expect(long.samples[198]).toBe(50);
    expect(long.samples.length).toBe(200);
  });
});

describe('границы применимости', () => {
  it('интервал ровно в два фейда — законен, середины просто нет', () => {
    const exact = applyEdgeFade(pcmS16(RATE, constant(8, 800)), 4);
    expect([...exact.samples]).toEqual([0, 200, 400, 600, 600, 400, 200, 0]);
  });

  it('интервал короче двух фейдов — ОТКАЗ, а не тихое усечение длины фейда', () => {
    let error: unknown;
    try {
      applyEdgeFade(pcmS16(RATE, constant(7, 800)), 4);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('ADR-0003 T7');
    expect((error as AudioError).message).toContain('7');
  });

  it('`crossfadeSamples = 0` — законное значение схемы: дорожка возвращается как есть', () => {
    const source = pcmS16(RATE, samplesOf([1, 2, 3]));
    const same = applyEdgeFade(source, 0);
    expect([...same.samples]).toEqual([1, 2, 3]);
    expect(same.samples).not.toBe(source.samples);
  });

  it('отрицательная длина фейда — отказ', () => {
    expect(() => applyEdgeFade(pcmS16(RATE, constant(8, 1)), -1)).toThrow(AudioError);
  });

  it('исходная дорожка не изменяется — операция возвращает значение', () => {
    const source = pcmS16(RATE, constant(8, 800));
    applyEdgeFade(source, 4);
    expect([...source.samples]).toEqual(new Array<number>(8).fill(800));
  });
});
