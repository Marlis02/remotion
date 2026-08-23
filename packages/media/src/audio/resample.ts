// Ресемплинг музыки — ОДИН РАЗ НА INGEST (ADR-0003 «Разделение sampleRate», ADR-0010 §9).
//
// ПРАВИЛО, КОТОРОЕ ЭТОТ ФАЙЛ ИСПОЛНЯЕТ, СФОРМУЛИРОВАНО ЧЕРЕЗ СЛЕДСТВИЕ: «музыка ресемплится
// в `projectSampleRate` один раз на ingest, с явными параметрами ресемплера в `audioProfile`
// — тогда микс становится сложением целых сэмплов, и версия ресемплера перестаёт влиять на
// выход сборки (влияет только на ingest, который уже content-addressed)». Отсюда три
// требования к коду, и все три проверяемы:
//
//   1. параметры ресемплера ВХОДЯТ В ВЫЗОВ ЯВНО — `engine` и `precision` из профиля попадают
//      в строку фильтра, а не остаются на умолчании версии ffmpeg;
//   2. ресемплинг живёт ЗДЕСЬ и только здесь — микс частоту не меняет, он её проверяет;
//   3. выход — СЫРОЙ s16le, без контейнера. Контейнер притащил бы `LIST`-чанк с именем и
//      версией энкодера, и два прогона одной версии перестали бы совпадать побайтово из-за
//      метаданных, а не из-за звука.
//
// ЧТО ОСТАЁТСЯ ОТКРЫТЫМ И ГДЕ ЗАКРЫВАЕТСЯ. Детерминизм МЕЖДУ версиями ffmpeg — `UNKNOWN` U8,
// адрес `X-02` (roadmap §11.2 п. 15; критерий той задачи — «sha256 PCM совпадает на двух
// версиях ffmpeg»). Здесь сделано то, что смягчает: параметры явные, метаданные вырезаны,
// версия сборки возвращается вызывающему, а сам блоб адресуется содержимым (`M-01`) — смена
// версии видна как другой sha, а не как тихо другой звук.

import { open } from 'node:fs/promises';

import type { AudioProfile } from '@vpe/schema';

import { AudioError } from './errors.js';
import { DEFAULT_FFMPEG_PATH, FfmpegError, readFfmpegBuild, runFfmpeg, type FfmpegBuild } from './ffmpeg.js';
import { pcmFromBytes, type PcmS16 } from './pcm.js';
import { assertNotMp3 } from './v6.js';

/**
 * Движки, которые мы умеем звать. Ровно один — тот, что стоит в профиле.
 *
 * Белый список, а не «подставим как есть»: незнакомое имя в `engine` иначе уехало бы в
 * командную строку ffmpeg, и тот либо выбрал бы СВОЙ ресемплер по умолчанию, либо принял бы
 * имя как чужой параметр. Обе ветки — тихая подмена профиля.
 */
export const KNOWN_RESAMPLER_ENGINES = ['soxr'] as const;

/** Сколько байт файла нужно, чтобы узнать контейнер (V6). Больше читать незачем. */
const MAGIC_BYTES = 4;

export interface ResampleOptions {
  /** Путь к входному файлу. Читает его ffmpeg, не мы. */
  readonly inputPath: string;
  /** `audioProfile.resampler` — параметры входят в вызов явно. */
  readonly resampler: AudioProfile['resampler'];
  /** `compileProfile.projectSampleRate` — целевая частота тракта. */
  readonly projectSampleRate: number;
}

/**
 * Аргументы вызова — ЧИСТАЯ функция. Голден-тест стоит на массиве целиком: аргументы и есть
 * то, что отделяет «профиль исполнен» от «ffmpeg что-то решил сам».
 *
 * Смысл каждого куска:
 *   `-nostdin`                 — подпроцесс не претендует на наш stdin;
 *   `-loglevel error`          — в `stderr` попадает только то, что мешает;
 *   `-vn -map_metadata -1 -map_chapters -1` — обложка, теги и главы входного файла в тракт
 *                                не идут: они не звук, но они байты, и они меняются;
 *   `-fflags +bitexact -flags +bitexact` — запрет на «отпечаток кодировщика» где бы то ни было;
 *   `-af aresample=…`          — ЕДИНСТВЕННОЕ место ресемплинга, с параметрами из профиля;
 *   `-ac 1`                    — сведение в моно (формат тракта);
 *   `-f s16le -`               — сырой поток в stdout, без контейнера.
 */
