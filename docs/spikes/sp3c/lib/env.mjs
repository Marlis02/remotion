/**
 * SP-3c: общее окружение спайка.
 *
 * ROOT — каталог sp3c (у SP-3 свой ROOT, его lib импортируются как есть).
 * BIN — статические ffmpeg/ffprobe из npm: на этой машине системного ffmpeg нет,
 * а sudo без пароля недоступен (decisions п.2).
 * Переменные HYPERFRAMES_NO_* глушат сетевые проверки CLI (обновления, телеметрия,
 * skills): они не относятся к рендеру, но входили бы в измеряемый старт и в V9.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SP3 = path.resolve(ROOT, '../sp3');
export const BIN = path.join(ROOT, 'bin');
export const HF_CLI = path.join(ROOT, 'node_modules/.bin/hyperframes');

/** Окружение для дочерних процессов: ffmpeg на PATH, детерминизм локали и TZ (ADR-0008). */
export const childEnv = (extra = {}) => ({
  ...process.env,
  PATH: `${BIN}:${process.env.PATH}`,
  TZ: 'UTC',
  LC_ALL: 'C',
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
  HYPERFRAMES_NO_FEEDBACK: '1',
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_FFMPEG_PATH: path.join(BIN, 'ffmpeg'),
  HYPERFRAMES_FFPROBE_PATH: path.join(BIN, 'ffprobe'),
  ...extra,
});
