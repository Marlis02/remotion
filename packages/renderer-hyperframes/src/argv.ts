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
// ЧЕТЫРЕ `HYPERFRAMES_NO_*` — НЕ ПЕРЕСТРАХОВКА. `FACT` (SP-3c §4, SP-3d §5): CLI по умолчанию
// ходит в сеть ВНЕ рендера — проверка обновлений, телеметрия, обратная связь, AI-skills.
// Инвариант **R1** («рендерер не ходит в сеть») закрывается сетевым namespace'ом (`H-05`), но
// эти четыре переменные обязаны стоять и до него: в Docker-режиме они внутрь контейнера не
// уезжают, и там изоляция обязана быть сетевой — здесь же они единственный механизм.

import type { ExecutionProfileInput, FpsFraction, PixelProfileInput } from './contract.js';
import { RenderAdapterError } from './errors.js';

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

  const args = [
    'render',
    input.compositionDir,
    '-o',
    input.framesDir,
    '--format',
    'png-sequence',
    '--fps',
    String(fps.num),
    '--workers',
    String(executionProfile.workers),
  ];
  // Флаг ставится ТОЛЬКО при `browserGpu: false` — так снятие поля профиля видно в аргументах,
  // а не прячется за «мы всё равно всегда так делаем».
  if (!pixelProfile.browserGpu) args.push('--no-browser-gpu');
  args.push('--quiet');
  return args;
}

export interface RenderEnvInput {
  /** Окружение процесса-родителя. Вход, а не `process.env` изнутри: см. шапку `M-03`. */
  readonly parentEnv: NodeJS.ProcessEnv;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

/**
 * Окружение подпроцесса рендерера.
 *
 * `TZ=UTC`/`LC_ALL=C` — «Гарантии рендерера» ADR-0008 дословно. `HYPERFRAMES_FFMPEG_PATH`/
 * `HYPERFRAMES_FFPROBE_PATH` — решение `M-03` п. 9 и V6: ffmpeg СИСТЕМНЫЙ, пакетов
 * `ffmpeg-static`/`ffprobe-static` в проекте нет; путь передаётся значением, а не надеждой
 * на `PATH`.
 */
export function renderEnv(input: RenderEnvInput): NodeJS.ProcessEnv {
  return {
    ...input.parentEnv,
    TZ: 'UTC',
    LC_ALL: 'C',
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_FEEDBACK: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_FFMPEG_PATH: input.ffmpegPath,
    HYPERFRAMES_FFPROBE_PATH: input.ffprobePath,
  };
}
