// ffprobe подпроцессом — ИЗМЕРЕНИЕ, и только оно.
//
// ВТОРОЙ ФАЙЛ ПАКЕТА С `node:child_process` (первый — [`audio/ffmpeg.ts`](../audio/ffmpeg.ts),
// `M-03`; его шапка поправлена одним словом в этой сессии). Разведены они не по вкусу:
// у ffprobe другой выход (JSON-текст, а не сырые байты PCM), другой критерий отказа и другое
// лечащее сообщение. Один общий `spawn` с параметром «как назвать бинарник в ошибке» скрыл бы
// ровно то, что здесь важно, — что это ПРИБОР, а не шаг тракта.
//
// ГЛАВНОЕ ПРАВИЛО ФАЙЛА: НИ ОДНО ЗНАЧЕНИЕ ОТСЮДА НЕ ПРИХОДИТ ИЗ ПРОФИЛЯ. ADR-0008 требует,
// чтобы `StreamFingerprint` был ИЗМЕРЕН, а не был эхом `render-profile/1`, — иначе сравнение
// «финал == первый сегмент» сравнивает профиль сам с собой и не может упасть никогда.
// Поэтому у функций этого файла на входе только путь к файлу и путь к бинарнику; ни одна
// не принимает профиль ни под каким именем.
//
// РАЗБОР — ЧИСТЫЕ ФУНКЦИИ. `parseStreams`, `parseVideoFingerprint`, `parseFrameCount`,
// `parseKeyframeIndices` не знают ни про процессы, ни про диск: их можно покрыть тестом на
// сохранённом JSON, а подпроцессная часть остаётся тонкой (образец — `parseFfmpegBuild`).
//
// ЧЕГО ЗДЕСЬ НЕТ: чтения `process.env`, поиска бинарника своими правилами и значений по
// умолчанию, кроме имени `ffprobe` (то есть «как его зовёт PATH»).

import { spawn } from 'node:child_process';

import { AssembleError } from './errors.js';

/** Имя по умолчанию: то, как бинарник зовётся в `PATH`. Путь целиком — вход вызывающего. */
export const DEFAULT_FFPROBE_PATH = 'ffprobe';

/** Отказ прибора. Несёт аргументы и `stderr` — без них «ffprobe упал» не лечится. */
export class FfprobeError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;

  constructor(message: string, args: readonly string[], stderr: string) {
    super(stderr === '' ? message : `${message}\nstderr: ${stderr}`);
    this.name = 'FfprobeError';
    this.args = args;
    this.stderr = stderr;
  }
}

/**
 * Отпечаток потока — ДЕСЯТЬ полей ADR-0008 («Контракт», `interface StreamFingerprint`),
 * и ни одним больше.
 *
 * Состав закрыт решением владельца (`M-04`, вопрос 3): одиннадцатое поле — это правка ADR,
 * а не решение сессии. Что намеренно НЕ входит и почему: `bit_rate`, `nb_frames`, `duration`,
 * `start_pts` описывают РАЗМЕР файла, а не поток, и у сегмента с финалом различны по
 * построению; `color_range`, `chroma_location`, `has_b_frames`, `refs`, `extradata_size` —
 * каждое лишнее поле даёт ложное падение между сборками ffmpeg вместо пойманной ошибки.
 *
 * `fpsNum`/`fpsDen` берутся из `r_frame_rate` (базовая частота), а НЕ из `avg_frame_rate`:
 * средняя частота у усечённого файла «плывёт», и R9 превратился бы в дубль R8.
 */
export interface StreamFingerprint {
  readonly codec: string;
  readonly profile: string;
  readonly level: string;
  readonly pixFmt: string;
  readonly colorSpace: string;
  readonly timeBase: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

/** Порядок полей отпечатка — один на весь пакет: сообщения об ошибках обязаны совпадать. */
export const FINGERPRINT_FIELDS = [
  'codec',
  'profile',
  'level',
  'pixFmt',
  'colorSpace',
  'timeBase',
  'width',
  'height',
  'fpsNum',
  'fpsDen',
] as const satisfies readonly (keyof StreamFingerprint)[];

/**
 * Один поток из `-show_streams`, ровно в тех полях, которые читаем.
 *
 * Тип описывает ВЫХОД ffprobe, а не наши намерения, поэтому всё необязательно: у аудио нет
 * `width`, у MPEG-TS нет `nb_frames`, а `profile`/`level` отсутствуют у потоков, где кодек
 * их не определяет. Отсутствие обязано читаться как отсутствие, а не как `undefined`,
 * молча превратившийся в `"undefined"` при сравнении.
 */
interface RawStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly profile?: string;
  readonly level?: number;
  readonly pix_fmt?: string;
  readonly color_space?: string;
  readonly color_range?: string;
  readonly time_base?: string;
  readonly width?: number;
  readonly height?: number;
  readonly r_frame_rate?: string;
  readonly avg_frame_rate?: string;
  readonly nb_read_packets?: string;
}

