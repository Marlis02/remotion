// Конкат сегментов `-c copy` и ЕДИНСТВЕННЫЙ энкод аудио — одна команда ffmpeg.
//
// ДВЕ ПОЛОВИНЫ ОДНОГО ПРАВИЛА (ADR-0008, «Сборка, однозначно»):
//   * **ВИДЕО кодируется ровно один раз** — при кодировании сегмента (`encode.ts`);
//     здесь только `-c:v copy`, второго энкода видео нет (**R10**);
//   * **АУДИО кодируется ровно один раз** — здесь, при муксе финала; весь тракт до этого
//     в PCM (V6, `M-03`).
// Обе половины исполняет ОДИН вызов ffmpeg. Разнести их на два (сначала конкат в `.mts`,
// потом мукс в `.mp4`) значило бы записать видео-битстрим на диск лишний раз и завести второй
// шов, на котором `-c copy` пришлось бы доказывать заново.
//
// ПОЧЕМУ ДЕМУКСЕР, А НЕ `concat:`-ПРОТОКОЛ (решение владельца, `M-04`, вопрос 2).
//
// Исходное основание было ОШИБОЧНЫМ, и это записано здесь, а не спрятано. Предполагалось:
// у каждого `.mts` свой отсчёт времени (`FACT`: `start_pts = 132000`, то есть 1.466667 с —
// умолчание мультиплексора MPEG-TS у ОБОИХ файлов), поэтому байтовая склейка сбросит шкалу
// назад и `frameCount` финала разойдётся с **R8** молча. ИЗМЕРЕНИЕ ЭТОГО НЕ ПОДТВЕРДИЛО:
// `FACT` (`M-04`, ffmpeg 6.1.1) протокол дал ровно те же 150 кадров и `duration = 5.000000`
// на двух сегментах и 240 кадров / 8.000000 на трёх — столько же, сколько демуксер.
//
// Что измерение показало ВМЕСТО этого, и почему решение всё равно демуксер. На каждом шве
// протокол печатает `Packet corrupt (stream = 0, dts = …)`, `corrupt input packet in stream 0`
// и `timestamp discontinuity (stream id=256): -3000000, new offset= 3000000`: он не читает
// склеенный файл как корректный поток, а ЧИНИТ его — распознаёт разрыв и компенсирует
// смещение эвристикой. Демуксер на том же входе не печатает ни одной строки: он открывает
// каждый файл отдельно и сдвигает таймстемпы на накопленную длительность явно.
// Разница, таким образом, не в результате, а в том, ЧЕМ результат обеспечен: у демуксера —
// арифметикой контейнера, у протокола — восстановлением после ошибки. Сборка, чья точность
// до кадра держится на эвристике разрыва, не годится под **R8**, где расхождение в один кадр
// валит ролик. Цена демуксера, названная честно: файл-список на диске и экранирование путей.

import type { AudioProfile } from '@vpe/schema';

import { runFfmpeg, DEFAULT_FFMPEG_PATH } from '../audio/ffmpeg.js';
import { KNOWN_RESAMPLER_ENGINES } from '../audio/resample.js';
import { writeAtomic } from '../store/atomic.js';
import { AssembleError } from './errors.js';
import { SEGMENT_EXTENSION } from './encode.js';

/** Расширение финала. ADR-0005 §8 (раскладка `build/`) и `core.md` §21.2: `final.mp4`. */
export const FINAL_EXTENSION = '.mp4';

/** Имя формата у ffmpeg для того же контейнера. */
export const FINAL_FORMAT = 'mp4';

/** Аудио-кодеки, которые мы умеем звать, и имя энкодера для каждого (по образцу видео). */
export const KNOWN_AUDIO_ENCODERS: Readonly<Record<string, string>> = Object.freeze({
  aac: 'aac',
});

/**
 * Флаги, которых в аргументах конката быть НЕ МОЖЕТ, — исполнимая форма **R10**.
 *
 * Список закрыт по признаку «этот флаг заставляет ffmpeg декодировать и кодировать видео
 * заново». Он намеренно ШИРЕ, чем `-c:v <не copy>`: `-vf` и `-s` не выглядят энкодерными,
 * но любой из них снимает `copy` и включает энкодер, а `-r` переписывает таймстемпы, то есть
 * ломает R8 иначе. Проверка — по ИМЕНАМ аргументов, а не по строке команды целиком: строка
 * склеивается перед печатью и в ней `-crf` внутри пути неотличим от флага.
 */
