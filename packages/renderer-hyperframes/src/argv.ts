// Аргументы и окружение запуска HyperFrames — ЧИСТЫЕ ФУНКЦИИ ПРОФИЛЕЙ.
//
// НИ ОДНОГО ЛИТЕРАЛА «ПО МЕСТУ». ADR-0008, «Параллелизм»: «`--no-browser-gpu`,
// `chrome-headless-shell` явной версией, `workers` = логических ядер / 3 — все три величины
// поля `executionProfile`/`pixelProfile` профиля, а НЕ аргументы командной строки по месту».
// Отсюда форма: функция принимает профили и пути, а голден-вектор в тесте стоит на массиве
// целиком (образец — `assemble-args.test.ts` из `M-04`). Массив и есть то, что отделяет
// «профиль исполнен» от «рендерер что-то решил сам».
//
// ПОЧЕМУ `png-sequence`, А НЕ `mp4`. Правка DOC-04 в ADR-0008: рендерер отдаёт КАДРЫ. Причина
// измерена: `FACT` (SP-3d §4.3) штатный энкодер рендерера не выставляет `-sc_threshold 0`,
// а без него конкат демуксером `-c copy` перестаёт быть законным (**R10**). Поэтому mp4 у
// HyperFrames запрещён, и запрет живёт здесь — в единственном месте, где формат вообще
// называется.
//
// `--strict` БЕЗУСЛОВЕН (долг №157). ИЗМЕРЕНО (`H-01`, повторено `H-05`): без него компилятор
// рендерера на кривой разметке печатает `✗`, говорит «Continuing render despite lint issues»
// и уходит калибровать длительность браузером — 0–2 PNG из 30 за 13 минут. То есть дефект
// разметки выглядит как ЗАВИСАНИЕ, а не как ошибка, и обнаруживается по таймауту сегмента.
// С флагом (ИЗМЕРЕНО `H-05`, та же кривая композиция): отказ за 3.0 с с кодом 1.
//
// ЦЕНА ФЛАГА НАЗВАНА ОТДЕЛЬНО: `--strict` вместе с `--quiet` НЕ ПЕЧАТАЕТ НИЧЕГО (ИЗМЕРЕНО:
// ноль байт вывода при коде 1 — `presentRenderLintAbort` молчит при `effectiveQuiet`). «Exit 1
// без объяснения» отказом не считается (решение владельца `H-05`, П2), поэтому текст линта
// добирает `run.ts` отдельным вызовом `hyperframes lint` — но только на падении, и `--quiet`
// остаётся здесь: он слагаемое `engineFingerprint`, и снятие его сменило бы отпечаток ради
// диагностики, которая нужна раз в сто прогонов.
//
// ЧЕТЫРЕ `HYPERFRAMES_NO_*` — НЕ ПЕРЕСТРАХОВКА. `FACT` (SP-3c §4, SP-3d §5): CLI по умолчанию
// ходит в сеть ВНЕ рендера — проверка обновлений, телеметрия, обратная связь, AI-skills.
// Инвариант **R1** («рендерер не ходит в сеть») закрывается сетевым namespace'ом (`H-05`), но
// эти четыре переменные обязаны стоять и до него: в Docker-режиме они внутрь контейнера не
// уезжают, и там изоляция обязана быть сетевой — здесь же они единственный механизм.

import type { ExecutionProfileInput, FpsFraction, PixelProfileInput } from './contract.js';
import { RenderAdapterError } from './errors.js';

/**
 * ФИКСИРОВАННАЯ (профиль-НЕЗАВИСИМАЯ) часть строки запуска — слагаемое `engineFingerprint`
 * (`H-03`, ADR-0006 §3 «фактическая строка запуска Chrome»).
 *
 * ПОЧЕМУ ЗДЕСЬ ТОЛЬКО ЭТИ ТОКЕНЫ. Остальное, что уезжает в командную строку, — ЗНАЧЕНИЯ
 * ПРОФИЛЕЙ (`--fps`, `--workers`, `--no-browser-gpu`) и пути текущей машины
 * (`compositionDir`, `framesDir`). Значения профилей в отпечаток не входят по двум причинам
 * сразу: M9 («профиль — намерение, отпечаток — измерение») и K1 (`pixelProfile.browserGpu`
 * и `compileProfile.fps.*` уже перечислены в `views/segment.json`, второй учёт той же
 * величины запрещён ADR-0006 §3). Пути — шум машины: их содержимое меряется отдельно.
 *
 * Остаётся ровно то, что пришпилили МЫ и что при этом не видно ни в одном профиле: формат
 * вывода (`png-sequence`, **R10**) и `--quiet`. Смена любого из них — смена растеризации или
 * потока трассы при НЕИЗМЕННОМ профиле, то есть ровно тот класс тихой ошибки, ради которого
 * написан ADR-0006.
 *
 * Не мёртвая константа: `renderArgs` строится ИЗ неё (тест `argv.test.ts` требует, чтобы все
 * её токены присутствовали в выводе, а вывод не содержал фиксированных токенов сверх неё).
 */
export const FIXED_RENDER_ARGS: readonly string[] = Object.freeze([
  'render',
  '-o',
  '--format',
  'png-sequence',
  '--quiet',
  '--strict',
]);

export interface RenderArgsInput {
  /** Каталог композиции (== `bundle.path`). */
  readonly compositionDir: string;
  /** Каталог, куда лягут PNG. Внутри `tmpDir` (**R2**). */
  readonly framesDir: string;
  readonly fps: FpsFraction;
  readonly pixelProfile: PixelProfileInput;
  readonly executionProfile: ExecutionProfileInput;
}