interface RawPacket {
  readonly flags?: string;
}

/** Запуск ffprobe. Выход — текст: у прибора не бывает сырых байт. */
export async function runFfprobe(
  args: readonly string[],
  ffprobePath = DEFAULT_FFPROBE_PATH,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Uint8Array) => {
      stdout += Buffer.from(chunk).toString('utf8');
    });
    child.stderr.on('data', (chunk: Uint8Array) => {
      stderr += Buffer.from(chunk).toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === 'ENOENT'
          ? `\`${ffprobePath}\` не найден. Сборка \`M-04\` измеряет готовый файл, а не верит ` +
            'профилю: `frameCount`, `StreamFingerprint` и отсутствие аудио-дорожки в сегменте ' +
            'приходят из ffprobe. Установите ffprobe (он идёт вместе с ffmpeg) либо передайте ' +
            'путь к нему явно — тихого пропуска у этой проверки нет.'
          : error.message;
      reject(new FfprobeError(`ffprobe не запустился: ${reason}`, args, stderr));
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new FfprobeError(`ffprobe завершился с кодом ${String(code)}`, args, stderr));
    });
  });
}

/** Разбор `-of json` в объект. Отдельной функцией: негодный JSON — отказ, а не `undefined`. */
function parseJson(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AssembleError(
      'M-04 форма вызова',
      `${what}: ffprobe вернул не JSON (${String(text.length)} Б). Прибор обязан зваться с ` +
        '`-of json`; молчаливый разбор текстового вывода регулярками — второй парсер формата.',
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssembleError('M-04 форма вызова', `${what}: ожидался объект JSON верхнего уровня`);
  }
  return value as Record<string, unknown>;
}

/** Потоки из вывода `-show_streams`. Чистая функция: вход — текст, выход — массив. */
export function parseStreams(text: string): readonly RawStream[] {
  const root = parseJson(text, '`-show_streams`');
  const streams = root['streams'];
  if (!Array.isArray(streams)) {
    throw new AssembleError('M-04 форма вызова', '`-show_streams`: в выводе нет массива `streams`');
  }
  return streams as readonly RawStream[];
}

/** Обязательное поле потока. Пропуск — отказ с именем поля: «прибор не измерил» ≠ «пусто». */
function required<T>(value: T | undefined, field: string, where: string): T {
  if (value === undefined) {
    throw new AssembleError(
      'R9',
      `${where}: ffprobe не показал \`${field}\`. Отпечаток обязан быть ИЗМЕРЕН целиком ` +
        '(ADR-0008): подстановка значения из профиля превратила бы сравнение «финал == первый ' +
        'сегмент» в сравнение профиля с самим собой.',
    );
  }
  return value;
}

/** `"30/1"` → `[30, 1]`. Форма ffprobe стабильна; всё остальное — отказ, а не `NaN`. */
function parseRatio(text: string, field: string, where: string): readonly [number, number] {
  const parts = text.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (parts.length !== 2 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
    throw new AssembleError(
      'R9',
      `${where}: \`${field}\` = \`${text}\` — ожидалась дробь вида \`30/1\``,
    );
  }
  return [num, den];
}

/** Единственный видео-поток. Их всегда ровно один: сборка не знает, что делать со вторым. */
function videoStream(streams: readonly RawStream[], where: string): RawStream {
  const video = streams.filter((stream) => stream.codec_type === 'video');
  if (video.length !== 1) {
    throw new AssembleError(
      'R9',
      `${where}: видео-потоков ${String(video.length)}, ожидался ровно один`,
    );
  }
  return video[0] as RawStream;
}

/** Отпечаток видео-потока из текста `-show_streams`. Чистая функция. */
export function parseVideoFingerprint(text: string, where: string): StreamFingerprint {
  const stream = videoStream(parseStreams(text), where);
  const rate = required(stream.r_frame_rate, 'r_frame_rate', where);
  const [fpsNum, fpsDen] = parseRatio(rate, 'r_frame_rate', where);
  return {
    codec: required(stream.codec_name, 'codec_name', where),
    profile: required(stream.profile, 'profile', where),
    // ADR-0008 объявляет `level` строкой, а ffprobe отдаёт число (`13`). Приводим здесь и
    // один раз: форма контракта важнее формы прибора, а сравнение всё равно посимвольное.
    level: String(required(stream.level, 'level', where)),
    pixFmt: required(stream.pix_fmt, 'pix_fmt', where),
    colorSpace: required(stream.color_space, 'color_space', where),
    timeBase: required(stream.time_base, 'time_base', where),
    width: required(stream.width, 'width', where),
    height: required(stream.height, 'height', where),
    fpsNum,
    fpsDen,
  };
}

/** Есть ли в файле хоть одна аудио-дорожка (**R5**). Чистая функция. */
export function parseHasAudio(text: string): boolean {
  return parseStreams(text).some((stream) => stream.codec_type === 'audio');
}

