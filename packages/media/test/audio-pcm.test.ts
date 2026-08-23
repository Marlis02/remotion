// `M-03` — внутренний формат тракта: s16le, моно, `projectSampleRate`.

import { describe, expect, it } from 'vitest';

import {
  AudioError,
  PCM_BITS_PER_SAMPLE,
  PCM_BYTES_PER_SAMPLE,
  PCM_CHANNELS,
  PCM_SAMPLE_MAX,
  PCM_SAMPLE_MIN,
  assertProjectRate,
  bytesFromPcm,
  pcmFromBytes,
  pcmS16,
  silence,
} from '../src/index.js';

import { projectSampleRateFixture, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();

describe('формат тракта — константы', () => {
  it('моно, 16 бит, два байта на сэмпл, шкала асимметрична', () => {
    expect(PCM_CHANNELS).toBe(1);
    expect(PCM_BITS_PER_SAMPLE).toBe(16);
    expect(PCM_BYTES_PER_SAMPLE).toBe(2);
    expect(PCM_SAMPLE_MIN).toBe(-32768);
    expect(PCM_SAMPLE_MAX).toBe(32767);
  });

  it('`projectSampleRate` фикстуры — 24000 (`fixtures/minimal/profiles/compile.yaml`)', () => {
    expect(RATE).toBe(24000);
  });
});

describe('конструктор дорожки', () => {
  it('строит дорожку и проставляет один канал', () => {
    const pcm = pcmS16(RATE, samplesOf([1, -1, 0]));
    expect(pcm.sampleRate).toBe(RATE);
    expect(pcm.channels).toBe(1);
    expect([...pcm.samples]).toEqual([1, -1, 0]);
  });

  it.each([0, -24000, 24000.5, Number.NaN])('отвергает `sampleRate` = %s', (rate) => {
    expect(() => pcmS16(rate, new Int16Array(0))).toThrow();
  });

  it('`silence` даёт нули нужной длины и отвергает отрицательную длину', () => {
    expect([...silence(RATE, 3).samples]).toEqual([0, 0, 0]);
    expect(() => silence(RATE, -1)).toThrow(AudioError);
  });
});

describe('`assertProjectRate` — граница «ресемплинг только на ingest»', () => {
  it('пропускает дорожку своей частоты', () => {
    expect(() => assertProjectRate(pcmS16(RATE, new Int16Array(1)), RATE, 'где')).not.toThrow();
  });

  it('отвергает чужую частоту и называет правило, а не следствие', () => {
    const alien = pcmS16(44100, new Int16Array(1));
    let error: unknown;
    try {
      assertProjectRate(alien, RATE, 'дорожка теста');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('ADR-0003 «Разделение sampleRate»');
    expect((error as AudioError).message).toContain('44100');
    expect((error as AudioError).message).toContain('ingest');
  });
});

describe('порядок байтов выписан руками — little-endian всегда', () => {
  it('байты → сэмплы: границы шкалы и единица читаются точными числами', () => {
    const bytes = Uint8Array.from([0x01, 0x00, 0x00, 0x80, 0xff, 0x7f, 0xff, 0xff]);
    expect([...pcmFromBytes(RATE, bytes).samples]).toEqual([1, -32768, 32767, -1]);
  });

  it('сэмплы → байты: обратное преобразование побайтово', () => {
    const pcm = pcmS16(RATE, samplesOf([1, -32768, 32767, -1]));
    expect([...bytesFromPcm(pcm)]).toEqual([0x01, 0x00, 0x00, 0x80, 0xff, 0x7f, 0xff, 0xff]);
  });

  it('round-trip на всей шкале: байты → сэмплы → байты равны исходным', () => {
    const bytes = new Uint8Array(0x10000 * 2);
    for (let i = 0; i < 0x10000; i += 1) {
      bytes[i * 2] = i & 0xff;
      bytes[i * 2 + 1] = (i >> 8) & 0xff;
    }
    expect([...bytesFromPcm(pcmFromBytes(RATE, bytes))]).toEqual([...bytes]);
  });

  it('учитывает `byteOffset`: окно в чужой буфер читается со своего места', () => {
    const whole = Uint8Array.from([0xaa, 0xbb, 0x01, 0x00, 0x02, 0x00]);
    expect([...pcmFromBytes(RATE, whole.subarray(2)).samples]).toEqual([1, 2]);
  });

  it('нечётная длина потока — отказ с названным правилом', () => {
    expect(() => pcmFromBytes(RATE, Uint8Array.from([0x01, 0x00, 0x02]))).toThrow(AudioError);
  });
});
