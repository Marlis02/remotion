/**
 * SP-3d: общее окружение спайка.
 *
 * ROOT — каталог sp3d. Приборы и CLI НЕ дублируются: HF_CLI и статические ffmpeg/ffprobe
 * берутся из SP-3c импортом (`sp3c/lib/env.mjs`), потому что версия CLI определяет тег
 * Docker-образа (`hyperframes-renderer:<version>`), и вторая установка пакета сделала бы
 * спайк несравнимым с SP-3c.
 *
 * DOCKER_SG: на этой машине владелец состоит в группе `docker` (gid 983), но login-сессия
 * старше выдачи группы, поэтому прямой вызов `docker` даёт EACCES на сокете. Все вызовы
 * идут через `sg docker -c ...` — подхват уже выданной группы, не sudo (см. decisions).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT as SP3C_ROOT, BIN, HF_CLI, childEnv as sp3cChildEnv} from '../../sp3c/lib/env.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SP3 = path.resolve(ROOT, '../sp3');
export const SP3C = SP3C_ROOT;
export {BIN, HF_CLI};

/** Композиции берутся из SP-3c как есть, без копирования и без правок. */
export const PROJECTS = {
  src: path.join(SP3C_ROOT, 'src'),
  'src-idiomatic': path.join(SP3C_ROOT, 'src-idiomatic'),
  'src-draft': path.join(SP3C_ROOT, 'src-draft'),
  'src-60s': path.join(SP3C_ROOT, 'src-60s'),
};

/**
 * Окружение дочерних процессов. То же, что в SP-3c, плюс `sg`-обёртка снаружи.
 * HYPERFRAMES_* глушат сетевые проверки CLI на ХОСТЕ; внутрь контейнера они не уезжают
 * (buildDockerRunArgs не пробрасывает env) — это отдельный факт для Q5.
 */
export const childEnv = (extra = {}) => sp3cChildEnv(extra);

/** Обёртка «выполнить с группой docker». Возвращает [cmd, args] для spawn. */
export const sgDocker = (argv) => [
  'sg',
  ['docker', '-c', argv.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ')],
];