/**
 * Число видео-кадров из `-count_packets`.
 *
 * `FACT` (измерено `M-04`, ffmpeg 6.1.1): у MPEG-TS поля `nb_frames` НЕТ вовсе, а
 * `-count_packets` даёт `nb_read_packets` **без декодирования** и совпадает с `-count_frames`
 * (90 против 90 на девяноста PNG). Поэтому измеренный `frameCount` стоит копейки, а не
 * 1.345 с на сегмент — цену из таблицы бюджета AC2 платит `framemd5`, а не эта функция.
 */
export function parseFrameCount(text: string, where: string): number {
  const stream = videoStream(parseStreams(text), where);
  const packets = required(stream.nb_read_packets, 'nb_read_packets', where);
  const count = Number(packets);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new AssembleError('R8', `${where}: \`nb_read_packets\` = \`${packets}\``);
  }
  return count;
}

/**
 * Индексы ключевых кадров в порядке декодирования (0-based).
 *
 * Порядок пакетов у ffprobe — файловый, то есть порядок ДЕКОДИРОВАНИЯ; IDR своей группы идёт
 * в нём первым даже при B-пирамиде. `FACT` (измерено `M-04`): при `-g 30` и `-sc_threshold 0`
 * это ровно `0, 30, 60`.
 */
export function parseKeyframeIndices(text: string): readonly number[] {
  const root = parseJson(text, '`-show_packets`');
  const packets = root['packets'];
  if (!Array.isArray(packets)) {
    throw new AssembleError('M-04 форма вызова', '`-show_packets`: в выводе нет массива `packets`');
  }
  const indices: number[] = [];
  (packets as readonly RawPacket[]).forEach((packet, index) => {
    if ((packet.flags ?? '').includes('K')) indices.push(index);
  });
  return indices;
}

/** Общая часть каждого вызова: баннер не нужен, а всё, кроме ошибок, — шум в `stderr`. */
const QUIET = ['-hide_banner', '-v', 'error'] as const;

export interface ProbeOptions {
  readonly path: string;
  /** Путь к бинарнику. Вход, а не `process.env`: см. шапку. */
  readonly ffprobePath?: string;
}

/** Аргументы `-show_streams`. Чистая: аргументы прибора тоже стоят под голден-тестом. */
export function showStreamsArgs(path: string): string[] {
  return [...QUIET, '-show_streams', '-of', 'json', path];
}

/** Аргументы подсчёта пакетов. `-count_packets`, а не `-count_frames`: см. `parseFrameCount`. */
export function countPacketsArgs(path: string): string[] {
  return [
    ...QUIET,
    '-select_streams',
    'v:0',
    '-count_packets',
    '-show_entries',
    // `codec_type` в списке не для красоты: `-show_entries` вырезает ВСЁ остальное, и без
    // него поток перестаёт опознаваться как видео — измерено падением на первом же прогоне.
    'stream=codec_type,nb_read_packets',
    '-of',
    'json',
    path,
  ];
}

/** Аргументы перечисления пакетов: нужны только флаги, всё остальное — мегабайты вывода. */
export function showPacketFlagsArgs(path: string): string[] {
  return [
    ...QUIET,
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=flags',
    '-of',
    'json',
    path,
  ];
}

/** Измеренный отпечаток видео-потока файла. */
export async function probeStreamFingerprint(options: ProbeOptions): Promise<StreamFingerprint> {
  const text = await runFfprobe(showStreamsArgs(options.path), options.ffprobePath);
  return parseVideoFingerprint(text, options.path);
}

/** Есть ли в файле аудио-дорожка (**R5**). */
export async function probeHasAudio(options: ProbeOptions): Promise<boolean> {
  const text = await runFfprobe(showStreamsArgs(options.path), options.ffprobePath);
  return parseHasAudio(text);
}

/** Измеренное число видео-кадров (**R8**). */
export async function probeFrameCount(options: ProbeOptions): Promise<number> {
  const text = await runFfprobe(countPacketsArgs(options.path), options.ffprobePath);
  return parseFrameCount(text, options.path);
}

/** Измеренные позиции ключевых кадров (закрытость GOP). */
export async function probeKeyframeIndices(options: ProbeOptions): Promise<readonly number[]> {
  const text = await runFfprobe(showPacketFlagsArgs(options.path), options.ffprobePath);
  return parseKeyframeIndices(text);
}

/**
 * `color_range` — ИЗМЕРЯЕТСЯ, но в отпечаток НЕ входит (решение владельца, `M-04`, вопрос 3:
 * ADR-0008 называет десять полей, одиннадцатое — правка ADR, а не решение сессии).
 * Функция существует затем, чтобы «стабилен ли он у нашего энкода» был измеренным фактом
 * в отчёте, а не мнением.
 */
export async function probeColorRange(options: ProbeOptions): Promise<string | undefined> {
  const text = await runFfprobe(showStreamsArgs(options.path), options.ffprobePath);
  return videoStream(parseStreams(text), options.path).color_range;
}
