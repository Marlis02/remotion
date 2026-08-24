// `M-04` — прибор: разбор вывода ffprobe (чистые функции) и обязательность бинарников.
//
// РАЗБОР ПРОВЕРЯЕТСЯ БЕЗ ПОДПРОЦЕССА. Вход — текст, который ffprobe действительно печатает
// (сокращён до читаемых полей; форма и имена сохранены дословно). Так проверяются ветки,
// которые на живом файле не воспроизвести: поток без `profile`, два видео-потока, битый JSON.
//
// ffmpeg И ffprobe ОБЯЗАТЕЛЬНЫ. Решение владельца `M-03` (вопрос 9) действует и здесь:
// тихого `skip` нет ни одного, отсутствие бинарника — падение с лечащим сообщением.

import { describe, expect, it } from 'vitest';

import {
  AssembleError,
  FINGERPRINT_FIELDS,
  assertClosedGop,
  assertSameEncoderSignature,
  FfprobeError,
  countPacketsArgs,
  extractEncoderSignature,
  framesForSamples,
  parseFrameCount,
  parseHasAudio,
  parseKeyframeIndices,
  parseStreams,
  parseVideoFingerprint,
  readFfmpegBuild,
  runFfprobe,
  showPacketFlagsArgs,
  showStreamsArgs,
} from '../src/index.js';

import { timeGrid } from '@vpe/core-model';

/** Вывод `-show_streams` на настоящем `.mts` (поля сокращены, имена и форма — как у ffprobe). */
const MTS_STREAMS = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      profile: 'High',
      codec_type: 'video',
      width: 320,
      height: 240,
      pix_fmt: 'yuv420p',
      level: 13,
      color_range: 'tv',
      color_space: 'bt709',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      time_base: '1/90000',
    },
  ],
});

/** Тот же файл после мукса: добавилась дорожка aac. */
const MP4_STREAMS = JSON.stringify({
  streams: [
    JSON.parse(MTS_STREAMS).streams[0],
    { index: 1, codec_name: 'aac', codec_type: 'audio', sample_rate: '48000', channels: 1 },
  ],
});

describe('`M-04` — разбор `-show_streams`', () => {
  it('отпечаток собирается из десяти полей и ни из чего больше', () => {
    const fingerprint = parseVideoFingerprint(MTS_STREAMS, 'зонд');
    expect(Object.keys(fingerprint).sort()).toEqual([...FINGERPRINT_FIELDS].sort());
    expect(fingerprint).toEqual({
      codec: 'h264',
      profile: 'High',
      level: '13',
      pixFmt: 'yuv420p',
      colorSpace: 'bt709',
      timeBase: '1/90000',
      width: 320,
      height: 240,
      fpsNum: 30,
      fpsDen: 1,
    });
  });

  it('`color_range` в отпечаток НЕ входит, хотя ffprobe его показывает', () => {
    // Решение владельца (вопрос 3): ADR-0008 называет десять полей, одиннадцатое — правка ADR.
    expect(parseStreams(MTS_STREAMS)[0]?.color_range).toBe('tv');
    expect(FINGERPRINT_FIELDS).not.toContain('colorRange');
  });

  it('`fpsNum/fpsDen` берутся из `r_frame_rate`, а не из `avg_frame_rate`', () => {
    // У усечённого файла средняя частота «плывёт»; базовая — нет. Иначе R9 стал бы дублем R8.
    const drifted = JSON.stringify({
      streams: [{ ...JSON.parse(MTS_STREAMS).streams[0], avg_frame_rate: '2997/100' }],
    });
    expect(parseVideoFingerprint(drifted, 'зонд').fpsNum).toBe(30);
  });

  it('**R5**: аудио-дорожка видна в финале и не видна в сегменте', () => {
    expect(parseHasAudio(MTS_STREAMS)).toBe(false);
    expect(parseHasAudio(MP4_STREAMS)).toBe(true);
  });

  it('пропущенное поле — отказ с именем поля, а не `undefined` в отпечатке', () => {
    const noProfile = JSON.stringify({
      streams: [{ ...JSON.parse(MTS_STREAMS).streams[0], profile: undefined }],
    });
    expect(() => parseVideoFingerprint(noProfile, 'зонд')).toThrow(/profile/);
    expect(() => parseVideoFingerprint(noProfile, 'зонд')).toThrow(AssembleError);
  });

  it('два видео-потока или ни одного — отказ', () => {
    const two = JSON.stringify({
      streams: [JSON.parse(MTS_STREAMS).streams[0], JSON.parse(MTS_STREAMS).streams[0]],
    });
    expect(() => parseVideoFingerprint(two, 'зонд')).toThrow(/видео-потоков 2/);
    expect(() => parseVideoFingerprint(JSON.stringify({ streams: [] }), 'зонд')).toThrow(
      /видео-потоков 0/,
    );
  });

  it('негодная дробь — отказ, а не `NaN`', () => {
    const bad = JSON.stringify({
      streams: [{ ...JSON.parse(MTS_STREAMS).streams[0], r_frame_rate: '0/0' }],
    });
    expect(() => parseVideoFingerprint(bad, 'зонд')).toThrow(/30\/1|дробь/);
  });

  it('не-JSON и JSON без `streams` — отказ', () => {
    expect(() => parseStreams('стрим, кажется, есть')).toThrow(/не JSON/);
    expect(() => parseStreams('[]')).toThrow(/объект JSON/);
    expect(() => parseStreams('{"format":{}}')).toThrow(/нет массива `streams`/);
  });
});

