// Общий инструмент тестов сборки (`M-04`).
//
// ПРАВИЛО ЭТИХ ТЕСТОВ — ТО ЖЕ, ЧТО У `M-03`: НИ ОДНОГО БИНАРНИКА В РЕПОЗИТОРИИ. Кадры и звук
// синтезируются на месте, во временном каталоге, и синтезирует их тот же ffmpeg, который мы
// и так требуем. Свой PNG-энкодер (zlib + CRC32) дал бы ещё сорок строк кода, которые нужно
// проверять, — ради входа, который к предмету задачи отношения не имеет.
//
// `fixtures/` эти тесты только ЧИТАЮТ. `pixelProfile` приходит из настоящей
// `fixtures/minimal/profiles/render.ac4.yaml` читателем `S-02`, `fps` — из `compile.yaml`:
// вторая копия чисел в тесте означала бы, что тест проверяет сам себя.
//
// ПОЧЕМУ ПРОФИЛЬ `ac4`, А НЕ `final`. У `ac4` `imageFormat: png` и `threads: 1`, то есть
// вход теста — без потерь, а энкод однопоточный и самый воспроизводимый. `scale: 0.25` тесту
// безразличен: масштаб раскрывает АДАПТЕР в геометрию композиции (ADR-0008 «Draft»), а сюда
// кадры приходят уже готового размера. Профиль `final` (`imageFormat: jpeg`, `threads: 4`)
// покрыт отдельно — в тесте аргументов, где важно, что `jpegQuality` меняет расширение входа.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CompileProfileSchema,
  RenderProfileSchema,
  readFamily,
  type CompileProfile,
  type RenderProfile,
} from '@vpe/schema';

import { runFfmpeg } from '../src/index.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const RENDER_AC4_FILE = path.join(REPO, 'fixtures/minimal/profiles/render.ac4.yaml');
export const RENDER_FINAL_FILE = path.join(REPO, 'fixtures/minimal/profiles/render.final.yaml');
export const COMPILE_PROFILE_FILE = path.join(REPO, 'fixtures/minimal/profiles/compile.yaml');
export const AUDIO_PROFILE_FILE = path.join(REPO, 'fixtures/minimal/profiles/audio.yaml');

/** Настоящий `render-profile/1` фикстуры — через читателя семейств, а не своим разбором YAML. */
export function renderProfileFixture(file: string): RenderProfile {
  const { value } = readFamily(file, { expectFamily: 'render-profile' });
  return RenderProfileSchema.parse(value);
}

/** Настоящий `compile-profile/1` фикстуры. */
export function compileProfileFixture(): CompileProfile {
  const { value } = readFamily(COMPILE_PROFILE_FILE, { expectFamily: 'compile-profile' });
  return CompileProfileSchema.parse(value);
}

/** Временный каталог теста. Всё пишется в `os.tmpdir()` и убирается вызывающим. */
export function makeTempDir(tag: string): string {
  return mkdtempSync(path.join(tmpdir(), `vpe-m04-${tag}-`));
}

export function removeTempDir(dir: string): void {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
}

/**
 * Источники кадров `lavfi`. Все детерминированы по построению: ни один не берёт шум и ни один
 * не смотрит на часы.
 *
 * `cutAt` — та самая СКЛЕЙКА СЦЕНЫ внутри последовательности. Без неё риск SP-3d §4.3
 * невидим: `FACT` (`M-04`) на спокойном источнике ключевые кадры встают на сетку `gopSize`
 * и БЕЗ `-sc_threshold 0`, то есть негативный тест без склейки стерёг бы пустое место
 * (требование владельца, `M-04`).
 */
export type FrameSource =
  | { readonly kind: 'testsrc' }
  | { readonly kind: 'bars' }
  | { readonly kind: 'solid'; readonly color: string }
  | { readonly kind: 'cut'; readonly cutAt: number };

const SIZE = '320x240';

function lavfiArgs(source: FrameSource, count: number, fps: string): string[][] {
  switch (source.kind) {
    case 'testsrc':
      return [['-f', 'lavfi', '-i', `testsrc=size=${SIZE}:rate=${fps}`, '-frames:v', String(count)]];
    case 'bars':
      return [['-f', 'lavfi', '-i', `smptebars=size=${SIZE}:rate=${fps}`, '-frames:v', String(count)]];
    case 'solid':
      return [
        ['-f', 'lavfi', '-i', `color=c=${source.color}:size=${SIZE}:rate=${fps}`, '-frames:v', String(count)],
      ];
    case 'cut':
      // Две половины подряд: до `cutAt` — ровный цвет, после — таблица. Жёсткая смена
      // содержимого, то есть настоящий scene cut для x264.
      return [
        ['-f', 'lavfi', '-i', `color=c=black:size=${SIZE}:rate=${fps}`, '-frames:v', String(source.cutAt)],
        [
          '-f',
          'lavfi',
          '-i',
          `smptebars=size=${SIZE}:rate=${fps}`,
          '-frames:v',
          String(count - source.cutAt),
        ],
      ];
  }
}

export interface FramesOptions {
  readonly dir: string;
  readonly source: FrameSource;
  readonly count: number;
  readonly fps: string;
  /** Расширение файлов кадров — `.png` или `.jpg`, под `pixelProfile.imageFormat`. */
  readonly extension: string;
}

/**
 * Пишет последовательность кадров и возвращает шаблон в форме ffmpeg (`…/%06d.png`).
 *
 * Нумерация с 1: так её пишет `-start_number` по умолчанию, и так же будет писать рендерер.
 */
export async function writeFrames(options: FramesOptions): Promise<string> {
  mkdirSync(options.dir, { recursive: true });
  const pattern = path.join(options.dir, `%06d${options.extension}`);
  const chunks = lavfiArgs(options.source, options.count, options.fps);
  let written = 0;
  for (const chunk of chunks) {
    const count = Number(chunk[chunk.indexOf('-frames:v') + 1]);
    await runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      ...chunk,
      '-start_number',
      String(written + 1),
      '-pix_fmt',
      options.extension === '.png' ? 'rgb24' : 'yuvj420p',
      pattern,
    ]);
    written += count;
  }
  return pattern;
}

/**
 * Пишет WAV с дорожкой: ровный тон, `sampleCount` сэмплов на `sampleRate`.
 *
 * Длина задаётся В СЭМПЛАХ, а не в секундах, потому что именно она входит в третье слагаемое
 * **R8** — `ceil(N_samples / samplesPerFrame)`. Секунды пришлось бы переводить обратно, и это
 * была бы вторая формула перевода времени в тесте (ADR-0003 T1).
 */
export async function writeTone(
  filePath: string,
  sampleRate: number,
  sampleCount: number,
): Promise<void> {
  await runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=${String(sampleRate)}`,
    '-frames:a',
    // `sine` отдаёт кадрами по 1024 сэмпла; точную длину даёт `-af atrim`, а не деление.
    String(Math.ceil(sampleCount / 1024) + 1),
    '-af',
    `atrim=end_sample=${String(sampleCount)}`,
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    filePath,
  ]);
}

/** Сегмент С аудио-дорожкой — вход негативного теста **R5**. Собирается в обход `encode.ts`. */
export async function writeSegmentWithAudio(
  filePath: string,
  framePattern: string,
  frameCount: number,
  fps: string,
  audioPath: string,
): Promise<void> {
  await runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    fps,
    '-i',
    framePattern,
    '-i',
    audioPath,
    '-frames:v',
    String(frameCount),
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-f',
    'mpegts',
    filePath,
  ]);
}
