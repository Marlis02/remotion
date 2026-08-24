// Совместимость выхода `tts:mock@1` с PCM-трактом `M-03` — БЕЗ переупаковки.
//
// Критерий задания звучит буквально: «PCM mock'а проходит в `mixSaturating`/`writeWavFile`
// M-03 без переупаковки». Проверяется именно это: значение, вышедшее из `synthPcm`, идёт в
// функции тракта тем же объектом, без конверсий, копий и смены типа. Если завтра mock начнёт
// отдавать `Buffer` или другую частоту, красным станет здесь, а не на сборке ролика.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PCM_BYTES_PER_SAMPLE,
  PCM_CHANNELS,
  applyEdgeFade,
  assertProjectRate,
  bytesFromPcm,
  decodeWav,
  encodeWav,
  mixSaturating,
  readWavFile,
  silence,
  writeWavFile,
} from '@vpe/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MOCK_SAMPLE_RATE, synthPcm } from '../src/index.js';

import { fixtureProjectSampleRate } from './fixture.js';

const TXT = 'Dr. Smith arrived, and the tide turned.';
const RATE = fixtureProjectSampleRate();

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpe-v01-'));
});

afterAll(() => {
  if (tmpDir !== '') fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('выход mock\'а — это дорожка тракта `M-03`', () => {
  it('тип и геометрия совпадают с внутренним форматом тракта', () => {
    const { pcm } = synthPcm(TXT, 1);
    expect(pcm.channels).toBe(PCM_CHANNELS);
    expect(pcm.samples).toBeInstanceOf(Int16Array);
    expect(pcm.sampleRate).toBe(MOCK_SAMPLE_RATE);
    expect(bytesFromPcm(pcm).length).toBe(pcm.samples.length * PCM_BYTES_PER_SAMPLE);
  });

  it('частота дорожки принимается трактом на `projectSampleRate` фикстуры', () => {
    const { pcm } = synthPcm(TXT, 1);
    expect(() => assertProjectRate(pcm, RATE, 'дубль `tts:mock@1`')).not.toThrow();
  });

  it('`mixSaturating` берёт дорожку как есть — ни одной конверсии по дороге', () => {
    const { pcm } = synthPcm(TXT, 1);
    const pad = silence(RATE, 4320); // defaultParagraphGapSamples фикстуры
    const result = mixSaturating([pcm, pad], RATE);
    expect(result.mixed.sampleRate).toBe(RATE);
    expect(result.mixed.samples.length).toBe(Math.max(pcm.samples.length, pad.samples.length));
    expect(result.inputLengths).toEqual([pcm.samples.length, pad.samples.length]);
    // Сумма с тишиной обязана быть исходной дорожкой сэмпл в сэмпл.
    expect(result.mixed.samples.subarray(0, pcm.samples.length)).toEqual(pcm.samples);
    expect(result.clippedSamples).toBe(0);
  });

  it('`applyEdgeFade` работает на дорожке mock\'а и длины не меняет', () => {
    const { pcm } = synthPcm(TXT, 1);
    const faded = applyEdgeFade(pcm, 72); // crossfadeSamples фикстуры = msToSamples(3, 24000)
    expect(faded.samples.length).toBe(pcm.samples.length);
    expect(faded.sampleRate).toBe(pcm.sampleRate);
  });

  it('WAV round-trip: `encodeWav` → `decodeWav` побайтово возвращает ту же дорожку', () => {
    const { pcm } = synthPcm(TXT, 1);
    const decoded = decodeWav(encodeWav(pcm), 'дубль `tts:mock@1`');
    expect(decoded.sampleRate).toBe(pcm.sampleRate);
    expect(decoded.samples).toEqual(pcm.samples);
  });

  it('`writeWavFile`/`readWavFile` принимают дорожку без переупаковки', async () => {
    const { pcm } = synthPcm(TXT, 1);
    const file = path.join(tmpDir, 'take.wav');
    await writeWavFile(file, pcm);
    const back = await readWavFile(file);
    expect(back.sampleRate).toBe(pcm.sampleRate);
    expect(back.samples).toEqual(pcm.samples);
  });

  it('дорожка синтезирована, а не тишина: тест не зелен на пустом входе', () => {
    const { pcm } = synthPcm(TXT, 1);
    let peak = 0;
    for (const sample of pcm.samples) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeGreaterThan(0);
    // Амплитуда профиля 0.22 от полной шкалы ⇒ пик заведомо ниже насыщения.
    expect(peak).toBeLessThan(32767);
  });
});