describe('`M-04` — разбор счётчика кадров и ключевых кадров', () => {
  const COUNT = JSON.stringify({
    streams: [{ codec_type: 'video', nb_read_packets: '150' }],
  });

  it('`nb_read_packets` читается числом', () => {
    expect(parseFrameCount(COUNT, 'зонд')).toBe(150);
  });

  it('в аргументах счётчика есть `codec_type`', () => {
    // Без него `-show_entries` вырезает всё и поток перестаёт опознаваться как видео —
    // измерено падением на первом же прогоне этой сессии.
    expect(countPacketsArgs('/tmp/x.mts')).toContain('stream=codec_type,nb_read_packets');
    expect(countPacketsArgs('/tmp/x.mts')).toContain('-count_packets');
    // `-count_frames` декодирует и даёт то же число: платить за него незачем.
    expect(countPacketsArgs('/tmp/x.mts')).not.toContain('-count_frames');
  });

  it('позиции ключевых кадров — индексы пакетов, 0-based', () => {
    const packets = JSON.stringify({
      packets: [{ flags: 'K__' }, { flags: '___' }, { flags: '___' }, { flags: 'K__' }],
    });
    expect(parseKeyframeIndices(packets)).toEqual([0, 3]);
  });

  it('аргументы приборов просят только нужное', () => {
    expect(showStreamsArgs('/tmp/x.mts')).toEqual([
      '-hide_banner',
      '-v',
      'error',
      '-show_streams',
      '-of',
      'json',
      '/tmp/x.mts',
    ]);
    expect(showPacketFlagsArgs('/tmp/x.mts')).toContain('packet=flags');
  });
});

describe('`M-04` — подпись энкодера из байтов', () => {
  it('вырезается печатный ASCII-прогон от метки', () => {
    const bytes = new Uint8Array([
      0x00,
      0x01,
      ...new TextEncoder().encode('x264 - core 164 - options: keyint=30'),
      0x00,
      0x42,
    ]);
    expect(extractEncoderSignature(bytes, 'зонд')).toBe('x264 - core 164 - options: keyint=30');
  });

  it('без подписи — отказ, а не пустая строка', () => {
    expect(() => extractEncoderSignature(new TextEncoder().encode('no signature here'), 'зонд')).toThrow(
      AssembleError,
    );
  });
});

