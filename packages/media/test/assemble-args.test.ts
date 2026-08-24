// `M-04` — аргументы вызова: голден-векторы и отказы. Ни одного подпроцесса.
//
// ПОЧЕМУ ГОЛДЕН НА МАССИВ ЦЕЛИКОМ, А НЕ `toContain` ПО ФЛАГАМ. Аргументы и есть то, что
// отделяет «профиль исполнен» от «ffmpeg что-то решил сам» (тот же приём, что у `resampleArgs`
// в `M-03`). Проверка вида «в аргументах есть `-g 30`» пропустила бы исчезновение
// `-sc_threshold 0`, а именно оно и есть риск SP-3d §4.3.

import { describe, expect, it } from 'vitest';

import {
  AssembleError,
  FORBIDDEN_CONCAT_ARGS,
  assertNoVideoEncodeArgs,
  concatListLine,
  concatListText,
  concatMuxArgs,
  framemd5Args,
  segmentEncodeArgs,
} from '../src/index.js';

import {
  RENDER_AC4_FILE,
  RENDER_FINAL_FILE,
  compileProfileFixture,
  renderProfileFixture,
  AUDIO_PROFILE_FILE,
} from './assemble-helpers.js';

import { AudioProfileSchema, readFamily, type AudioProfile } from '@vpe/schema';

const AC4 = renderProfileFixture(RENDER_AC4_FILE);
const FINAL = renderProfileFixture(RENDER_FINAL_FILE);
const COMPILE = compileProfileFixture();

function audioProfile(): AudioProfile {
  const { value } = readFamily(AUDIO_PROFILE_FILE, { expectFamily: 'audio-profile' });
  return AudioProfileSchema.parse(value);
}

const AUDIO = audioProfile();

