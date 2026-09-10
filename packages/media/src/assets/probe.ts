// Паспорт файла-ассета — ИЗМЕРЕНИЕ, и только оно (`ASSET-01`/`VID-01`, 2026-09-10).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Превращение вывода `ffprobe` в `intrinsic` записи `asset-record/1`: два
// вида (`image`, `video`), правила поворота, кадровой частоты, числа кадров, альфы и звука.
// Ни одного обращения к диску мимо прибора, ни одного значения из профиля, ни одного часа.
//
// ПРИБОР — ТОТ ЖЕ, ЧТО У СБОРКИ (`../assemble/ffprobe.ts`, `M-04`): `runFfprobe` и
// `parseStreams` берутся оттуда, а не пишутся заново. Задание требовало этого дословно, но
// довод старше задания и записан в шапке того файла: второй разборщик вывода ffprobe
// разошёлся бы с первым при первой правке формы. Здесь — только СВОИ вопросы к тем же
// потокам; `StreamFingerprint` соседа отвечает на другой вопрос (равны ли сегмент и финал) и
// потому имеет другой состав полей.
//
// РАЗБОР — ЧИСТЫЕ ФУНКЦИИ (`parseImageIntrinsic`, `parseVideoIntrinsic`), подпроцессная часть
// тонкая. Следствие, ради которого приём взят: правила поворота и VFR проверяются тестом на
// СОХРАНЁННОМ тексте прибора, без единого файла на диске и без ffmpeg в CI.
//
// ═══ ДЕТЕРМИНИЗМ — СВОЙСТВО, А НЕ НАДЕЖДА ═══
// Ни `Date`, ни `random`, ни `process.env`, ни путей по умолчанию (кроме имени `ffprobe`,
// то есть «как его зовёт PATH»). Два прогона на одном файле дают побайтово равный JSON —
// это охранник `ASSET-01` §3.3, а не обещание.

import { runFfprobe, parseStreams, type RawStream } from '../assemble/ffprobe.js';

/** Отказ прибора-паспортиста. Несёт адрес файла: без него «VFR» не лечится. */
export class AssetProbeError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(`${filePath}: ${message}`);
    this.name = 'AssetProbeError';
    this.filePath = filePath;
  }
}

/** Кадровая частота как её объявляет файл. Форма — поля записи `asset-record/1`. */
export interface Fps {
  readonly num: number;
  readonly den: number;
}

/** Звуковая дорожка видео-ассета либо её отсутствие. */
export interface AssetAudio {
  readonly sampleRate: number;
  readonly channels: number;
}

/** `intrinsic` вида `image` — те же два поля, что у одиннадцати живых записей репозитория. */
export interface ImageIntrinsic {
  readonly width: number;
  readonly height: number;
}

/** `intrinsic` вида `video` — четвёртая ветка `IntrinsicSchema` (`VID-01`). */
export interface VideoIntrinsic {
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly fps: Fps;
  readonly frames: number;
  readonly hasAlpha: boolean;
  readonly audio: AssetAudio | null;
}

/** Общая часть каждого вызова — та же, что у `assemble/ffprobe.ts`. */
const QUIET = ['-hide_banner', '-v', 'error'] as const;

/**
 * Аргументы паспорта: потоки ЦЕЛИКОМ, без `-show_entries`.
 *
 * `-show_entries` здесь был бы преждевременной экономией и уже однажды стоил падения
 * (комментарий у `countPacketsArgs`: без `codec_type` поток перестаёт опознаваться как
 * видео). Паспорт читают один раз на файл, и 0.033 с на `-show_streams` измерены на
 * 8-мегабайтном 1080p — экономить тут нечего.
 */
export function passportArgs(path: string): string[] {
  return [...QUIET, '-show_streams', '-of', 'json', path];
}