export const FORBIDDEN_CONCAT_ARGS: readonly string[] = Object.freeze([
  '-b:v',
  '-vb',
  '-crf',
  '-qp',
  '-preset',
  '-tune',
  '-profile:v',
  '-level',
  '-g',
  '-keyint_min',
  '-sc_threshold',
  '-rc-lookahead',
  '-aq-mode',
  '-psy',
  '-x264-params',
  '-x264opts',
  '-pix_fmt',
  '-vf',
  '-filter:v',
  '-filter_complex',
  '-s',
  '-r',
  '-flags:v',
  '-colorspace',
  '-color_primaries',
  '-color_trc',
]);

/** Как в аргументах записан «копировать видео». Одна константа на код и на тест. */
export const VIDEO_COPY_ARGS: readonly string[] = Object.freeze(['-c:v', 'copy']);

/**
 * **R10** в исполнимой форме: в аргументах конката есть `-c:v copy` и нет ни одного флага,
 * который включил бы энкодер видео.
 *
 * Это ровно тот «тест командной строки ffmpeg», который называет строка реестра. Вторая
 * половина охранника — измеренная (подпись энкодера из потока, `verify.ts`).
 */
export function assertNoVideoEncodeArgs(args: readonly string[]): void {
  const found = args.filter((arg) => FORBIDDEN_CONCAT_ARGS.includes(arg));
  if (found.length > 0) {
    throw new AssembleError(
      'R10',
      `в аргументах конката есть флаги энкода видео: ${found.map((a) => `\`${a}\``).join(', ')}. ` +
        'Видео кодируется РОВНО ОДИН РАЗ — при кодировании сегмента (ADR-0008 «Сборка»); ' +
        'конкат только `-c copy`.',
    );
  }
  const at = args.indexOf(VIDEO_COPY_ARGS[0] as string);
  if (at < 0 || args[at + 1] !== VIDEO_COPY_ARGS[1]) {
    throw new AssembleError(
      'R10',
      'в аргументах конката нет `-c:v copy`. Без него ffmpeg берёт энкодер по умолчанию ' +
        'контейнера и перекодирует видео молча — второй энкод, невидимый в отчёте.',
    );
  }
}

/**
 * Одна строка файла-списка демуксера.
 *
 * Экранирование — по правилу самого демуксера: одинарные кавычки вокруг пути, а кавычка
 * внутри пути закрывает строку, ставит экранированную и открывает снова (`'\''`). Путь с
 * кавычкой в имени — не выдумка: `tmpDir` приходит входом и его имя нам не принадлежит.
 */
export function concatListLine(segmentPath: string): string {
  return `file '${segmentPath.split("'").join("'\\''")}'`;
}

/** Содержимое файла-списка целиком. Чистая функция — стоит под голден-тестом. */
export function concatListText(segmentPaths: readonly string[]): string {
  if (segmentPaths.length === 0) {
    throw new AssembleError('R8', 'список сегментов пуст: собирать нечего');
  }
  for (const segmentPath of segmentPaths) {
    if (!segmentPath.endsWith(SEGMENT_EXTENSION)) {
      throw new AssembleError(
        'R10',
        `\`${segmentPath}\`: конкат \`-c copy\` определён для промежуточного контейнера ` +
          `\`${SEGMENT_EXTENSION}\` (ADR-0008 «Сборка»). Файл другого контейнера в списке ` +
          'означает, что сегмент кодировал не этот модуль.',
      );
    }
  }
  return `${segmentPaths.map(concatListLine).join('\n')}\n`;
}

export interface ConcatMuxOptions {
  /** Путь к уже записанному файлу-списку демуксера. */
  readonly listPath: string;
  /** WAV с дорожкой ролика: PCM s16le моно `projectSampleRate` (`M-03`). */
  readonly audioPath: string;
  /** `audio-profile/1` целиком: кодек, битрейт, частота доставки, параметры ресемплера. */
  readonly audioProfile: AudioProfile;
  /** Путь финала. Расширение обязано быть `.mp4`. */
  readonly outputPath: string;
}

