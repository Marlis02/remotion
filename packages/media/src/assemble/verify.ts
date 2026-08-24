// Проверки ПОСЛЕ конката: **R8**, **R9**, закрытость GOP и вторая половина **R10**.
//
// ПОЧЕМУ ОНИ ЖИВУТ ОТДЕЛЬНО ОТ КОНКАТА. Конкат — это вызов ffmpeg; проверки — это утверждения
// о готовом файле, и они обязаны быть вызываемы отдельно: на артефакте, собранном вчера, на
// артефакте из кэша, на артефакте, который принесли руками. Функция, проверяющая только то,
// что сама же и собрала, не отличает «собрано верно» от «собрано и проверено тем же кодом».
//
// НИ ОДНА ВЕЛИЧИНА ЗДЕСЬ НЕ ПРИХОДИТ ИЗ ПРОФИЛЯ. `frameCount` измерен `ffprobe`, `N_samples`
// приходит из PCM (`M-03`), отпечаток измерен `ffprobe`, подпись энкодера прочитана из
// битстрима. Профиль участвует ровно одним числом — `gopSize`, — и именно потому, что правило
// звучит как «GOP задаёт профиль, а не энкодер»: тут сравнение с профилем и есть содержание.
//
// РАСХОЖДЕНИЕ ХОТЯ БЫ НА КАДР — ПАДЕНИЕ (ADR-0008 «Сборка»). Ни одна из функций ниже не умеет
// возвращать «почти сошлось»: у них нет порога, и это решение, а не упущение.

import { ceilDiv, mulExact, samplesPerFrame, type TimeGrid } from '@vpe/core-model';

import { runFfmpeg, DEFAULT_FFMPEG_PATH } from '../audio/ffmpeg.js';
import { AssembleError } from './errors.js';
import { FINGERPRINT_FIELDS, type StreamFingerprint } from './ffprobe.js';

/**
 * **R9**: отпечаток финала совпадает с отпечатком первого сегмента.
 *
 * Сообщение перечисляет РАЗОШЕДШИЕСЯ поля поимённо, со значениями обеих сторон. «Отпечатки
 * не совпали» без этого списка означает час на `ffprobe` руками — а это и есть та строка,
 * ради которой охранник написан.
 *
 * `FACT` (`M-04`, ffmpeg 6.1.1), снявший единственное возражение к буквальной формулировке
 * ADR: `time_base` финала совпадает с `time_base` сегмента (`1/90000` у обоих) — `-c copy`
 * переносит шкалу времени MPEG-TS в mp4 как есть. До измерения это было главным подозрением:
 * казалось, что «TS против MP4» разведёт `timeBase` по построению и десятое поле придётся
 * выкидывать. Не пришлось.
 */
export function assertSameFingerprint(
  final: StreamFingerprint,
  firstSegment: StreamFingerprint,
): void {
  const differences = FINGERPRINT_FIELDS.filter((field) => final[field] !== firstSegment[field]).map(
    (field) => `${field}: финал \`${String(final[field])}\` ≠ сегмент \`${String(firstSegment[field])}\``,
  );
  if (differences.length > 0) {
    throw new AssembleError(
      'R9',
      `\`StreamFingerprint\` финала не совпал с первым сегментом:\n  ${differences.join('\n  ')}`,
    );
  }
}

/**
 * `ceil(N_samples / samplesPerFrame)` — третье слагаемое **R8**, целочисленно.
 *
 * `samplesPerFrame` дробное (ADR-0003 T2: при 48000 и 30000/1001 это 1601.6), поэтому деление
 * идёт через рациональную пару: `ceil(N / (a/b)) = ceil(N·b / a)`. Своей арифметики здесь нет
 * ни строки — `samplesPerFrame`, `mulExact` и `ceilDiv` приходят из `@vpe/core-model` (C-01),
 * и это не вежливость к пакету: вторая формула перевода времени — ровно то, что запрещает
 * ADR-0003 T1.
 */
export function framesForSamples(grid: TimeGrid, sampleCount: number): number {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new AssembleError('R8', `\`N_samples\` = ${String(sampleCount)}: ожидалось целое ≥ 0`);
  }
  const perFrame = samplesPerFrame(grid);
  // Пара сокращена конструктором `rational`, поэтому имя величины в сообщении — про пару,
  // а не про `fpsNum`: после сокращения это уже не он.
  return ceilDiv(mulExact(sampleCount, perFrame.den, 'N_samples · den(samplesPerFrame)'), perFrame.num);
}

export interface FrameCountCheck {
  /** `Σ durationInFrames` — сумма заявленных длительностей сегментов. */
  readonly declaredFrames: number;
  /** `frameCount(final)` — ИЗМЕРЕННОЕ число кадров финала. */
  readonly measuredFrames: number;
  /** `ceil(N_samples / samplesPerFrame)` — из длины PCM-дорожки. */
  readonly audioFrames: number;
}

