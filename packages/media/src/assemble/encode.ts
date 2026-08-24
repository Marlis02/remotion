// Кодирование сегмента: кадры-картинки → `h264` в MPEG-TS, БЕЗ аудио-дорожки (**R5**).
//
// ПОЧЕМУ ЭТОТ ШАГ ВООБЩЕ СУЩЕСТВУЕТ У `media`. `FACT` (SP-3d §4.3): штатный энкодер рендерера
// **не выставляет** `-sc_threshold 0`, а без него сцена внутри сегмента вставляет незапланированный
// I-кадр и сбивает сетку GOP — то, на чём стоит `concat -c copy`. Поэтому сегменты под конкат
// кодирует НАШ ffmpeg (roadmap §4 «`M-04`», раздел «Риск, названный заранее»), а рендерер отдаёт
// кадры. Прямое следствие: `pixelProfile.imageFormat`/`jpegQuality` — это формат ПЕРЕДАЧИ кадров,
// и здесь он исполняется, а не остаётся мёртвым полем (решение владельца, `M-04`, вопрос 1).
//
// РИСК ВОСПРОИЗВЕДЁН ИЗМЕРЕНИЕМ, А НЕ ПРОЦИТИРОВАН. `FACT` (`M-04`, ffmpeg 6.1.1): на
// последовательности с жёсткой склейкой на кадре 46 ключевые кадры без `-sc_threshold 0`
// встают на 0, 30, **45**, 75; с ним — ровно 0, 30, 60. На «спокойном» источнике разницы НЕТ
// ни одной — поэтому негативный тест обязан иметь склейку сцены внутри, иначе он стережёт
// пустое место (требование владельца, `M-04`).
//
// ВСЁ, ЧТО МЕНЯЕТ ПИКСЕЛИ, ПРИХОДИТ ИЗ `render-profile/1`, И БОЛЬШЕ НИОТКУДА. Умолчаний версии
// ffmpeg здесь нет ни одного: незаполненный параметр — это параметр, который выбрал энкодер,
// а ADR-0008 «Сборка» требует ровно обратного. Единственное, чего в `render-profile/1` нет и
// быть не должно, — `fps`: он живёт в `compile-profile/1` (ADR-0003, «fps = 30 — решение»).
//
// АРГУМЕНТЫ — ЧИСТАЯ ФУНКЦИЯ (образец — `resampleArgs`, `M-03`). Голден-вектор стоит на массиве
// целиком: аргументы и есть то, что отделяет «профиль исполнен» от «ffmpeg что-то решил сам».

import type { Fps } from '@vpe/core-model';
import type { RenderProfile } from '@vpe/schema';

import { runFfmpeg, DEFAULT_FFMPEG_PATH, type FfmpegRun } from '../audio/ffmpeg.js';
import { AssembleError } from './errors.js';
import { probeFrameCount, probeHasAudio, type ProbeOptions } from './ffprobe.js';

/** Расширение промежуточного контейнера сегментов (ADR-0008 «Сборка»: `h264-ts`/`.mts`). */
export const SEGMENT_EXTENSION = '.mts';

/** Имя формата у ffmpeg для того же контейнера. */
export const SEGMENT_FORMAT = 'mpegts';

/**
 * Кодеки, которые мы умеем звать, и имя ЭНКОДЕРА для каждого.
 *
 * Белый список, а не «подставим как есть» — та же причина, что у `KNOWN_RESAMPLER_ENGINES`
 * (`M-03`): `codec` из профиля называет КОДЕК (`h264`), а командная строка требует имя
 * энкодера (`libx264`), и это не одно и то же. Незнакомое имя, уехавшее в `-c:v` как есть,
 * либо не запустилось бы, либо выбрало бы другой энкодер того же кодека — вторую реализацию
 * с другим битстримом при том же профиле.
 */
export const KNOWN_VIDEO_ENCODERS: Readonly<Record<string, string>> = Object.freeze({
  h264: 'libx264',
});

