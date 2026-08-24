// `M-04` — ШОВ: два настоящих сегмента → конкат `-c copy` → все проверки. Настоящий ffmpeg.
//
// ЭТО ПЕРВАЯ В РЕПОЗИТОРИИ ПРОВЕРКА ШВА (долг SP-3 №5, roadmap §7.3): все пять спайков серии
// SP-3 мерили ОДИН сегмент. Что здесь закрывается и что нет, сказано прямо:
//   * закрывается — шов двух сегментов, закодированных НАШИМ ffmpeg по профилю фикстуры:
//     точность `frameCount` до кадра, совпадение отпечатка, сетка GOP, единственность энкода;
//   * НЕ закрывается — «два НАСТОЯЩИХ сегмента»: кадры здесь синтетические (`lavfi`), а не
//     выход HyperFrames. Это остаётся за `F-01`, и долг сужается, а не закрывается.
//
// ffmpeg И ffprobe ОБЯЗАТЕЛЬНЫ (решение владельца, `M-03` вопрос 9 — действует и здесь).
// Тихого `skip` тут нет ни одного: тест, который молча пропускает себя на машине без
// инструмента, — это и есть ложно-зелёный.

import { statSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AudioProfileSchema, readFamily, type AudioProfile } from '@vpe/schema';
import { timeGrid } from '@vpe/core-model';

import {
  AssembleError,
  assertClosedGop,
  assertFrameCounts,
  assertNoAudioTrack,
  assertSameEncoderSignature,
  assertSameFingerprint,
  concatAndMux,
  encodeSegment,
  framemd5Of,
  framesForSamples,
  probeColorRange,
  probeFrameCount,
  probeHasAudio,
  probeKeyframeIndices,
  probeStreamFingerprint,
  readEncoderSignature,
  verifyAssembly,
  type StreamFingerprint,
} from '../src/index.js';

import {
  AUDIO_PROFILE_FILE,
  RENDER_AC4_FILE,
  compileProfileFixture,
  makeTempDir,
  removeTempDir,
  renderProfileFixture,
  writeFrames,
  writeSegmentWithAudio,
  writeTone,
} from './assemble-helpers.js';

const AC4 = renderProfileFixture(RENDER_AC4_FILE);
const COMPILE = compileProfileFixture();
const AUDIO: AudioProfile = AudioProfileSchema.parse(
  readFamily(AUDIO_PROFILE_FILE, { expectFamily: 'audio-profile' }).value,
);

const PIXEL = AC4.pixelProfile;
const GOP = PIXEL.gopSize;
const FPS = `${String(COMPILE.fps.num)}/${String(COMPILE.fps.den)}`;
const GRID = timeGrid(COMPILE.projectSampleRate, COMPILE.fps);

/** Три GOP и два GOP: длины кратны `gopSize`, чтобы сетка проверялась без остатка. */
const FRAMES_A = GOP * 3;
const FRAMES_B = GOP * 2;
const TOTAL_FRAMES = FRAMES_A + FRAMES_B;

/** `N_samples` подобрано так, что `ceil(N / samplesPerFrame)` даёт ровно `TOTAL_FRAMES`. */
const SAMPLES = (COMPILE.projectSampleRate * TOTAL_FRAMES * COMPILE.fps.den) / COMPILE.fps.num;

const TIMEOUT = 120_000;

let DIR = '';
let segmentA = '';
let segmentB = '';
let audioPath = '';
let finalPath = '';
let listPath = '';
let fingerprintA: StreamFingerprint;
let fingerprintFinal: StreamFingerprint;
let signatureA = '';
let signatureFinal = '';
let measuredFrames = 0;
let keyframes: readonly number[] = [];