/**
 * **R8**: `Σ durationInFrames == frameCount(final) == ceil(N_samples / samplesPerFrame)`.
 *
 * Три величины приходят из ТРЁХ РАЗНЫХ мест, и в этом весь смысл: сумма — из плана сборки,
 * измеренная — из готового файла, аудио — из дорожки. Совпадение двух из трёх ловит половину
 * ошибок и пропускает вторую (например, компилятор и энкодер согласованно ошиблись на кадр,
 * а звук остался прежним).
 */
export function assertFrameCounts(check: FrameCountCheck): void {
  const { declaredFrames, measuredFrames, audioFrames } = check;
  if (declaredFrames === measuredFrames && measuredFrames === audioFrames) return;
  throw new AssembleError(
    'R8',
    'тройное равенство не сошлось:\n' +
      `  Σ durationInFrames = ${String(declaredFrames)}\n` +
      `  frameCount(final)  = ${String(measuredFrames)} (измерено ffprobe)\n` +
      `  ceil(N_samples / samplesPerFrame) = ${String(audioFrames)}\n` +
      'Расхождение хотя бы на кадр валит сборку (ADR-0008 «Сборка»): кадр рассинхрона звука ' +
      'и картинки не «почти сошлось», а другой ролик.',
  );
}

/**
 * Закрытость GOP: ключевые кадры стоят ровно на `0, gopSize, 2·gopSize, …`.
 *
 * ПОЧЕМУ ЭТО ПРОВЕРЯЕТСЯ, А НЕ ПРЕДПОЛАГАЕТСЯ. `FACT` (`M-04`, ffmpeg 6.1.1): на
 * последовательности со склейкой сцены на кадре 45 энкодер БЕЗ `-sc_threshold 0` ставит
 * ключевые кадры на `0, 30, 45, 75` — сцена вставила свой I-кадр и сдвинула всю сетку.
 * Это и есть риск SP-3d §4.3 в наблюдаемом виде. На спокойном источнике разницы нет ни одной,
 * поэтому охранник обязан стоять на выходе, а не на намерении: «мы же передали флаг» — не
 * проверка.
 */
export function assertClosedGop(
  keyframeIndices: readonly number[],
  gopSize: number,
  frameCount: number,
  where: string,
): void {
  const expected: number[] = [];
  for (let index = 0; index < frameCount; index += gopSize) expected.push(index);
  const same =
    keyframeIndices.length === expected.length &&
    keyframeIndices.every((value, position) => value === expected[position]);
  if (!same) {
    throw new AssembleError(
      'M-04 закрытость GOP',
      `${where}: ключевые кадры на позициях [${keyframeIndices.join(', ')}], ожидались ` +
        `[${expected.join(', ')}] (\`gopSize\` = ${String(gopSize)}). GOP задаёт профиль, а не ` +
        'энкодер (ADR-0008 «Сборка»); лишний I-кадр означает, что сцена внутри сегмента ' +
        'пересилила `-sc_threshold 0` — а на такой сетке `concat -c copy` перестаёт быть точным.',
    );
  }
}

/**
 * Подпись энкодера, прочитанная ИЗ БИТСТРИМА, — вторая половина охранника **R10**.
 *
 * Строка реестра обещает «тест командной строки ffmpeg + `encoderSettings` из `ffprobe`».
 * Первая половина живёт в `concat.ts` (`assertNoVideoEncodeArgs`). Со второй пришлось
 * разбираться измерением, и вот что оно дало (`FACT`, `M-04`, ffmpeg 6.1.1):
 *
 *   * `ffprobe` НЕ показывает подпись x264 ни одним полем: `stream_tags=encoder` пуст и у
 *     `.mts`, и у `.mp4`, с `-bitexact` и без него. Буквальное «`encoderSettings` из
 *     `ffprobe`» неисполнимо — это кандидат в правку строки реестра, записанный в отчёте;
 *   * сама подпись при этом НА МЕСТЕ и переживает `-c copy` без единого байта изменений:
 *     `-fflags +bitexact -flags:v +bitexact` SEI x264 не вырезает (в отличие от метаданных
 *     контейнера). В ней записаны фактические параметры энкода: `keyint=30 … scenecut=0 …
 *     crf=18.0 … threads=4`;
 *   * сравнивать её В КОНТЕЙНЕРЕ нельзя: в MPEG-TS строку режут 188-байтные заголовки
 *     пакетов, и побайтовое сравнение с mp4 не сойдётся никогда. В ЭЛЕМЕНТАРНОМ потоке —
 *     сходится точно (661 Б и там, и там);
 *   * склеить элементарные потоки сегментов и сравнить с финалом ЦЕЛИКОМ — нельзя: 32288 Б
 *     против 32143 Б, расхождение с байта 4527 (SPS/PPS/AUD на шве). Поэтому охранник — это
 *     подпись, а не «склей и сравни».
 */