/**
 * Аргументы подсчёта кадров ДЕКОДОМ.
 *
 * **`-count_frames`, А НЕ `-count_packets`, И ЭТО РАЗНИЦА В СУЩЕСТВЕ.** Сосед
 * (`countPacketsArgs`) считает пакеты, потому что меряет НАШ свежий энкод, где пакет равен
 * кадру по построению. Здесь на входе чужой файл — снятый телефоном, обрезанный в редакторе,
 * скачанный наполовину, — и «пакетов» у него может быть больше кадров на битом хвосте.
 * Цена измерена: 1.17 с на 6.5-секундном 1080p H.264 (`work/in/demo.mp4`, ffmpeg 7.0.2).
 * Платится один раз при `vpe asset add` и на путь сборки не попадает.
 */
export function countFramesArgs(path: string): string[] {
  return [
    ...QUIET,
    '-select_streams',
    'v:0',
    '-count_frames',
    // `codec_type` в списке по той же причине, что у соседа: `-show_entries` вырезает всё
    // остальное, и без него поток перестаёт опознаваться как видео.
    '-show_entries',
    'stream=codec_type,nb_read_frames',
    '-of',
    'json',
    path,
  ];
}

/** Обложка — видео-поток, который видео не является: `attached_pic: 1`. */
function isAttachedPicture(stream: RawStream): boolean {
  return stream.disposition?.['attached_pic'] === 1;
}

/**
 * Единственный НАСТОЯЩИЙ видео-поток файла.
 *
 * Обложки отбрасываются: mp4 с картинкой-превью несёт два потока `codec_type: video`, и
 * «потоков два, ожидался один» было бы отказом на совершенно законном файле. Два настоящих
 * видео-потока — по-прежнему отказ: какой из них ассет, знает автор, а не движок.
 */
function videoStreamOf(streams: readonly RawStream[], filePath: string): RawStream {
  const video = streams.filter((s) => s.codec_type === 'video' && !isAttachedPicture(s));
  if (video.length !== 1) {
    throw new AssetProbeError(
      filePath,
      `видео-потоков ${String(video.length)}, ожидался ровно один (обложки не в счёт). ` +
        'Какой из нескольких потоков и есть ассет — решение автора, а не движка',
    );
  }
  return video[0] as RawStream;
}

/** Обязательное поле прибора. Пропуск — отказ с именем поля, а не `undefined` дальше. */
function required<T>(value: T | undefined, field: string, filePath: string): T {
  if (value === undefined) {
    throw new AssetProbeError(
      filePath,
      `\`ffprobe\` не показал \`${field}\`. Паспорт ассета обязан быть ИЗМЕРЕН целиком: ` +
        'подставленное значение описывало бы не этот файл',
    );
  }
  return value;
}

/** `"30000/1001"` → `{num, den}`. Всё, что не дробь, — отказ, а не `NaN`. */
function parseFps(text: string, field: string, filePath: string): Fps {
  const parts = text.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (parts.length !== 2 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0 || num <= 0) {
    throw new AssetProbeError(
      filePath,
      `\`${field}\` = \`${text}\` — ожидалась дробь вида \`30/1\` с положительными частями`,
    );
  }
  return { num, den };
}

/** Равенство дробей БЕЗ деления: `a.num/a.den == b.num/b.den` ⇔ перекрёстное произведение. */
function sameRate(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/**
 * Поворот из side-data, приведённый к `[0, 360)`.
 *
 * `ffprobe` отдаёт УГОЛ ФАЙЛА и делает это со знаком: телефон, снимающий вертикально, пишет
 * `rotation: -90`. Приведение — арифметика по модулю 360, а не выбор: `-90` и `270` — один и
 * тот же поворот, и держать в записи два его имени значило бы, что сравнение двух паспортов
 * зависит от того, кто их снимал.
 *
 * Угол, не кратный 90 (такие бывают у произвольной displaymatrix), — ОТКАЗ: геометрия
 * повёрнутого на 37° кадра не выражается парой `width`/`height` вообще никак, и молчаливое
 * округление подсунуло бы укладке неверный кадр.
 */
export function normalizeRotation(raw: number, filePath: string): 0 | 90 | 180 | 270 {
  const rounded = Math.round(raw);
  const normalized = ((rounded % 360) + 360) % 360;
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new AssetProbeError(
      filePath,
      `поворот \`${String(raw)}°\` не кратен 90 (приведённый — \`${String(normalized)}°\`). ` +
        'Геометрия такого кадра не выражается парой `width`/`height`; перекодируйте файл, ' +
        'применив поворот к пикселям: `ffmpeg -i <файл> -c:a copy <новый>`',
    );
  }
  return normalized;
}