/**
 * Значение `tune`, означающее «тюна нет».
 *
 * `FACT` (`M-04`): `-tune none` — ОШИБКА x264 (`invalid tune 'none'`), а не «без тюна».
 * Все три профиля фикстуры несут `tune: none`, то есть буквальная подстановка поля в
 * командную строку не собрала бы ни одного сегмента.
 */
export const TUNE_NONE = 'none';

/** Расширение файла кадра по `pixelProfile.imageFormat`. Пара закрыта схемой (`jpeg|png`). */
const FRAME_EXTENSION: Readonly<Record<RenderProfile['pixelProfile']['imageFormat'], string>> =
  Object.freeze({ jpeg: '.jpg', png: '.png' });

export interface SegmentEncodeOptions {
  /**
   * Шаблон имени кадра в форме ffmpeg: `…/frame%06d.png`. Именно шаблон, а не каталог:
   * ширина счётчика — часть договора с тем, кто кадры пишет.
   */
  readonly framePattern: string;
  /** Номер первого кадра последовательности. */
  readonly startNumber: number;
  /** Сколько кадров обязано войти в сегмент. Измеренное число сверяется с ним же. */
  readonly frameCount: number;
  /** `compileProfile.fps` — точная дробь (ADR-0003 T2), а не число. */
  readonly fps: Fps;
  /** `render-profile/1 → pixelProfile` целиком. Поля не пересобираются вызывающим. */
  readonly pixelProfile: RenderProfile['pixelProfile'];
  /** Путь готового сегмента. Расширение обязано быть `.mts`. */
  readonly outputPath: string;
}

/** Дробь ffmpeg: `-framerate 30/1`. Точная пара, а не `num/den` в double. */
function fpsArg(fps: Fps): string {
  return `${String(fps.num)}/${String(fps.den)}`;
}

/**
 * Аргументы кодирования сегмента — ЧИСТАЯ функция.
 *
 * Смысл каждого куска:
 *   `-nostdin`, `-loglevel error` — как в `M-03`: подпроцесс не претендует на stdin, в `stderr`
 *                                   попадает только то, что мешает;
 *   `-framerate`, `-start_number`, `-i` — вход: последовательность картинок;
 *   `-frames:v`                   — сколько кадров обязано выйти; лишние кадры каталога в
 *                                   сегмент не попадают молча;
 *   `-an`                         — **R5**: аудио-дорожки в сегменте нет. Явно, а не «её и так
 *                                   нет»: у входа-картинок звука нет, но правило обязано быть
 *                                   в командной строке, чтобы его можно было снять и увидеть падение;
 *   `-c:v`, `-crf`, `-preset`, `-tune`, `-threads`, `-rc-lookahead`, `-aq-mode`, `-psy`
 *                                 — полная строка энкодера из профиля (находка C5);
 *   `-g`, `-keyint_min`, `-sc_threshold 0`, `-x264-params open-gop=0`
 *                                 — GOP задаёт профиль, а не энкодер (ADR-0008 «Сборка»);
 *   `-fps_mode cfr`               — постоянная частота кадров: число кадров на выходе обязано
 *                                   равняться числу кадров на входе, а не тому, что решит ffmpeg;
 *   `-pix_fmt`, `-colorspace`, `-color_primaries`, `-color_trc` — колориметрия из профиля;
 *   `-fflags/-flags:v +bitexact`  — при `encoder.bitexact`; запрет на «отпечаток сборки»
 *                                   в контейнере (`FLAKY-по-контейнеру`, ADR-0008);
 *   `-f mpegts`                   — промежуточный контейнер (`FACT` r2 §7.3).
 *
 * ЧТО НЕ ДЕЛАЕТСЯ ЯВНО И ПОЧЕМУ. `open-gop=0` — измеренное умолчание x264 (`FACT` `M-04`:
 * SEI показывает `open_gop=0` и без флага), и флаг стоит здесь как страховка от смены
 * умолчания, а не как правка поведения.
 */
