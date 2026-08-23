// **V6** — «внутри пайплайна нет mp3 ни на одном шаге»: детектор и его ИЗМЕРЕННЫЙ предел.

import { describe, expect, it } from 'vitest';

import {
  AudioError,
  WAVE_FORMAT_MPEG,
  WAVE_FORMAT_MPEGLAYER3,
  assertNotMp3,
  bytesFromPcm,
  isMp3Bytes,
  mp3WaveFormatName,
  pcmS16,
} from '../src/index.js';

import { projectSampleRateFixture, samplesOf } from './audio-helpers.js';

const RATE = projectSampleRateFixture();

describe('детектор узнаёт файл', () => {
  it('тег `ID3v2` в начале файла', () => {
    expect(isMp3Bytes(Uint8Array.from([0x49, 0x44, 0x33, 0x03, 0x00]))).toBe(true);
  });

  it('заголовок кадра MPEG-1 Layer III (`FF FB`)', () => {
    expect(isMp3Bytes(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
  });

  it('заголовок кадра MPEG-2.5 Layer III (`FF E3`)', () => {
    expect(isMp3Bytes(Uint8Array.from([0xff, 0xe3, 0x40, 0x00]))).toBe(true);
  });
});

describe('детектор НЕ путает mp3 с законным соседом', () => {
  // AAC в пайплайне законен: им кодируется финал при муксе (`audioProfile.codec: aac`).
  // Отличие — поле «слой»: у ADTS оно равно зарезервированному `0b00`.
  it.each([
    ['ADTS AAC без CRC (`FF F1`)', [0xff, 0xf1, 0x50, 0x80]],
    ['ADTS AAC с CRC (`FF F9`)', [0xff, 0xf9, 0x50, 0x80]],
    ['RIFF/WAVE', [0x52, 0x49, 0x46, 0x46]],
    ['зарезервированная версия MPEG (`FF EB`)', [0xff, 0xeb, 0x90, 0x00]],
    ['запрещённый индекс битрейта (`FF FB F0`)', [0xff, 0xfb, 0xf0, 0x00]],
    ['зарезервированная частота (`FF FB 0C`)', [0xff, 0xfb, 0x0c, 0x00]],
    ['слишком короткий вход', [0xff, 0xfb]],
    ['`ID3` без байта версии', [0x49, 0x44, 0x33]],
  ])('%s — не mp3', (_title, bytes) => {
    expect(isMp3Bytes(Uint8Array.from(bytes))).toBe(false);
  });
});

describe('охранник называет правило', () => {
  it('`assertNotMp3` бросает `AudioError` с правилом V6 и адресом байтов', () => {
    let error: unknown;
    try {
      assertNotMp3(Uint8Array.from([0x49, 0x44, 0x33, 0x04]), 'assets/music/bed.file');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).rule).toBe('ADR-0010 §9 (V6)');
    expect((error as AudioError).message).toContain('assets/music/bed.file');
  });

  it('на не-mp3 молчит', () => {
    expect(() => assertNotMp3(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), 'x')).not.toThrow();
  });
});

describe('mp3 внутри RIFF — вторая половина правила', () => {
  it('теги MPEG-форматов узнаются по имени, а не по числу у вызывающего', () => {
    expect(WAVE_FORMAT_MPEGLAYER3).toBe(0x0055);
    expect(WAVE_FORMAT_MPEG).toBe(0x0050);
    expect(mp3WaveFormatName(WAVE_FORMAT_MPEGLAYER3)).toContain('mp3');
    expect(mp3WaveFormatName(WAVE_FORMAT_MPEG)).toContain('MPEG');
    expect(mp3WaveFormatName(0x0001)).toBeNull();
    expect(mp3WaveFormatName(0xfffe)).toBeNull();
  });
});

describe('ИЗМЕРЕННЫЙ ПРЕДЕЛ: детектор нельзя применять к сырому PCM', () => {
  // Это не отрицательный тест, а зафиксированное свойство: синхрослово кадра — одиннадцать
  // единиц подряд, и два соседних сэмпла громкой речи дают ровно такие байты. Отсюда
  // правило вызова: `assertNotMp3` стоит на границах, где байты являются ФАЙЛОМ, и не
  // стоит на полезной нагрузке. Тест покраснеет, если кто-нибудь решит «усилить» охранник,
  // повесив его на поток PCM, — и покраснеет он ровно там, где ложное срабатывание.
  it('сэмпл −1281 в s16le даёт байты `FF FA` — «валидный» заголовок кадра', () => {
    const loud = pcmS16(RATE, samplesOf([-1281, 0x1234]));
    const bytes = bytesFromPcm(loud);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfa]);
    expect(isMp3Bytes(bytes)).toBe(true);
  });
});
