// `SegmentArtifact` — сборка артефакта сегмента из КАДРОВ, отданных рендерером.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ЖИВЁТ В `media`, А НЕ В `renderer-hyperframes`. Правка DOC-04 (2026-08-25) в
// [ADR-0008](../../../../docs/adr/0008-renderer-boundary.md): «`SegmentArtifact` — выход СБОРКИ,
// а не рендерера: рендерер отдаёт КАДРЫ, `media` их кодирует и собирает артефакт». Решение
// владельца `H-01` (поправка A) читает эту букву дословно: адаптер возвращает
// `RenderedFrames`, стрелки `renderer-hyperframes → media` в карте ADR-0009 не появляется, и
// охранник графа `tests/boundaries/adr0009-graph.test.ts` не правится ни строкой.
//
// ФУНКЦИЯ АДДИТИВНА: она НИЧЕГО не меняет в `M-04`, а СОБИРАЕТ уже написанное — `encodeSegment`
// (кодирование + `assertNoAudioTrack` + сверка числа кадров), `probeStreamFingerprint`
// (ИЗМЕРЕННЫЙ отпечаток, а не эхо профиля), `framemd5Of`, `sha256Of`. Ни один существующий
// вызов не переписан; протокол `M-04` в силе целиком.
//
// ПОЧЕМУ `framemd5` СЧИТАЕТСЯ ЗДЕСЬ, ХОТЯ ОН «ПОД ФЛАГОМ». `SegmentArtifact` по ADR-0008 несёт
// поле `framemd5Sha256` — не «может нести», а несёт. Флаг `--verify-frames` (ADR-0006 §14)
// управляет тем, зовётся ли `framemd5` в ОБЫЧНОЙ сборке ролика, а не тем, бывает ли артефакт
// без своего поля. Поэтому здесь он обязателен, а охранник «обычный путь сборки его не
// импортирует» продолжает стеречь `encode.ts`/`concat.ts`/`verify.ts`, которых эта функция
// не трогает.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Fps } from '@vpe/core-model';
import { asSha256, type RenderProfile, type Sha256 } from '@vpe/schema';

import { encodeSegment } from './encode.js';
import { probeStreamFingerprint, type ProbeOptions, type StreamFingerprint } from './ffprobe.js';
import { framemd5Of } from './framemd5.js';

/**
 * Кадры, отданные рендерером. Форма — та же, что у `RenderedFrames` адаптера, но ТИП здесь
 * свой: `media` не зависит от `renderer-hyperframes` (стрелки в карте нет, и она бы её
 * развернула). Совпадение полей проверяется вызовом, а не наследованием, — и это дешевле,
 * чем общий пакет ради четырёх полей.
 */
export interface RenderedFramesInput {
  readonly dir: string;
  /** Шаблон имени кадра в форме ffmpeg: `frame_%06d.png`. */
  readonly pattern: string;
  readonly startNumber: number;
  readonly frameCount: number;
}

/** Измерения прогона, пришедшие от того, кто запускал рендерер. */
export interface RenderStatsInput {
  readonly wallMs: number;
  readonly retries: number;
  readonly peakRssBytes: number;
}

/**
 * `SegmentArtifact` — ADR-0008 «Контракт», дословно, все шесть полей.
 *
 * `stream` — ИЗМЕРЕНО `ffprobe`, а не эхо профиля: `ffprobe.ts` не принимает профиль ни под
 * каким именем (**R9**, `M-04`), иначе сравнение сравнивало бы профиль сам с собой.
 */
export interface SegmentArtifact {
  readonly path: string;
  readonly sha256: Sha256;
  /** Число кадров, ИЗМЕРЕННОЕ в готовом файле, а не заказанное. */
  readonly frameCount: number;
  readonly framemd5Sha256: Sha256;
  readonly stream: StreamFingerprint;
  readonly stats: RenderStatsInput;
}

export interface BuildSegmentArtifactOptions {
  readonly frames: RenderedFramesInput;
  readonly pixelProfile: RenderProfile['pixelProfile'];
  /** `compileProfile.fps` — точная дробь (ADR-0003 T2). */
  readonly fps: Fps;
  readonly outputPath: string;
  readonly stats: RenderStatsInput;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

// `asSha256`, а не каст: бренд, снимаемый кастом, не бренд (`S-01` долг №3, ADR-0007 §3).
// Конструктор-валидатор проверяет форму hex — и здесь это не формальность: `digest('hex')`
// вернёт 64 строчных hex, но ТОЛЬКО пока алгоритм `sha256`; смена строки алгоритма даст
// другую длину, и отказ обязан случиться на входе бренда, а не на сравнении адресов в CAS.
const sha256Of = (bytes: Uint8Array): Sha256 => asSha256(createHash('sha256').update(bytes).digest('hex'));

/**
 * Кадры → готовый сегмент `.mts` + артефакт.
 *
 * Порядок не произволен: сначала КОДИРОВАНИЕ (внутри которого уже стоят **R5** и сверка числа
 * кадров), потом ИЗМЕРЕНИЯ готового файла. Измерять то, чего ещё нет, нечем; кодировать то,
 * что уже измерено, — незачем.
 *
 * @throws {AssembleError} из `encodeSegment` — при аудио-дорожке (**R5**) или расхождении
 *   числа кадров хотя бы на один (**R8**).
 */
export async function buildSegmentArtifact(
  options: BuildSegmentArtifactOptions,
): Promise<SegmentArtifact> {
  const { frames } = options;

  const run = await encodeSegment({
    framePattern: `${frames.dir}/${frames.pattern}`,
    startNumber: frames.startNumber,
    frameCount: frames.frameCount,
    fps: options.fps,
    pixelProfile: options.pixelProfile,
    outputPath: options.outputPath,
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
  });

  const probe: ProbeOptions =
    options.ffprobePath === undefined
      ? { path: options.outputPath }
      : { path: options.outputPath, ffprobePath: options.ffprobePath };

  const stream = await probeStreamFingerprint(probe);
  const md5 = await framemd5Of(
    options.ffmpegPath === undefined
      ? { path: options.outputPath }
      : { path: options.outputPath, ffmpegPath: options.ffmpegPath },
  );
  const bytes = await readFile(options.outputPath);

  return {
    path: options.outputPath,
    sha256: sha256Of(bytes),
    frameCount: run.frameCount,
    // Хэшируются СТРОКИ КАДРОВ без шапки, а не весь вывод: шапка `framemd5` несёт имя файла и
    // версию ffmpeg, то есть отпечаток окружения, — а поле артефакта обязано отвечать на
    // вопрос «те же ли кадры», а не «та же ли машина». Разделение уже сделано в `framemd5.ts`
    // (`text` против `lines`), здесь оно только используется.
    framemd5Sha256: sha256Of(Buffer.from(md5.lines.join('\n') + '\n', 'utf8')),
    stream,
    stats: options.stats,
  };
}