describe('`M-04` — аргументы кодирования сегмента', () => {
  it('голден-вектор на профиле `ac4` фикстуры', () => {
    expect(
      segmentEncodeArgs({
        framePattern: '/tmp/f/%06d.png',
        startNumber: 1,
        frameCount: 90,
        fps: COMPILE.fps,
        pixelProfile: AC4.pixelProfile,
        outputPath: '/tmp/seg-000.mts',
      }),
    ).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      '30/1',
      '-start_number',
      '1',
      '-i',
      '/tmp/f/%06d.png',
      '-frames:v',
      '90',
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-threads',
      '1',
      '-rc-lookahead',
      '40',
      '-aq-mode',
      '1',
      '-psy',
      '1',
      '-g',
      '30',
      '-keyint_min',
      '30',
      '-sc_threshold',
      '0',
      '-x264-params',
      'open-gop=0',
      '-fps_mode',
      'cfr',
      '-pix_fmt',
      'yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-f',
      'mpegts',
      '/tmp/seg-000.mts',
    ]);
  });

  it('`tune: none` в командную строку НЕ уезжает', () => {
    // `FACT` (`M-04`): `-tune none` — ошибка x264 (`invalid tune 'none'`). Буквальная
    // подстановка поля не собрала бы ни одного сегмента ни на одном из трёх профилей.
    expect(AC4.pixelProfile.encoder.tune).toBe('none');
    const args = segmentEncodeArgs({
      framePattern: '/tmp/f/%06d.png',
      startNumber: 1,
      frameCount: 1,
      fps: COMPILE.fps,
      pixelProfile: AC4.pixelProfile,
      outputPath: '/tmp/a.mts',
    });
    expect(args).not.toContain('-tune');
  });

  it('`tune` с настоящим значением уезжает', () => {
    const args = segmentEncodeArgs({
      framePattern: '/tmp/f/%06d.png',
      startNumber: 1,
      frameCount: 1,
      fps: COMPILE.fps,
      pixelProfile: { ...AC4.pixelProfile, encoder: { ...AC4.pixelProfile.encoder, tune: 'film' } },
      outputPath: '/tmp/a.mts',
    });
    expect(args[args.indexOf('-tune') + 1]).toBe('film');
  });

  it('`-sc_threshold 0` стоит на КАЖДОМ из трёх профилей фикстуры', () => {
    // Риск SP-3d §4.3 не зависит от профиля: он про энкодер, а не про качество.
    for (const profile of [AC4, FINAL]) {
      const args = segmentEncodeArgs({
        framePattern: `/tmp/f/%06d${profile.pixelProfile.imageFormat === 'png' ? '.png' : '.jpg'}`,
        startNumber: 1,
        frameCount: 1,
        fps: COMPILE.fps,
        pixelProfile: profile.pixelProfile,
        outputPath: '/tmp/a.mts',
      });
      expect(args[args.indexOf('-sc_threshold') + 1]).toBe('0');
      expect(args[args.indexOf('-g') + 1]).toBe(String(profile.pixelProfile.gopSize));
      expect(args).toContain('-an');
    }
  });

  it('`fps` берётся дробью, а не числом', () => {
    const args = segmentEncodeArgs({
      framePattern: '/tmp/f/%06d.png',
      startNumber: 1,
      frameCount: 1,
      fps: { num: 30000, den: 1001 },
      pixelProfile: AC4.pixelProfile,
      outputPath: '/tmp/a.mts',
    });
    expect(args[args.indexOf('-framerate') + 1]).toBe('30000/1001');
  });

  it('шаблон кадра обязан соответствовать `imageFormat`', () => {
    // Без этой проверки `imageFormat` и `jpegQuality` не исполняет никто: ffmpeg определяет
    // формат по содержимому и съел бы PNG при `imageFormat: jpeg` молча.
    expect(FINAL.pixelProfile.imageFormat).toBe('jpeg');
    expect(() =>
      segmentEncodeArgs({
        framePattern: '/tmp/f/%06d.png',
        startNumber: 1,
        frameCount: 1,
        fps: COMPILE.fps,
        pixelProfile: FINAL.pixelProfile,
        outputPath: '/tmp/a.mts',
      }),
    ).toThrow(AssembleError);
  });

  it('шаблон без счётчика — отказ', () => {
    expect(() =>
      segmentEncodeArgs({
        framePattern: '/tmp/f/frame.png',
        startNumber: 1,
        frameCount: 1,
        fps: COMPILE.fps,
        pixelProfile: AC4.pixelProfile,
        outputPath: '/tmp/a.mts',
      }),
    ).toThrow(/счётчик/);
  });

  it('выход не `.mts` — отказ', () => {
    expect(() =>
      segmentEncodeArgs({
        framePattern: '/tmp/f/%06d.png',
        startNumber: 1,
        frameCount: 1,
        fps: COMPILE.fps,
        pixelProfile: AC4.pixelProfile,
        outputPath: '/tmp/a.mp4',
      }),
    ).toThrow(/h264-ts/);
  });

  it('незнакомый кодек — отказ, а не подстановка в `-c:v`', () => {
    expect(() =>
      segmentEncodeArgs({
        framePattern: '/tmp/f/%06d.png',
        startNumber: 1,
        frameCount: 1,
        fps: COMPILE.fps,
        pixelProfile: { ...AC4.pixelProfile, codec: 'hevc' },
        outputPath: '/tmp/a.mts',
      }),
    ).toThrow(/hevc/);
  });
});