beforeAll(async () => {
  DIR = makeTempDir('seam');
  segmentA = path.join(DIR, 'seg-000.mts');
  segmentB = path.join(DIR, 'seg-001.mts');
  audioPath = path.join(DIR, 'track.wav');
  finalPath = path.join(DIR, 'final.mp4');
  listPath = path.join(DIR, 'concat.txt');

  const patternA = await writeFrames({
    dir: path.join(DIR, 'a'),
    source: { kind: 'testsrc' },
    count: FRAMES_A,
    fps: FPS,
    extension: '.png',
  });
  const patternB = await writeFrames({
    dir: path.join(DIR, 'b'),
    source: { kind: 'bars' },
    count: FRAMES_B,
    fps: FPS,
    extension: '.png',
  });

  await encodeSegment({
    framePattern: patternA,
    startNumber: 1,
    frameCount: FRAMES_A,
    fps: COMPILE.fps,
    pixelProfile: PIXEL,
    outputPath: segmentA,
  });
  await encodeSegment({
    framePattern: patternB,
    startNumber: 1,
    frameCount: FRAMES_B,
    fps: COMPILE.fps,
    pixelProfile: PIXEL,
    outputPath: segmentB,
  });

  await writeTone(audioPath, COMPILE.projectSampleRate, SAMPLES);
  await concatAndMux({
    segmentPaths: [segmentA, segmentB],
    listPath,
    audioPath,
    audioProfile: AUDIO,
    outputPath: finalPath,
  });

  fingerprintA = await probeStreamFingerprint({ path: segmentA });
  fingerprintFinal = await probeStreamFingerprint({ path: finalPath });
  signatureA = await readEncoderSignature({ path: segmentA });
  signatureFinal = await readEncoderSignature({ path: finalPath });
  measuredFrames = await probeFrameCount({ path: finalPath });
  keyframes = await probeKeyframeIndices({ path: finalPath });
}, TIMEOUT);

afterAll(() => {
  removeTempDir(DIR);
});

describe('`M-04` — сегмент', () => {
  it('**R5**: аудио-дорожки в сегменте нет', async () => {
    expect(await probeHasAudio({ path: segmentA })).toBe(false);
    expect(await probeHasAudio({ path: segmentB })).toBe(false);
  });

  it('число кадров сегмента — заказанное, измеренное ffprobe', async () => {
    expect(await probeFrameCount({ path: segmentA })).toBe(FRAMES_A);
    expect(await probeFrameCount({ path: segmentB })).toBe(FRAMES_B);
  });

  it('сетка GOP сегмента — ровно по `gopSize` профиля', async () => {
    const indices = await probeKeyframeIndices({ path: segmentA });
    expect(indices).toEqual([0, GOP, GOP * 2]);
    assertClosedGop(indices, GOP, FRAMES_A, 'сегмент A');
  });

  it('отпечаток сегмента ИЗМЕРЕН, а не взят из профиля', () => {
    // Три поля профиль знает, и они обязаны совпасть; ещё семь профиль не знает вовсе —
    // если бы отпечаток был эхом профиля, их неоткуда было бы взять.
    expect(fingerprintA.codec).toBe(PIXEL.codec);
    expect(fingerprintA.pixFmt).toBe(PIXEL.pixelFormat);
    expect(fingerprintA.colorSpace).toBe(PIXEL.colorSpace);
    expect(fingerprintA.profile).toBe('High');
    expect(fingerprintA.level).not.toBe('');
    expect(fingerprintA.timeBase).toBe('1/90000');
    expect(fingerprintA.fpsNum).toBe(COMPILE.fps.num);
    expect(fingerprintA.fpsDen).toBe(COMPILE.fps.den);
    expect(fingerprintA.width).toBeGreaterThan(0);
    expect(fingerprintA.height).toBeGreaterThan(0);
  });
});

describe('`M-04` — шов двух сегментов (долг SP-3 №5, первая проверка)', () => {
  it('**R8**: тройное равенство сошлось до кадра', () => {
    const audioFrames = framesForSamples(GRID, SAMPLES);
    expect(measuredFrames).toBe(TOTAL_FRAMES);
    expect(audioFrames).toBe(TOTAL_FRAMES);
    assertFrameCounts({
      declaredFrames: FRAMES_A + FRAMES_B,
      measuredFrames,
      audioFrames,
    });
  });

  it('**R9**: отпечаток финала == отпечаток первого сегмента, все десять полей', () => {
    assertSameFingerprint(fingerprintFinal, fingerprintA);
    // `timeBase` — то самое десятое поле, из-за которого R9 могло не исполниться буквально:
    // сегмент MPEG-TS, финал mp4. `-c copy` переносит шкалу как есть.
    expect(fingerprintFinal.timeBase).toBe(fingerprintA.timeBase);
  });

  it('**R10**: подпись энкодера финала == подписи первого сегмента, побайтово', () => {
    expect(signatureFinal).toBe(signatureA);
    assertSameEncoderSignature(signatureFinal, signatureA);
    // В подписи видны фактические параметры энкода — то есть исполненный профиль.
    expect(signatureA).toContain(`keyint=${String(GOP)}`);
    expect(signatureA).toContain('scenecut=0');
    expect(signatureA).toContain('open_gop=0');
    expect(signatureA).toContain(`threads=${String(PIXEL.encoder.threads)}`);
  });

  it('сетка GOP финала не сбита швом', () => {
    assertClosedGop(keyframes, GOP, TOTAL_FRAMES, 'финал');
    expect(keyframes).toEqual([0, GOP, GOP * 2, GOP * 3, GOP * 4]);
  });

  it('в финале ровно два потока: видео и аудио, аудио — по профилю доставки', async () => {
    expect(await probeHasAudio({ path: finalPath })).toBe(true);
    expect(statSync(finalPath).size).toBeGreaterThan(0);
  });

  it('`verifyAssembly` собирает все четыре проверки в один вызов', () => {
    expect(() =>
      verifyAssembly({
        grid: GRID,
        declaredFrames: TOTAL_FRAMES,
        sampleCount: SAMPLES,
        gopSize: GOP,
        measured: {
          frameCount: measuredFrames,
          fingerprint: fingerprintFinal,
          keyframeIndices: keyframes,
          encoderSignature: signatureFinal,
        },
        firstSegment: { fingerprint: fingerprintA, encoderSignature: signatureA },
      }),
    ).not.toThrow();
  });
});

