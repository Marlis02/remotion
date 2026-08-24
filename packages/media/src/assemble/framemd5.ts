// `framemd5` — ПОД ФЛАГОМ, вне обычного пути сборки (ADR-0006 §14, ADR-0008 «Бюджет AC2»).
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ФУНКЦИЯ РЯДОМ С ПРОВЕРКАМИ. Это единственная проверка сборки,
// которая ПЛАТИТ ЗАМЕТНО: `FACT` (SP-3c §5, совпало с SP-3) — 1.345 с на сегмент 300 кадров
// 1080×1920, потому что она полностью ДЕКОДИРУЕТ каждый кадр. При 0.5 с/кадр бюджета AC2 это
// прямой расход, взятый ради AC4, и правило ADR-0006 §14 звучит буквально: «в обычной сборке
// `SegmentArtifact.framemd5Sha256` не вычисляется, а поле помечается как `null` с записью в
// `BuildRecord`». Отдельный файл делает это правило проверяемым грепом, а не обещанием:
// охранник требует, чтобы `encode.ts`, `concat.ts` и `verify.ts` его не импортировали.
//
// БЕЗ `-c copy`, И ЭТО СУТЬ. `FACT` (`M-04`): `ffmpeg -i x -c copy -f framemd5 -` отрабатывает
// мгновенно и считает хэши ПАКЕТОВ, а не декодированных кадров. Такой «framemd5» стоил бы
// копейки и не проверял бы ничего из того, ради чего он заведён: AC4 — про картинку, а не про
// байты контейнера, и именно поэтому ADR-0006 §14 говорит «md5 каждого ДЕКОДИРОВАННОГО кадра».
// Цена в 1.345 с — это цена декодирования, и попытка её не платить означает другую проверку.

import { runFfmpeg, DEFAULT_FFMPEG_PATH } from '../audio/ffmpeg.js';
import { AssembleError } from './errors.js';

/**
 * Флаг командной строки, включающий эту проверку (ADR-0006 §14).
 *
 * Обязателен в ночном прогоне и в коммит-цикле на сокращённой фикстуре; в обычной сборке —
 * не считается. Константа живёт здесь, чтобы CLI (`G-*`) и тесты называли его одинаково.
 */
export const FRAMEMD5_FLAG = '--verify-frames';

export interface Framemd5Options {
  readonly path: string;
  readonly ffmpegPath?: string;
}

/**
 * Аргументы `framemd5` — ЧИСТАЯ функция. `-c copy` здесь нет и быть не может (см. шапку).
 */
export function framemd5Args(path: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    path,
    '-map',
    '0:v:0',
    '-f',
    'framemd5',
    '-',
  ];
}

/**
 * Строки хэшей без шапки.
 *
 * Шапка `framemd5` содержит `#software: Lavf60.16.100` — версию сборки ffmpeg. Оставить её
 * в сравниваемом значении значило бы, что смена версии ffmpeg читается как расхождение
 * КАРТИНКИ, хотя ни один пиксель не поменялся; а положить её в артефакт запретил бы K6.
 * Поэтому комментарии срезаются, и сравнивается ровно то, что заявлено, — хэши кадров.
 */
export function framemd5Lines(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export interface Framemd5Result {
  /** Вывод ffmpeg целиком — на случай, когда нужна и шапка (отчёт, а не сравнение). */
  readonly text: string;
  /** Хэши кадров без шапки: то, что сравнивается. */
  readonly lines: readonly string[];
  readonly args: readonly string[];
}

/**
 * `framemd5` файла с полным декодированием. Зовётся ТОЛЬКО под флагом `--verify-frames`
 * либо из ночного прогона; обычный путь сборки (`encodeSegment` → `concatAndMux` →
 * `verifyAssembly`) её не импортирует, и это проверяется охранником.
 */
export async function framemd5Of(options: Framemd5Options): Promise<Framemd5Result> {
  const args = framemd5Args(options.path);
  const run = await runFfmpeg(args, options.ffmpegPath ?? DEFAULT_FFMPEG_PATH);
  const text = Buffer.from(run.stdout).toString('utf8');
  const lines = framemd5Lines(text);
  if (lines.length === 0) {
    throw new AssembleError(
      'M-04 форма вызова',
      `${options.path}: \`framemd5\` не дал ни одной строки хэша. Пустой результат нельзя ` +
        'читать как «кадры совпали»: сравнивать нечего.',
    );
  }
  return { text, lines, args };
}