export function segmentEncodeArgs(options: SegmentEncodeOptions): string[] {
  const { pixelProfile } = options;
  const encoderName = KNOWN_VIDEO_ENCODERS[pixelProfile.codec];
  if (encoderName === undefined) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`pixelProfile.codec\` = \`${pixelProfile.codec}\`: сборка умеет звать только ` +
        `${Object.keys(KNOWN_VIDEO_ENCODERS)
          .map((name) => `\`${name}\``)
          .join(', ')}. Незнакомое имя уехало бы в \`-c:v\` как есть, и энкодер выбрался бы ` +
        'по умолчанию версии ffmpeg — то есть профиль исполнялся бы не тем, что в нём написано.',
    );
  }
  assertFrameCount(options.frameCount);
  assertFramePattern(options.framePattern, pixelProfile.imageFormat);
  assertSegmentPath(options.outputPath);

  const encoder = pixelProfile.encoder;
  const gop = String(pixelProfile.gopSize);
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    fpsArg(options.fps),
    '-start_number',
    String(options.startNumber),
    '-i',
    options.framePattern,
    '-frames:v',
    String(options.frameCount),
    // R5. Стоит РАНЬШЕ параметров видео, чтобы в отчёте его было видно сразу.
    '-an',
    '-c:v',
    encoderName,
    '-crf',
    String(pixelProfile.crf),
    '-preset',
    encoder.preset,
  ];
  if (encoder.tune !== TUNE_NONE) args.push('-tune', encoder.tune);
  args.push(
    '-threads',
    String(encoder.threads),
    '-rc-lookahead',
    String(encoder.rcLookahead),
    '-aq-mode',
    String(encoder.aqMode),
    '-psy',
    String(encoder.psy),
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-sc_threshold',
    '0',
    '-x264-params',
    'open-gop=0',
    '-fps_mode',
    'cfr',
    '-pix_fmt',
    pixelProfile.pixelFormat,
    // Одно поле профиля — три флага. Это `INFERENCE`, и он выписан в отчёте `M-04` кандидатом
    // в правку ADR-0005 §9: `FACT` этой сессии — при одном лишь `-colorspace` файл выходит
    // помеченным наполовину (`color_space: bt709`, а `color_primaries` и `color_transfer`
    // отсутствуют). Половинная разметка колориметрии в публикуемом ролике — дефект, а не
    // осторожность, поэтому три флага; в отпечаток (R9) при этом входит только `colorSpace`,
    // ровно как называет ADR-0008.
    '-colorspace',
    pixelProfile.colorSpace,
    '-color_primaries',
    pixelProfile.colorSpace,
    '-color_trc',
    pixelProfile.colorSpace,
  );
  if (encoder.bitexact) args.push('-fflags', '+bitexact', '-flags:v', '+bitexact');
  args.push('-f', SEGMENT_FORMAT, options.outputPath);
  return args;
}

function assertFrameCount(frameCount: number): void {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`frameCount\` = ${String(frameCount)}: ожидалось целое > 0`,
    );
  }
}

/**
 * Шаблон обязан соответствовать `pixelProfile.imageFormat`.
 *
 * Без этой проверки поле профиля не исполняет никто: ffmpeg определяет формат картинки по
 * содержимому и молча съест PNG при `imageFormat: jpeg`. Тогда `jpegQuality` из того же
 * профиля тоже не значит ничего — а именно этим полем обосновано решение «кадры картинками»
 * (вопрос 1).
 */
function assertFramePattern(pattern: string, imageFormat: RenderProfile['pixelProfile']['imageFormat']): void {
  const expected = FRAME_EXTENSION[imageFormat];
  const alternative = imageFormat === 'jpeg' ? '.jpeg' : expected;
  if (!pattern.endsWith(expected) && !pattern.endsWith(alternative)) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`framePattern\` = \`${pattern}\` при \`imageFormat: ${imageFormat}\`: ожидалось ` +
        `окончание \`${expected}\`. ffmpeg определяет формат по содержимому и принял бы ` +
        'чужую картинку молча — тогда `imageFormat` и `jpegQuality` профиля не исполнял бы никто.',
    );
  }
  if (!/%0\d*d/.test(pattern)) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`framePattern\` = \`${pattern}\`: в шаблоне нет счётчика вида \`%06d\``,
    );
  }
}