describe('`M-04` — негативы: каждый охранник умеет падать', () => {
  it('**R5**: НАСТОЯЩИЙ сегмент с аудио-дорожкой отвергается', async () => {
    // Файл собран в обход `encode.ts` — так его отдал бы «штатный энкодер рендерера»,
    // если бы сегменты кодировал он. Охранник получает настоящий вход, а не подделанное
    // булево: `assertNoAudioTrack` сам зовёт ffprobe и сам решает.
    const bad = path.join(DIR, 'with-audio.mts');
    await writeSegmentWithAudio(bad, path.join(DIR, 'a', '%06d.png'), GOP, FPS, audioPath);
    expect(await probeHasAudio({ path: bad })).toBe(true);
    await expect(assertNoAudioTrack({ path: bad })).rejects.toThrow(AssembleError);
    await expect(assertNoAudioTrack({ path: bad })).rejects.toThrow(/аудио-дорожка/);
    // И тот же охранник молчит на нашем сегменте — иначе он падал бы всегда.
    await expect(assertNoAudioTrack({ path: segmentA })).resolves.toBeUndefined();
  }, TIMEOUT);

  it('**R8**: расхождение ровно в один кадр валит сборку', () => {
    expect(() =>
      assertFrameCounts({
        declaredFrames: TOTAL_FRAMES,
        measuredFrames: TOTAL_FRAMES - 1,
        audioFrames: TOTAL_FRAMES,
      }),
    ).toThrow(AssembleError);
    expect(() =>
      assertFrameCounts({
        declaredFrames: TOTAL_FRAMES,
        measuredFrames: TOTAL_FRAMES,
        audioFrames: TOTAL_FRAMES + 1,
      }),
    ).toThrow(/тройное равенство/);
  });

  it('**R8**: усечённый сегмент — измеренное расхождение, а не рассуждение', async () => {
    const short = path.join(DIR, 'short.mts');
    await encodeSegment({
      framePattern: path.join(DIR, 'a', '%06d.png'),
      startNumber: 1,
      frameCount: FRAMES_A - 1,
      fps: COMPILE.fps,
      pixelProfile: PIXEL,
      outputPath: short,
    });
    const shortList = path.join(DIR, 'short-list.txt');
    const shortFinal = path.join(DIR, 'short-final.mp4');
    await concatAndMux({
      segmentPaths: [short, segmentB],
      listPath: shortList,
      audioPath,
      audioProfile: AUDIO,
      outputPath: shortFinal,
    });
    const measured = await probeFrameCount({ path: shortFinal });
    expect(measured).toBe(TOTAL_FRAMES - 1);
    expect(() =>
      assertFrameCounts({
        declaredFrames: TOTAL_FRAMES,
        measuredFrames: measured,
        audioFrames: framesForSamples(GRID, SAMPLES),
      }),
    ).toThrow(AssembleError);
  }, TIMEOUT);

  it('**R9**: сегменты с разным отпечатком расходятся ПОИМЁННО', async () => {
    const other = path.join(DIR, 'other-size.mts');
    const pattern = await writeFrames({
      dir: path.join(DIR, 'c'),
      source: { kind: 'solid', color: 'red' },
      count: GOP,
      fps: FPS,
      extension: '.png',
    });
    await encodeSegment({
      framePattern: pattern,
      startNumber: 1,
      frameCount: GOP,
      fps: COMPILE.fps,
      pixelProfile: { ...PIXEL, pixelFormat: 'yuv422p' },
      outputPath: other,
    });
    const fingerprintOther = await probeStreamFingerprint({ path: other });
    expect(fingerprintOther.pixFmt).not.toBe(fingerprintA.pixFmt);
    expect(() => assertSameFingerprint(fingerprintA, fingerprintOther)).toThrow(/pixFmt/);
  }, TIMEOUT);

  it('закрытость GOP: склейка сцены БЕЗ `-sc_threshold 0` сбивает сетку', async () => {
    // Риск SP-3d §4.3 в наблюдаемом виде. Склейка внутри последовательности обязательна:
    // на спокойном источнике сетка не сбивается и без флага — тогда тест стерёг бы пустоту.
    const cutAt = Math.floor(GOP * 1.5);
    const frames = GOP * 3;
    const pattern = await writeFrames({
      dir: path.join(DIR, 'cut'),
      source: { kind: 'cut', cutAt },
      count: frames,
      fps: FPS,
      extension: '.png',
    });

    const ours = path.join(DIR, 'cut-ours.mts');
    await encodeSegment({
      framePattern: pattern,
      startNumber: 1,
      frameCount: frames,
      fps: COMPILE.fps,
      pixelProfile: PIXEL,
      outputPath: ours,
    });
    const oursKeys = await probeKeyframeIndices({ path: ours });
    expect(oursKeys).toEqual([0, GOP, GOP * 2]);
    assertClosedGop(oursKeys, GOP, frames, 'наш энкод');

    // Тот же вход тем же ffmpeg, но БЕЗ нашего флага — «штатный энкодер рендерера».
    const theirs = path.join(DIR, 'cut-theirs.mts');
    const { runFfmpeg } = await import('../src/index.js');
    await runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      FPS,
      '-i',
      pattern,
      '-frames:v',
      String(frames),
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      String(PIXEL.crf),
      '-preset',
      PIXEL.encoder.preset,
      '-g',
      String(GOP),
      '-pix_fmt',
      PIXEL.pixelFormat,
      '-f',
      'mpegts',
      theirs,
    ]);
    const theirsKeys = await probeKeyframeIndices({ path: theirs });
    expect(theirsKeys).toContain(cutAt);
    expect(theirsKeys).not.toEqual(oursKeys);
    expect(() => assertClosedGop(theirsKeys, GOP, frames, 'штатный энкодер')).toThrow(
      AssembleError,
    );
  }, TIMEOUT);
});