export async function readEncoderSignature(options: {
  readonly path: string;
  readonly ffmpegPath?: string;
}): Promise<string> {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    options.path,
    '-map',
    '0:v:0',
    '-c',
    'copy',
    '-f',
    'h264',
    '-',
  ];
  const run = await runFfmpeg(args, options.ffmpegPath ?? DEFAULT_FFMPEG_PATH);
  return extractEncoderSignature(run.stdout, options.path);
}

/** Начало подписи x264 в SEI. Ищем именно её: у другого энкодера будет другой охранник. */
const SIGNATURE_MARK = 'x264 - core';

/**
 * Печатный ASCII-прогон, начинающийся с `x264 - core`, — чистая функция над байтами.
 *
 * Не разбираем NAL по правилам H.264 намеренно: разбор битстрима — это второй парсер формата
 * в репозитории, а нужен нам ровно один непрерывный кусок текста. Границей служит первый
 * непечатный байт, и это устойчиво: подпись — ASCII целиком.
 */
export function extractEncoderSignature(bytes: Uint8Array, where: string): string {
  const mark = new TextEncoder().encode(SIGNATURE_MARK);
  let start = -1;
  for (let i = 0; i + mark.length <= bytes.length; i += 1) {
    let hit = true;
    for (let j = 0; j < mark.length; j += 1) {
      if (bytes[i + j] !== mark[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    throw new AssembleError(
      'R10',
      `${where}: в битстриме нет подписи \`${SIGNATURE_MARK}\`. Она пишется энкодером в SEI и ` +
        'переживает `-c copy`; её отсутствие означает либо другой энкодер, либо вырезанный SEI — ' +
        'в обоих случаях сравнивать «тот же битстрим или перекодированный» больше нечем.',
    );
  }
  let end = start;
  while (end < bytes.length) {
    const byte = bytes[end] as number;
    if (byte < 0x20 || byte > 0x7e) break;
    end += 1;
  }
  return Buffer.from(bytes.subarray(start, end)).toString('ascii');
}

/** **R10**: подпись энкодера у финала — та же, что у первого сегмента, побайтово. */
export function assertSameEncoderSignature(final: string, firstSegment: string): void {
  if (final === firstSegment) return;
  throw new AssembleError(
    'R10',
    'подпись энкодера в битстриме финала отличается от подписи первого сегмента:\n' +
      `  финал:   ${final}\n` +
      `  сегмент: ${firstSegment}\n` +
      'Видео кодируется РОВНО ОДИН РАЗ (ADR-0008 «Сборка»); другая подпись означает второй ' +
      'энкод, который конкат обязан был не делать.',
  );
}

/** Что ИЗМЕРЕНО на готовом финале. Ни одного поля, выведенного из профиля или из плана. */
export interface MeasuredFinal {
  /** `frameCount(final)` — из `probeFrameCount`. */
  readonly frameCount: number;
  readonly fingerprint: StreamFingerprint;
  readonly keyframeIndices: readonly number[];
  readonly encoderSignature: string;
}

export interface VerifyAssemblyInput {
  /** Сетка времени: `projectSampleRate` и `fps` из `compile-profile/1`. */
  readonly grid: TimeGrid;
  /** `Σ durationInFrames` — сумма заявленных длительностей сегментов. */
  readonly declaredFrames: number;
  /** Длина дорожки ролика в сэмплах (`M-03`, `PcmS16.samples.length`). */
  readonly sampleCount: number;
  /** `pixelProfile.gopSize` — единственное, что здесь приходит из профиля. */
  readonly gopSize: number;
  /** Всё измеренное — уже снятое приборами (`ffprobe.ts`, `readEncoderSignature`). */
  readonly measured: MeasuredFinal;
  readonly firstSegment: {
    readonly fingerprint: StreamFingerprint;
    readonly encoderSignature: string;
  };
}

/**
 * Все проверки после конката за один вызов. Порядок значим: сначала счёт кадров (самая
 * частая ошибка и самая дешёвая для чтения), потом отпечаток, потом сетка GOP, потом подпись.
 */
export function verifyAssembly(input: VerifyAssemblyInput): void {
  assertFrameCounts({
    declaredFrames: input.declaredFrames,
    measuredFrames: input.measured.frameCount,
    audioFrames: framesForSamples(input.grid, input.sampleCount),
  });
  assertSameFingerprint(input.measured.fingerprint, input.firstSegment.fingerprint);
  assertClosedGop(
    input.measured.keyframeIndices,
    input.gopSize,
    input.measured.frameCount,
    'финал',
  );
  assertSameEncoderSignature(input.measured.encoderSignature, input.firstSegment.encoderSignature);
}