function assertSegmentPath(outputPath: string): void {
  if (!outputPath.endsWith(SEGMENT_EXTENSION)) {
    throw new AssembleError(
      'M-04 форма вызова',
      `\`outputPath\` = \`${outputPath}\`: промежуточный контейнер сегментов — ` +
        `\`h264-ts\`/\`${SEGMENT_EXTENSION}\` (ADR-0008 «Сборка»; \`FACT\` r2 §7.3: MPEG-TS ` +
        'устойчив к конкатенации). Конкат `-c copy` из mp4-сегментов — другая задача.',
    );
  }
}

/**
 * **R5** на готовом файле: аудио-дорожки в сегменте нет.
 *
 * Отдельной экспортируемой функцией, а не строчкой внутри `encodeSegment`, по двум причинам.
 * Первая: правило говорит про СЕГМЕНТ, а не про «сегмент, который сделали мы», — и проверять
 * его нужно уметь на файле, пришедшем откуда угодно (ночной прогон, кэш, чужая сборка).
 * Вторая: охранник, вызываемый только изнутри того, что сам же и произвёл, невозможно показать
 * падающим на настоящем входе — а негативный тест обязан быть на настоящем файле, а не на
 * подделанном булеве.
 */
export async function assertNoAudioTrack(probe: ProbeOptions): Promise<void> {
  if (!(await probeHasAudio(probe))) return;
  throw new AssembleError(
    'R5',
    `${probe.path}: в сегменте есть аудио-дорожка. Дорожка ролика непрерывна и кодируется ` +
      'ОДИН раз при муксе финала (ADR-0008 «Сборка», V6); звук внутри сегмента означал бы ' +
      'второй энкод аудио и шов по звуку на каждой границе сегмента.',
  );
}

export interface SegmentEncodeRun {
  readonly path: string;
  /** ИЗМЕРЕННОЕ число кадров, а не запрошенное. Совпадение с запросом проверено ниже. */
  readonly frameCount: number;
  /** Аргументы целиком — чтобы «профиль исполнен» было наблюдаемо в отчёте сборки. */
  readonly args: readonly string[];
  readonly stderr: string;
}

export interface EncodeSegmentOptions extends SegmentEncodeOptions {
  /** Пути к бинарникам. Входы, а не `process.env`: см. шапку `audio/ffmpeg.ts`. */
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

/**
 * Кодирует сегмент и ИЗМЕРЯЕТ результат: кадров ровно столько, сколько заказано, и
 * аудио-дорожки нет (**R5**).
 *
 * Проверка R5 стоит здесь, а не только после конката, потому что правило говорит про СЕГМЕНТ:
 * «`ffprobe` каждого сегмента (в ночном прогоне — всех, в обычной сборке — первого)».
 */
export async function encodeSegment(options: EncodeSegmentOptions): Promise<SegmentEncodeRun> {
  const args = segmentEncodeArgs(options);
  const run: FfmpegRun = await runFfmpeg(args, options.ffmpegPath ?? DEFAULT_FFMPEG_PATH);
  // `exactOptionalPropertyTypes` включён (tsconfig.base): необязательное поле обязано
  // ОТСУТСТВОВАТЬ, а не быть `undefined`, — иначе «путь не задан» и «путь задан значением
  // undefined» стали бы одним и тем же состоянием.
  const probe: ProbeOptions =
    options.ffprobePath === undefined
      ? { path: options.outputPath }
      : { path: options.outputPath, ffprobePath: options.ffprobePath };

  await assertNoAudioTrack(probe);

  const frameCount = await probeFrameCount(probe);
  if (frameCount !== options.frameCount) {
    throw new AssembleError(
      'R8',
      `${options.outputPath}: заказано ${String(options.frameCount)} кадров, измерено ` +
        `${String(frameCount)}. Расхождение хотя бы на кадр — падение сборки, а не округление.`,
    );
  }
  return { path: options.outputPath, frameCount, args, stderr: run.stderr };
}