/**
 * Аргументы конката и мукса — ЧИСТАЯ функция.
 *
 * Смысл каждого куска:
 *   `-f concat -safe 0 -i list` — демуксер; `-safe 0` нужен для абсолютных путей в списке;
 *   `-i audio.wav`              — вторым входом дорожка ролика целиком (T5: она непрерывна);
 *   `-map 0:v:0 -map 1:a:0`     — ровно два потока на выходе, и ни одного «прицепом»;
 *   `-c:v copy`                 — **R10**;
 *   `-af aresample=…`           — ЕДИНСТВЕННОЕ место, где тракт (24000) встречается с
 *                                 доставкой (48000); параметры ресемплера — из профиля явно,
 *                                 по решению владельца (`M-04`, вопрос 4b) и по логике `M-03`:
 *                                 умолчание версии ffmpeg исполняет профиль не дословно;
 *   `-c:a`, `-b:a`              — единственный энкод аудио, кодек и битрейт из профиля;
 *   `-fflags +bitexact`         — из файла уходит строка сборки ffmpeg. БЕЗУСЛОВНО, а не из
 *                                 профиля: поля, которое этим управляло бы, в схеме нет
 *                                 (`encoder.bitexact` живёт в `pixelProfile` и относится к
 *                                 энкодеру видео, которого здесь нет), а артефакт, несущий
 *                                 версию сборки, ломает AC4 на ровном месте;
 *   `-f mp4`                    — контейнер финала (ADR-0005 §8, `core.md` §21.2).
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. `-movflags +faststart` не ставится (решение владельца, вопрос 4c):
 * он делает второй проход по готовому файлу ради веб-раздачи, ADR о нём молчит, и заводить
 * «второй проход» в задаче про единственность энкода молча — плохая идея. Долг заведён.
 */
export function concatMuxArgs(options: ConcatMuxOptions): string[] {
  const { audioProfile } = options;
  const encoderName = KNOWN_AUDIO_ENCODERS[audioProfile.codec];
  if (encoderName === undefined) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`audioProfile.codec\` = \`${audioProfile.codec}\`: мукс умеет звать только ` +
        `${Object.keys(KNOWN_AUDIO_ENCODERS)
          .map((name) => `\`${name}\``)
          .join(', ')}.`,
    );
  }
  const { engine, precision } = audioProfile.resampler;
  if (!(KNOWN_RESAMPLER_ENGINES as readonly string[]).includes(engine)) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`audioProfile.resampler.engine\` = \`${engine}\`: мукс умеет звать только ` +
        `${KNOWN_RESAMPLER_ENGINES.map((name) => `\`${name}\``).join(', ')}. Незнакомое имя ` +
        'уехало бы в командную строку, и ресемплер выбрался бы по умолчанию версии ffmpeg.',
    );
  }
  if (!options.outputPath.endsWith(FINAL_EXTENSION)) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`outputPath\` = \`${options.outputPath}\`: контейнер финала — \`${FINAL_EXTENSION}\` ` +
        '(ADR-0005 §8, раскладка `build/`).',
    );
  }

  const filter =
    `aresample=resampler=${engine}` +
    `:precision=${String(precision)}` +
    `:out_sample_rate=${String(audioProfile.deliverySampleRate)}`;

  const args = [
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
    options.listPath,
    '-i',
    options.audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...VIDEO_COPY_ARGS,
    '-af',
    filter,
    '-c:a',
    encoderName,
    '-b:a',
    `${String(audioProfile.bitrateKbps)}k`,
    '-fflags',
    '+bitexact',
    '-f',
    FINAL_FORMAT,
    options.outputPath,
  ];
  // Охранник стоит на СОБСТВЕННОМ выходе функции, а не только в тесте: правка этого файла,
  // добавившая энкодер-флаг, обязана падать в рантайме, а не ждать, пока кто-то перечитает тест.
  assertNoVideoEncodeArgs(args);
  return args;
}

export interface ConcatMuxRun {
  readonly path: string;
  readonly args: readonly string[];
  readonly listText: string;
  readonly stderr: string;
}

export interface ConcatAndMuxOptions extends Omit<ConcatMuxOptions, 'listPath'> {
  readonly segmentPaths: readonly string[];
  /** Куда положить файл-список демуксера. Обычно `tmpDir`; пишется атомарно (K7). */
  readonly listPath: string;
  readonly ffmpegPath?: string;
}

/** Пишет список, зовёт ffmpeg один раз, возвращает наблюдаемое: аргументы и список целиком. */
export async function concatAndMux(options: ConcatAndMuxOptions): Promise<ConcatMuxRun> {
  const listText = concatListText(options.segmentPaths);
  await writeAtomic(options.listPath, new TextEncoder().encode(listText));

  const args = concatMuxArgs(options);
  const run = await runFfmpeg(args, options.ffmpegPath ?? DEFAULT_FFMPEG_PATH);
  return { path: options.outputPath, args, listText, stderr: run.stderr };
}