/**
 * Есть ли альфа — ПО `pix_fmt` ГОТОВОГО ФАЙЛА (решение владельца В3, `ASSET-01`).
 *
 * `FACT` (`SP-VID` A4, долг №256): `libvpx-vp9` принимает `-pix_fmt yuva420p` без единого
 * предупреждения и альфу теряет — но теряет её и в `pix_fmt` результата (`ffprobe` показывает
 * `yuv420p`). То есть измерение ФАЙЛА честно отвечает «альфы нет», и обмануться можно было бы
 * только измерением НАМЕРЕНИЯ. Второй способ (`ffmpeg -vf alphaextract`) согласен с этим на
 * всех трёх проверенных файлах и стоит декода — поэтому он живёт в охраннике, а не здесь.
 *
 * Перечень маркеров закрыт и назван поимённо, а не выведен «в имени есть буква a»: `pal8`,
 * `ya8`, `gbrap` и `abgr` под такое правило попали бы вперемешку с `nv12a`-которого-нет.
 */
export function pixFmtHasAlpha(pixFmt: string): boolean {
  // `yuva*` (yuva420p, yuva444p10le…), `ya8`/`ya16*` (серый с альфой), `gbrap*` (планарный
  // RGB с альфой) — по началу имени; `rgba`/`argb`/`bgra`/`abgr` (включая `rgba64le`) — по
  // вхождению, потому что перед ними бывает разрядность.
  if (/^(?:yuva|ya8|ya16|gbrap)/u.test(pixFmt)) return true;
  return /(?:rgba|argb|bgra|abgr)/u.test(pixFmt);
}

/** Звук: ноль дорожек — `null`, одна — её параметры, больше — отказ. */
function audioOf(streams: readonly RawStream[], filePath: string): AssetAudio | null {
  const audio = streams.filter((s) => s.codec_type === 'audio');
  if (audio.length === 0) return null;
  if (audio.length > 1) {
    throw new AssetProbeError(
      filePath,
      `аудио-дорожек ${String(audio.length)}. Какую из них слышно в ролике — решение автора; ` +
        'сведите их в одну заранее либо возьмите файл с одной дорожкой',
    );
  }
  const stream = audio[0] as RawStream;
  const sampleRate = Number(required(stream.sample_rate, 'sample_rate', filePath));
  const channels = required(stream.channels, 'channels', filePath);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(channels) || channels <= 0) {
    throw new AssetProbeError(
      filePath,
      `звук: \`sample_rate\` = \`${String(stream.sample_rate)}\`, \`channels\` = ` +
        `\`${String(stream.channels)}\` — ожидались положительные целые`,
    );
  }
  return { sampleRate, channels };
}

/** `intrinsic` картинки из текста `-show_streams`. Чистая функция. */
export function parseImageIntrinsic(text: string, filePath: string): ImageIntrinsic {
  const stream = videoStreamOf(parseStreams(text), filePath);
  return {
    width: required(stream.width, 'width', filePath),
    height: required(stream.height, 'height', filePath),
  };
}

/** Число кадров из текста `-count_frames`. Чистая функция. */
export function parseFrameCountByDecode(text: string, filePath: string): number {
  const stream = videoStreamOf(parseStreams(text), filePath);
  const read = required(stream.nb_read_frames, 'nb_read_frames', filePath);
  const count = Number(read);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new AssetProbeError(
      filePath,
      `\`nb_read_frames\` = \`${read}\`: декод не досчитал ни одного кадра. Файл либо пуст, ` +
        'либо повреждён — сборка на нём кончилась бы отказом рендерера, а не отказом входа',
    );
  }
  return count;
}

/**
 * `intrinsic` видео из двух текстов прибора: `-show_streams` и `-count_frames`.
 *
 * ДВА ВХОДА, А НЕ ОДИН ВЫЗОВ С ОБОИМИ ФЛАГАМИ, потому что цена у них разная на три порядка
 * (0.033 с против 1.17 с), и слить их значило бы платить за декод там, где спрашивают только
 * геометрию (`vpe asset list`, картинки).
 *
 * @throws {AssetProbeError} VFR, поворот не кратный 90, потоков не один, поле не измерено.
 */