describe('`M-04` — охранники сетки GOP и подписи умеют падать по СОДЕРЖАНИЮ', () => {
  // Обе проверки заведены по итогам протокола нарушений этой сессии (нарушения 21 и 22):
  // на настоящем негативе «штатный энкодер» даёт ЧЕТЫРЕ ключевых кадра вместо трёх, поэтому
  // ослабленный охранник, сверяющий только их ЧИСЛО, оставался зелёным. Случай «число то же,
  // позиции другие» на живом файле не воспроизводится — и именно поэтому он обязан быть здесь.

  it('сетка GOP: то же ЧИСЛО ключевых кадров на других позициях — отказ', () => {
    expect(() => assertClosedGop([0, 30, 60], 30, 90, 'зонд')).not.toThrow();
    expect(() => assertClosedGop([0, 29, 60], 30, 90, 'зонд')).toThrow(AssembleError);
    expect(() => assertClosedGop([1, 31, 61], 30, 90, 'зонд')).toThrow(/ожидались/);
  });

  it('сетка GOP: лишний ключевой кадр от сцены — отказ', () => {
    expect(() => assertClosedGop([0, 30, 45, 75], 30, 90, 'зонд')).toThrow(AssembleError);
  });

  it('подпись энкодера: разные строки — отказ, одинаковые — молчание', () => {
    expect(() => assertSameEncoderSignature('x264 - core 164 … crf=18.0', 'x264 - core 164 … crf=18.0')).not.toThrow();
    expect(() => assertSameEncoderSignature('x264 - core 164 … crf=23.0', 'x264 - core 164 … crf=18.0')).toThrow(
      AssembleError,
    );
    expect(() => assertSameEncoderSignature('x264 - core 164', 'x264 - core 164 … crf=18.0')).toThrow(
      /РОВНО ОДИН РАЗ/,
    );
  });
});

describe('`M-04` — третье слагаемое R8', () => {
  it('`ceil(N / samplesPerFrame)` точен на дробном `samplesPerFrame`', () => {
    // 48000 и 30000/1001 ⇒ 1601.6 сэмпла на кадр: величина непредставима в двоичной дроби,
    // и именно на ней «почти правильное» деление даёт кадр расхождения.
    const grid = timeGrid(48000, { num: 30000, den: 1001 });
    expect(framesForSamples(grid, 0)).toBe(0);
    expect(framesForSamples(grid, 1601)).toBe(1);
    expect(framesForSamples(grid, 1602)).toBe(2);
    expect(framesForSamples(grid, 16016)).toBe(10);
    expect(framesForSamples(grid, 16017)).toBe(11);
  });

  it('целое `samplesPerFrame` — граница ровно на кадре', () => {
    const grid = timeGrid(24000, { num: 30, den: 1 });
    expect(framesForSamples(grid, 800)).toBe(1);
    expect(framesForSamples(grid, 801)).toBe(2);
  });

  it('отрицательная длина — отказ', () => {
    expect(() => framesForSamples(timeGrid(24000, { num: 30, den: 1 }), -1)).toThrow(AssembleError);
  });
});

describe('`M-04` — бинарники обязательны, тихого пропуска нет', () => {
  it('ffprobe есть и отвечает', async () => {
    const text = await runFfprobe(['-hide_banner', '-v', 'error', '-show_entries', 'format=filename', '-of', 'json', '-f', 'lavfi', '-i', 'color=c=black:size=16x16:d=0.1']);
    expect(text).toContain('format');
  }, 30_000);

  it('ffmpeg есть и отвечает', async () => {
    const build = await readFfmpegBuild();
    expect(build.version).not.toBe('');
  }, 30_000);

  it('отсутствующий ffprobe — падение с ЛЕЧАЩИМ сообщением, а не `skip`', async () => {
    await expect(runFfprobe(['-version'], '/nonexistent/ffprobe')).rejects.toThrow(FfprobeError);
    await expect(runFfprobe(['-version'], '/nonexistent/ffprobe')).rejects.toThrow(/не найден/);
    await expect(runFfprobe(['-version'], '/nonexistent/ffprobe')).rejects.toThrow(/ffprobe/);
  }, 30_000);

  it('ненулевой код возврата — отказ с `stderr`', async () => {
    await expect(runFfprobe(['-show_streams', '/nonexistent/file.mts'])).rejects.toThrow(
      FfprobeError,
    );
  }, 30_000);
});
