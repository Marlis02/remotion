// ffmpeg подпроцессом — единственный файл `audio/`, знающий про `node:child_process`. Второй
// такой файл появился в `M-04` — `assemble/ffprobe.ts` (у прибора другой выход, другой критерий
// отказа и другое лечащее сообщение); правка шапки — той же сессии.
//
// ПОЧЕМУ ffmpeg ВООБЩЕ ЗДЕСЬ. Он не новая зависимость: ADR-0006 §5 кладёт «версию и
// конфигурацию **ffmpeg**» в `audioProfile`, ADR-0008 «Сборка» и задача `M-04` построены на
// нём целиком, а `audio-profile/1 → resampler` называет `engine: soxr` — это дословно
// `aresample=resampler=soxr` того же ffmpeg. Свой ресемплер исполнял бы профиль неверно с
// первой строки (решение владельца, вопрос 2 сессии `M-03`).
//
// ПРОВЕРЯЕТСЯ НЕ НАЛИЧИЕ БИНАРНИКА, А СБОРКА (уточнение владельца). `ffmpeg` без
// `--enable-libsoxr` запустится и молча отдаст ДРУГОЙ ресемплер (`swr`), то есть другой звук
// при том же профиле. Поэтому строка `configuration:` разбирается, и отсутствие `libsoxr` —
// отказ до запуска, а не расхождение байт после.
//
// РАЗБОР ВЫВОДА — ЧИСТАЯ ФУНКЦИЯ. `parseFfmpegBuild` не знает ни про процессы, ни про диск:
// её можно покрыть тестом без подпроцесса, а подпроцессная часть остаётся тонкой.
//
// ЧЕГО ЗДЕСЬ НЕТ: чтения `process.env`, поиска бинарника по своим правилам и значений по
// умолчанию, кроме имени `ffmpeg` (то есть «как его зовёт PATH»). Путь приходит входом — тем
// же приёмом, которым `store/layout.ts` берёт `homedir` (P8).

import { spawn } from 'node:child_process';

/** Имя по умолчанию: то, как бинарник зовётся в `PATH`. Путь целиком — вход вызывающего. */
export const DEFAULT_FFMPEG_PATH = 'ffmpeg';

/** Отказ подпроцесса. Несёт аргументы и `stderr` — без них «ffmpeg упал» не лечится. */
export class FfmpegError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;

  constructor(message: string, args: readonly string[], stderr: string) {
    super(stderr === '' ? message : `${message}\nstderr: ${stderr}`);
    this.name = 'FfmpegError';
    this.args = args;
    this.stderr = stderr;
  }
}

export interface FfmpegRun {
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** Сборка ffmpeg: версия и то, что о ней говорит `configuration:`. */
export interface FfmpegBuild {
  /** Например, `6.1.1-3ubuntu5`. Идёт в отчёт ingest, но НЕ в артефакт (K6). */
  readonly version: string;
  /** Строка `configuration:` целиком — она и есть основание для проверки сборки. */
  readonly configuration: string;
  /** Собран ли с `libsoxr` — то есть исполним ли `engine: soxr` из профиля. */
  readonly hasSoxr: boolean;
}

/**
 * Запуск ffmpeg. `stdout` — сырые байты (у нас туда идёт PCM), `stderr` — текст.
 *
 * Ошибка запуска (`ENOENT`) переводится в отказ с ЛЕЧАЩИМ сообщением: `M-03` и `M-04`
 * построены на ffmpeg, и тихого обхода у этого требования нет (решение владельца, вопрос 9).
 */
export async function runFfmpeg(args: readonly string[], ffmpegPath = DEFAULT_FFMPEG_PATH): Promise<FfmpegRun> {
  return await new Promise<FfmpegRun>((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Uint8Array[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Uint8Array) => {
      stderr += Buffer.from(chunk).toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === 'ENOENT'
          ? `\`${ffmpegPath}\` не найден. \`M-03\` (ресемплинг музыки) и \`M-04\` (мукс) ` +
            'построены на ffmpeg — установите ffmpeg, собранный с `--enable-libsoxr`, ' +
            'либо передайте путь к нему явно.'
          : error.message;
      reject(new FfmpegError(`ffmpeg не запустился: ${reason}`, args, stderr));
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ stdout: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), stderr });
        return;
      }
      reject(new FfmpegError(`ffmpeg завершился с кодом ${String(code)}`, args, stderr));
    });
  });
}

/**
 * Разбор `ffmpeg -version`. Чистая функция: вход — текст, выход — сборка.
 *
 * Формат вывода стабилен много лет: первая строка `ffmpeg version <версия> Copyright …`,
 * дальше строка `configuration: --prefix=… --enable-…`. Если разбор не удался, версия
 * остаётся пустой строкой, а `hasSoxr` — `false`: «не смогли прочитать» обязано вести к
 * отказу вызывающего, а не к оптимистичному допущению.
 */
export function parseFfmpegBuild(text: string): FfmpegBuild {
  let version = '';
  let configuration = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (version === '' && trimmed.startsWith('ffmpeg version ')) {
      version = trimmed.slice('ffmpeg version '.length).split(' ')[0] ?? '';
    }
    if (configuration === '' && trimmed.startsWith('configuration:')) {
      configuration = trimmed.slice('configuration:'.length).trim();
    }
  }
  return { version, configuration, hasSoxr: configuration.includes('--enable-libsoxr') };
}

/** `ffmpeg -version` подпроцессом плюс разбор. */
export async function readFfmpegBuild(ffmpegPath = DEFAULT_FFMPEG_PATH): Promise<FfmpegBuild> {
  const run = await runFfmpeg(['-hide_banner', '-version'], ffmpegPath);
  return parseFfmpegBuild(Buffer.from(run.stdout).toString('utf8'));
}