export function parseVideoIntrinsic(
  streamsText: string,
  framesText: string,
  filePath: string,
): VideoIntrinsic {
  const streams = parseStreams(streamsText);
  const stream = videoStreamOf(streams, filePath);

  const rate = parseFps(required(stream.r_frame_rate, 'r_frame_rate', filePath), 'r_frame_rate', filePath);
  const average = parseFps(
    required(stream.avg_frame_rate, 'avg_frame_rate', filePath),
    'avg_frame_rate',
    filePath,
  );
  // ═══ VFR — ОТКАЗ, И РАВЕНСТВО ТОЧНОЕ (решение владельца, `ASSET-01`) ═══
  // Переменная частота ломает кадровую сетку T-правил: «кадр номер N» перестаёт быть моментом
  // времени, и укладка клипа на сцену считалась бы по частоте, которой в файле нет ни на
  // одном участке. ДОПУСКА НЕТ НАМЕРЕННО (долг №263): «расхождение меньше промилле — принять»
  // было бы суждением, которого никто не принимал, и `30000/1001` против `2997/125` — файл
  // законный — будет отвергнут. Цена названа вслух и лечится одной командой из текста отказа.
  if (!sameRate(rate, average)) {
    throw new AssetProbeError(
      filePath,
      `частота кадров переменная (VFR): базовая \`r_frame_rate\` = ` +
        `\`${String(rate.num)}/${String(rate.den)}\`, средняя \`avg_frame_rate\` = ` +
        `\`${String(average.num)}/${String(average.den)}\`. Движок кладёт клипы на КАДРОВУЮ ` +
        'СЕТКУ (T-правила), а у VFR «кадр номер N» не является моментом времени. ' +
        'Перекодируйте в постоянную частоту: `ffmpeg -i <файл> -fps_mode cfr -r ' +
        `${String(rate.num)}/${String(rate.den)} -c:a copy <новый>\``,
    );
  }

  const rawRotation = stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation;
  const rotation = rawRotation === undefined ? 0 : normalizeRotation(rawRotation, filePath);
  const codedWidth = required(stream.width, 'width', filePath);
  const codedHeight = required(stream.height, 'height', filePath);
  // ОТОБРАЖАЕМАЯ ГЕОМЕТРИЯ: при 90/270 стороны меняются местами. `ffprobe` в `-show_streams`
  // показывает ГЕОМЕТРИЮ ПОТОКА, поворота к ней не применяя, — и вертикальное видео с
  // телефона выглядит в его выводе горизонтальным.
  const turned = rotation === 90 || rotation === 270;

  return {
    width: turned ? codedHeight : codedWidth,
    height: turned ? codedWidth : codedHeight,
    rotation,
    fps: rate,
    frames: parseFrameCountByDecode(framesText, filePath),
    hasAlpha: pixFmtHasAlpha(required(stream.pix_fmt, 'pix_fmt', filePath)),
    audio: audioOf(streams, filePath),
  };
}

/** Где лежит файл и чем его мерить. Путь к прибору — вход, а не `process.env`. */
export interface AssetProbeOptions {
  readonly path: string;
  readonly ffprobePath?: string;
}

/** Измеренный паспорт картинки. */
export async function probeImageIntrinsic(options: AssetProbeOptions): Promise<ImageIntrinsic> {
  const text = await runFfprobe(passportArgs(options.path), options.ffprobePath);
  return parseImageIntrinsic(text, options.path);
}

/** Измеренный паспорт видео — два вызова прибора, см. `parseVideoIntrinsic`. */
export async function probeVideoIntrinsic(options: AssetProbeOptions): Promise<VideoIntrinsic> {
  const streamsText = await runFfprobe(passportArgs(options.path), options.ffprobePath);
  const framesText = await runFfprobe(countFramesArgs(options.path), options.ffprobePath);
  return parseVideoIntrinsic(streamsText, framesText, options.path);
}