describe('`M-04` — детерминизм и измерения для отчёта', () => {
  it('два прогона одного входа дают побайтово равный сегмент и равный `framemd5`', async () => {
    const one = path.join(DIR, 'det-1.mts');
    const two = path.join(DIR, 'det-2.mts');
    const pattern = path.join(DIR, 'a', '%06d.png');
    for (const outputPath of [one, two]) {
      await encodeSegment({
        framePattern: pattern,
        startNumber: 1,
        frameCount: FRAMES_A,
        fps: COMPILE.fps,
        pixelProfile: PIXEL,
        outputPath,
      });
    }
    const { readFileSync } = await import('node:fs');
    expect(Buffer.compare(readFileSync(one), readFileSync(two))).toBe(0);

    const md5one = await framemd5Of({ path: one });
    const md5two = await framemd5Of({ path: two });
    expect(md5one.lines).toEqual(md5two.lines);
    expect(md5one.lines.length).toBe(FRAMES_A);
  }, TIMEOUT);

  it('`framemd5` финала содержит по строке на кадр', async () => {
    const result = await framemd5Of({ path: finalPath });
    expect(result.lines.length).toBe(TOTAL_FRAMES);
    // Шапка с версией сборки в сравниваемое значение не входит (K6).
    expect(result.text).toContain('#software:');
    expect(result.lines.some((line) => line.startsWith('#'))).toBe(false);
  }, TIMEOUT);

  it('`color_range` измерен и стабилен: сегмент и финал одинаковы', async () => {
    // Одиннадцатым полем отпечатка он НЕ становится (решение владельца, вопрос 3):
    // это правка ADR-0008. Здесь он измеряется, чтобы кандидат в правку был с числом.
    const segment = await probeColorRange({ path: segmentA });
    const final = await probeColorRange({ path: finalPath });
    expect(segment).toBe('tv');
    expect(final).toBe(segment);
  }, TIMEOUT);
});
