// `M-03` — ресемплинг на ingest: аргументы, сборка ffmpeg, детерминизм, граница V6.
//
// ffmpeg ОБЯЗАТЕЛЕН (решение владельца, вопрос 9). Тихого `skip` здесь нет ни одного: тест,
// который молча пропускает себя на машине без инструмента, — это и есть ложно-зелёный.
// Требование названо отдельным тестом, чтобы его провал читался с первой строки.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AudioProfile } from '@vpe/schema';

import {
  AudioError,
  FfmpegError,
  ingestMusic,
  parseFfmpegBuild,
  pcmS16,
  readFfmpegBuild,
  resampleArgs,
  writeWavFile,
} from '../src/index.js';

import { audioProfileFixture, projectSampleRateFixture } from './audio-helpers.js';

const RATE = projectSampleRateFixture();
const PROFILE = audioProfileFixture();
const SOURCE_RATE = 44100;
const FFMPEG_TIMEOUT = 30_000;

let DIR = '';
let SOURCE = '';

/** Треугольник целочисленный: детерминированный сигнал без `Math.sin` и без бинарника. */
function triangle(length: number, period: number, amplitude: number): Int16Array {
  const out = new Int16Array(length);
  const half = period / 2;
  for (let i = 0; i < length; i += 1) {
    const phase = i % period;
    const up = phase < half ? phase : period - phase;
    out[i] = Math.round((up * amplitude) / half) - amplitude / 2;
  }
  return out;
}

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), 'vpe-m03-resample-'));
  SOURCE = path.join(DIR, 'source-44100.wav');
  await writeWavFile(SOURCE, pcmS16(SOURCE_RATE, triangle(SOURCE_RATE, 100, 20000)));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('аргументы вызова — параметры профиля входят ЯВНО', () => {
  it('golden: вектор аргументов целиком', () => {
    expect(resampleArgs({ inputPath: '/in.wav', resampler: PROFILE.resampler, projectSampleRate: RATE })).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-i',
      '/in.wav',
      '-vn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags',
      '+bitexact',
      '-af',
      'aresample=resampler=soxr:precision=28:out_sample_rate=24000',
      '-ac',
      '1',
      '-f',
      's16le',
      '-',
    ]);
  });

  it('значения берутся из профиля, а не из литералов кода', () => {
    const other: AudioProfile['resampler'] = { engine: 'soxr', precision: 20 };
    const args = resampleArgs({ inputPath: '/in.wav', resampler: other, projectSampleRate: 48000 });
    expect(args).toContain('aresample=resampler=soxr:precision=20:out_sample_rate=48000');
  });

  it('незнакомый движок — отказ, а не тихая подстановка умолчания ffmpeg', () => {
    let error: unknown;
    try {
      resampleArgs({
        inputPath: '/in.wav',
        resampler: { engine: 'swr', precision: 28 },
        projectSampleRate: RATE,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioError);
    expect((error as AudioError).message).toContain('swr');
  });
});

describe('разбор `ffmpeg -version` — чистая функция', () => {
  it('версия и `configuration:` читаются, `libsoxr` виден', () => {
    const build = parseFfmpegBuild(
      'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023\n' +
        '  configuration: --prefix=/usr --enable-libsoxr --enable-gpl\n' +
        '  libavutil 58. 29.100\n',
    );
    expect(build.version).toBe('6.1.1-3ubuntu5');
    expect(build.configuration).toContain('--enable-libsoxr');
    expect(build.hasSoxr).toBe(true);
  });

  it('сборка без libsoxr узнаётся', () => {
    expect(parseFfmpegBuild('ffmpeg version 7.0 X\nconfiguration: --enable-gpl\n').hasSoxr).toBe(false);
  });

  it('нечитаемый вывод не превращается в оптимистичное допущение', () => {
    const build = parseFfmpegBuild('какой-то другой инструмент\n');
    expect(build.version).toBe('');
    expect(build.hasSoxr).toBe(false);
  });
});

describe('ffmpeg — обязательный инструмент задачи', () => {
  it(
    'в окружении есть ffmpeg, собранный с `--enable-libsoxr`',
    async () => {
      const build = await readFfmpegBuild();
      expect(
        build.version,
        '`M-03` (ресемплинг) и `M-04` (мукс) построены на ffmpeg — установите его.',
      ).not.toBe('');
      expect(
        build.hasSoxr,
        `ffmpeg ${build.version} собран без libsoxr, а профиль требует \`engine: soxr\`. ` +
          'Такой ffmpeg не откажет — он молча возьмёт свой ресемплер, то есть отдаст другой звук.',
      ).toBe(true);
    },
    FFMPEG_TIMEOUT,
  );

  it(
    'отсутствующий бинарник — отказ с лечащим сообщением, а не молчание',
    async () => {
      const failing = ingestMusic({
        inputPath: SOURCE,
        audioProfile: PROFILE,
        projectSampleRate: RATE,
        ffmpegPath: path.join(DIR, 'ffmpeg-которого-нет'),
      });
      await expect(failing).rejects.toThrow(FfmpegError);
      await expect(failing).rejects.toThrow(/не найден/);
    },
    FFMPEG_TIMEOUT,
  );
});

describe('ingest: ресемплинг ровно один раз, на входе в тракт', () => {
  it(
    '44100 → 24000: дорожка выходит на частоте проекта и не пуста',
    async () => {
      const result = await ingestMusic({ inputPath: SOURCE, audioProfile: PROFILE, projectSampleRate: RATE });
      expect(result.pcm.sampleRate).toBe(RATE);
      expect(result.pcm.channels).toBe(1);
      // Секунда входа даёт секунду выхода; допуск — хвост фильтра ресемплера.
      expect(result.pcm.samples.length).toBeGreaterThan(RATE - 100);
      expect(result.pcm.samples.length).toBeLessThan(RATE + 100);
      expect(result.ffmpeg.hasSoxr).toBe(true);
      expect(result.args).toContain('aresample=resampler=soxr:precision=28:out_sample_rate=24000');
    },
    FFMPEG_TIMEOUT,
  );

  it(
    'детерминизм: два прогона одной версии дают побайтово равный выход',
    async () => {
      const options = { inputPath: SOURCE, audioProfile: PROFILE, projectSampleRate: RATE };
      const first = await ingestMusic(options);
      const second = await ingestMusic(options);
      expect([...second.pcm.samples]).toEqual([...first.pcm.samples]);
    },
    FFMPEG_TIMEOUT,
  );

  it(
    'ИЗМЕРЕНО: `precision` из профиля действительно входит в вызов — выход другой',
    async () => {
      const exact = await ingestMusic({ inputPath: SOURCE, audioProfile: PROFILE, projectSampleRate: RATE });
      const coarse = await ingestMusic({
        inputPath: SOURCE,
        audioProfile: { ...PROFILE, resampler: { ...PROFILE.resampler, precision: 20 } },
        projectSampleRate: RATE,
      });
      expect([...coarse.pcm.samples]).not.toEqual([...exact.pcm.samples]);
    },
    FFMPEG_TIMEOUT,
  );

  it(
    'вход mp3 отвергается ДО запуска ffmpeg — охранник V6 на входе тракта',
    async () => {
      const fake = path.join(DIR, 'bed.file');
      writeFileSync(fake, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]));
      const failing = ingestMusic({ inputPath: fake, audioProfile: PROFILE, projectSampleRate: RATE });
      await expect(failing).rejects.toBeInstanceOf(AudioError);
      await expect(failing).rejects.toThrow(/V6/);
    },
    FFMPEG_TIMEOUT,
  );
});