export function resampleArgs(options: ResampleOptions): string[] {
  const { engine, precision } = options.resampler;
  if (!(KNOWN_RESAMPLER_ENGINES as readonly string[]).includes(engine)) {
    throw new AudioError(
      'ADR-0003 «Разделение sampleRate»',
      `\`resampler.engine\` = \`${engine}\`: тракт умеет звать только ` +
        `${KNOWN_RESAMPLER_ENGINES.map((name) => `\`${name}\``).join(', ')}. Незнакомое имя ` +
        'уехало бы в командную строку, и ресемплер выбрался бы по умолчанию версии ffmpeg — ' +
        'то есть профиль исполнялся бы не тем, что в нём написано.',
    );
  }
  const filter =
    `aresample=resampler=${engine}` +
    `:precision=${String(precision)}` +
    `:out_sample_rate=${String(options.projectSampleRate)}`;
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    options.inputPath,
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
    filter,
    '-ac',
    '1',
    '-f',
    's16le',
    '-',
  ];
}

export interface IngestOptions {
  readonly inputPath: string;
  readonly audioProfile: AudioProfile;
  readonly projectSampleRate: number;
  /** Путь к бинарнику. Вход, а не `process.env`: см. шапку `ffmpeg.ts`. */
  readonly ffmpegPath?: string;
}

export interface IngestResult {
  /** Дорожка тракта: s16le, моно, уже `projectSampleRate`. */
  readonly pcm: PcmS16;
  /** Сборка ffmpeg, которой это сделано. В отчёт — да, в артефакт — нет (K6). */
  readonly ffmpeg: FfmpegBuild;
  /** Аргументы вызова целиком — чтобы «параметры вошли явно» было наблюдаемо в отчёте. */
  readonly args: readonly string[];
}

/** Первые байты файла — ровно столько, сколько нужно охраннику V6. */
async function readMagic(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = new Uint8Array(MAGIC_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAGIC_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Ingest музыкального ассета: проверка **V6** на входе, ресемплинг в `projectSampleRate`
 * параметрами профиля, сырой PCM на выходе.
 *
 * Порядок проверок значим: mp3 отвергается ДО запуска ffmpeg (иначе тракт молча
 * декодировал бы то, чего внутри пайплайна не бывает), а сборка ffmpeg проверяется ДО
 * ресемплинга (иначе расхождение обнаружилось бы байтами, а не сообщением).
 */
export async function ingestMusic(options: IngestOptions): Promise<IngestResult> {
  const ffmpegPath = options.ffmpegPath ?? DEFAULT_FFMPEG_PATH;
  assertNotMp3(await readMagic(options.inputPath), options.inputPath);

  const build = await readFfmpegBuild(ffmpegPath);
  const { engine } = options.audioProfile.resampler;
  if (engine === 'soxr' && !build.hasSoxr) {
    throw new FfmpegError(
      `\`${ffmpegPath}\` (версия ${build.version}) собран без \`--enable-libsoxr\`, а ` +
        '`audioProfile.resampler.engine` = `soxr`. Такой ffmpeg не откажет — он молча ' +
        'возьмёт свой ресемплер по умолчанию, то есть отдаст другой звук по тому же ' +
        'профилю. Нужен ffmpeg, собранный с libsoxr.',
      ['-version'],
      build.configuration,
    );
  }

  const args = resampleArgs({
    inputPath: options.inputPath,
    resampler: options.audioProfile.resampler,
    projectSampleRate: options.projectSampleRate,
  });
  const run = await runFfmpeg(args, ffmpegPath);
  return { pcm: pcmFromBytes(options.projectSampleRate, run.stdout), ffmpeg: build, args };
}