describe('`M-04` — аргументы конката и мукса (**R10**)', () => {
  const options = {
    listPath: '/tmp/list.txt',
    audioPath: '/tmp/track.wav',
    audioProfile: AUDIO,
    outputPath: '/tmp/final.mp4',
  };

  it('голден-вектор на `audio-profile/1` фикстуры', () => {
    expect(concatMuxArgs(options)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/tmp/list.txt',
      '-i',
      '/tmp/track.wav',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-af',
      'aresample=resampler=soxr:precision=28:out_sample_rate=48000',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-fflags',
      '+bitexact',
      '-f',
      'mp4',
      '/tmp/final.mp4',
    ]);
  });

  it('в аргументах конката нет НИ ОДНОГО флага энкода видео', () => {
    const args = concatMuxArgs(options);
    for (const forbidden of FORBIDDEN_CONCAT_ARGS) {
      expect(args, `флаг ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('`-movflags +faststart` не ставится (решение владельца, вопрос 4c)', () => {
    expect(concatMuxArgs(options)).not.toContain('-movflags');
  });

  it('денай-лист падает на подсунутом флаге энкода', () => {
    expect(() => assertNoVideoEncodeArgs(['-c:v', 'copy', '-crf', '18'])).toThrow(/-crf/);
    expect(() => assertNoVideoEncodeArgs(['-c:v', 'copy', '-vf', 'scale=2'])).toThrow(/-vf/);
  });

  it('денай-лист падает, если `-c:v copy` вообще нет', () => {
    expect(() => assertNoVideoEncodeArgs(['-map', '0:v:0'])).toThrow(/нет `-c:v copy`/);
    expect(() => assertNoVideoEncodeArgs(['-c:v', 'libx264'])).toThrow(/нет `-c:v copy`/);
  });

  it('параметры ресемплера входят в вызов ЯВНО (решение владельца, вопрос 4b)', () => {
    // Тракт живёт на 24000, доставка — на 48000: ресемплинг при муксе существует, и его
    // параметры обязаны быть в командной строке, а не на умолчании версии ffmpeg.
    expect(AUDIO.deliverySampleRate).not.toBe(COMPILE.projectSampleRate);
    const args = concatMuxArgs(options);
    const filter = args[args.indexOf('-af') + 1] ?? '';
    expect(filter).toContain(`resampler=${AUDIO.resampler.engine}`);
    expect(filter).toContain(`precision=${String(AUDIO.resampler.precision)}`);
    expect(filter).toContain(`out_sample_rate=${String(AUDIO.deliverySampleRate)}`);
  });

  it('незнакомый ресемплер и незнакомый аудио-кодек — отказ', () => {
    expect(() =>
      concatMuxArgs({
        ...options,
        audioProfile: { ...AUDIO, resampler: { engine: 'swr', precision: 28 } },
      }),
    ).toThrow(/swr/);
    expect(() => concatMuxArgs({ ...options, audioProfile: { ...AUDIO, codec: 'opus' } })).toThrow(
      /opus/,
    );
  });

  it('выход не `.mp4` — отказ', () => {
    expect(() => concatMuxArgs({ ...options, outputPath: '/tmp/final.mkv' })).toThrow(/\.mp4/);
  });
});

describe('`M-04` — файл-список демуксера', () => {
  it('строка — в форме `file \'…\'`', () => {
    expect(concatListLine('/tmp/a.mts')).toBe("file '/tmp/a.mts'");
  });

  it('кавычка в пути экранируется по правилу демуксера', () => {
    // `tmpDir` приходит входом, и его имя нам не принадлежит.
    expect(concatListLine("/tmp/it's/a.mts")).toBe("file '/tmp/it'\\''s/a.mts'");
  });

  it('список — по строке на сегмент, с завершающим переводом строки', () => {
    expect(concatListText(['/a.mts', '/b.mts'])).toBe("file '/a.mts'\nfile '/b.mts'\n");
  });

  it('пустой список — отказ', () => {
    expect(() => concatListText([])).toThrow(AssembleError);
  });

  it('файл не `.mts` в списке — отказ', () => {
    expect(() => concatListText(['/a.mp4'])).toThrow(/h264-ts|\.mts/);
  });
});

describe('`M-04` — `framemd5` под флагом', () => {
  it('в аргументах НЕТ `-c copy`: считаются декодированные кадры', () => {
    // `FACT` (`M-04`): с `-c copy` framemd5 считает хэши ПАКЕТОВ и стоит копейки — то есть
    // проверяет не то, ради чего заведён (ADR-0006 §14: «md5 каждого ДЕКОДИРОВАННОГО кадра»).
    const args = framemd5Args('/tmp/x.mp4');
    expect(args).not.toContain('copy');
    expect(args).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-i',
      '/tmp/x.mp4',
      '-map',
      '0:v:0',
      '-f',
      'framemd5',
      '-',
    ]);
  });
});