/**
 * Аргументы `hyperframes render …`.
 *
 * @throws {RenderAdapterError} `ADR-0008 профиль` — дробная частота: CLI принимает `--fps`
 *   целым числом, и округление молча сдвинуло бы КАЖДУЮ границу субтитров (**R13**).
 */
export function renderArgs(input: RenderArgsInput): string[] {
  const { fps, pixelProfile, executionProfile } = input;

  if (fps.den !== 1) {
    throw new RenderAdapterError(
      'ADR-0008 профиль',
      `частота \`${String(fps.num)}/${String(fps.den)}\` рендерером не выражается`,
      [
        {
          rule: 'ADR-0008 профиль',
          at: 'compileProfile.fps',
          message:
            'CLI HyperFrames принимает `--fps` ЦЕЛЫМ числом; дробная частота (`30000/1001`) ' +
            'передаётся только округлением, а округление сдвинуло бы каждую границу ' +
            'субтитров относительно расчётной (**R13**) и сделало бы `n/fps` неверной ' +
            'формулой перевода времени. Это отказ, а не округление — профиль либо ' +
            'поддерживается рендерером, либо нет',
        },
      ],
    );
  }

  const [verb, outFlag, formatFlag, formatValue, quietFlag, strictFlag] = FIXED_RENDER_ARGS as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const args = [
    verb,
    input.compositionDir,
    outFlag,
    input.framesDir,
    formatFlag,
    formatValue,
    '--fps',
    String(fps.num),
    '--workers',
    String(executionProfile.workers),
  ];
  // Флаг ставится ТОЛЬКО при `browserGpu: false` — так снятие поля профиля видно в аргументах,
  // а не прячется за «мы всё равно всегда так делаем».
  if (!pixelProfile.browserGpu) args.push('--no-browser-gpu');
  args.push(quietFlag, strictFlag);
  return args;
}

export interface RenderEnvInput {
  /** Окружение процесса-родителя. Вход, а не `process.env` изнутри: см. шапку `M-03`. */
  readonly parentEnv: NodeJS.ProcessEnv;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  /**
   * Бинарь браузера, выбранный НАШИМ резолвером (`browser.ts`, долг №160).
   *
   * Отсутствует — переменная не ставится, и рендерер выбирает сам (режим до `H-05`). Так
   * тесты, которым браузер не нужен, не обязаны выдумывать путь.
   */
  readonly browserPath?: string;
  /** Свой `TMPDIR` — внутри `request.tmpDir` (**R2**). */
  readonly tmpDir?: string;
}

/**
 * Переменная, которой рендереру пришпиливается бинарь браузера.
 *
 * ИЗМЕРЕНО (`hyperframes@0.8.5`, `dist/cli.js:65272` `resolveHeadlessShellPath`): при запуске
 * она читается ВТОРОЙ, сразу после `PRODUCER_HEADLESS_SHELL_PATH`, и раньше обоих кэшей.
 */
export const BROWSER_PATH_ENV = 'HYPERFRAMES_BROWSER_PATH';

/**
 * Переменная, которая ПЕРЕБИВАЕТ нашу, — поэтому она снимается.
 *
 * Тот же `resolveHeadlessShellPath` проверяет её ПЕРВОЙ. Оставить её проезжать из родительского
 * окружения значило бы отдать выбор растеризатора чужой переменной, то есть вернуть долг №160
 * через другую дверь: `engineFingerprint` мерил бы наш бинарь, а рендерил бы чужой.
 */
export const BROWSER_PATH_ENV_OVERRIDE = 'PRODUCER_HEADLESS_SHELL_PATH';

/**
 * Окружение подпроцесса рендерера.
 *
 * `TZ=UTC`/`LC_ALL=C` — «Гарантии рендерера» ADR-0008 дословно. `HYPERFRAMES_FFMPEG_PATH`/
 * `HYPERFRAMES_FFPROBE_PATH` — решение `M-03` п. 9 и V6: ffmpeg СИСТЕМНЫЙ, пакетов
 * `ffmpeg-static`/`ffprobe-static` в проекте нет; путь передаётся значением, а не надеждой
 * на `PATH`.
 */
/**
 * ФИКСИРОВАННАЯ часть окружения подпроцесса — вторая половина слагаемого «строка запуска»
 * в `engineFingerprint` (`H-03`).
 *
 * Пути к ffmpeg/ffprobe сюда НЕ входят: они машинно-зависимы, а то, что за ними стоит,
 * меряется отпечатком отдельными полями (`ffmpeg`/`ffprobe` — первая строка `-version`).
 * `renderEnv` строится ИЗ этой константы, поэтому разъехаться они не могут.
 */
export const FIXED_RENDER_ENV: Readonly<Record<string, string>> = Object.freeze({
  TZ: 'UTC',
  LC_ALL: 'C',
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
  HYPERFRAMES_NO_FEEDBACK: '1',
  HYPERFRAMES_SKIP_SKILLS: '1',
});

export function renderEnv(input: RenderEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...input.parentEnv,
    ...FIXED_RENDER_ENV,
    HYPERFRAMES_FFMPEG_PATH: input.ffmpegPath,
    HYPERFRAMES_FFPROBE_PATH: input.ffprobePath,
  };
  // Снимается ВСЕГДА, а не только когда мы ставим свою: «чужая переменная перебивает выбор
  // растеризатора» — дефект независимо от того, выбрали мы бинарь или нет.
  delete env[BROWSER_PATH_ENV_OVERRIDE];
  if (input.browserPath !== undefined) env[BROWSER_PATH_ENV] = input.browserPath;
  // `TMPDIR` внутри `tmpDir` запроса: временные файлы рендерера — тоже запись на диск, и
  // **R2** («пишет только в `outputPath` и `tmpDir`») не знает исключений для «служебных».
  if (input.tmpDir !== undefined) env['TMPDIR'] = input.tmpDir;
  return env;
}
