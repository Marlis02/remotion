// Раскладка CAS и резолв корня стора (ADR-0005 §1, §8a; инвариант **P8**).
//
// ЧЕГО В ЭТОМ ФАЙЛЕ НЕТ НАМЕРЕННО: чтения `project.yaml`, `os.homedir()`, `os.tmpdir()` и
// вообще любого «угадывания» путей. Всё, что могло бы прийти из окружения, приходит
// параметром — тем же приёмом, которым `core-model` берёт источник случайности (`C-04`) и
// которым ADR-0007 §4 требует брать `now`. Практическое следствие: **ни один тест не может
// случайно записать в настоящий `~/.vpe`** — он физически не знает, где тот лежит.

import path from 'node:path';

import type { Sha256 } from '@vpe/schema';

/** Отказ резолва пути стора. Несёт исходное (нерезолвнутое) значение — его писал человек. */
export class StorePathError extends Error {
  readonly configured: string;

  constructor(configured: string, message: string) {
    super(`store.path \`${configured}\`: ${message}`);
    this.name = 'StorePathError';
    this.configured = configured;
  }
}

/** Длина каждого из двух уровней шардинга: `.store/ab/cd/<sha256>` (ADR-0005 §1). */
const SHARD_LENGTH = 2;

/**
 * Адрес блоба в CAS. Два уровня по два hex-символа, дальше — полный sha256 именем файла.
 *
 * `sha` — бренд `Sha256`, а не строка: 64 строчных hex проверены конструктором
 * `asSha256` (`S-01`), поэтому здесь нет ни второй регулярки, ни проверки длины.
 */
export function blobPath(root: string, sha: Sha256): string {
  return path.join(root, sha.slice(0, SHARD_LENGTH), sha.slice(SHARD_LENGTH, SHARD_LENGTH * 2), sha);
}

/** Каталог шарда — нужен и записи (создать), и охраннику (посмотреть, что в нём лежит). */
export function shardDir(root: string, sha: Sha256): string {
  return path.dirname(blobPath(root, sha));
}

export interface StorePathContext {
  /** Домашний каталог пользователя. **Вход**, а не `os.homedir()`: см. шапку файла. */
  readonly homedir: string;
  /** Корень рабочего дерева проекта — то самое дерево, ВНУТРИ которого стору нельзя (P8). */
  readonly projectRoot: string;
}

/**
 * `project.yaml → store.path` → абсолютный путь корня CAS.
 *
 * Три правила, и каждое — правило, а не удобство:
 *
 * 1. **`~/` раскрывается по переданному `homedir`.** В фикстуре записано `~/.vpe/store`, и
 *    без раскрытия каталог назывался бы буквально `./~`;
 * 2. **путь обязан быть абсолютным** — относительный означал бы «относительно рабочего
 *    каталога процесса», то есть у `vpe`, запущенного из подкаталога, был бы другой стор;
 * 3. **путь не имеет права лежать внутри дерева проекта** — это исполнение **P8**. Причина
 *    записана в ADR-0005 §8a и конкретна: `git clean -xdf` — рутинная команда, и она
 *    удаляет `.gitignore`-каталог внутри дерева вместе со всем оплаченным аудио, которое
 *    `FACT` (r1 §2.3) не восстанавливается повторной генерацией.
 *
 * @throws {StorePathError} путь пуст, не абсолютен после раскрытия или лежит внутри проекта.
 */
export function resolveStorePath(configured: string, context: StorePathContext): string {
  if (configured === '') {
    throw new StorePathError(configured, 'пустое значение — стор не имеет адреса');
  }
  if (!path.isAbsolute(context.projectRoot)) {
    throw new StorePathError(configured, `projectRoot \`${context.projectRoot}\` обязан быть абсолютным`);
  }

  let expanded = configured;
  if (configured === '~') {
    expanded = context.homedir;
  } else if (configured.startsWith('~/')) {
    if (!path.isAbsolute(context.homedir)) {
      throw new StorePathError(configured, `homedir \`${context.homedir}\` обязан быть абсолютным`);
    }
    expanded = path.join(context.homedir, configured.slice('~/'.length));
  }

  if (!path.isAbsolute(expanded)) {
    // Сюда попадает и `~user/...`: раскрытие чужого домашнего каталога здесь не делается —
    // угадывать чужой `home` значило бы знать про систему больше, чем сказано во входе.
    throw new StorePathError(
      configured,
      `после раскрытия получился относительный путь \`${expanded}\`; ` +
        'стор адресуется абсолютно, иначе он зависит от рабочего каталога процесса',
    );
  }

  const resolved = path.resolve(expanded);
  const projectRoot = path.resolve(context.projectRoot);
  if (resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new StorePathError(
      configured,
      `путь \`${resolved}\` лежит внутри дерева проекта \`${projectRoot}\`. ` +
        'P8 (ADR-0005 §8a): `.store` живёт ВНЕ дерева, потому что `git clean -xdf` уносит ' +
        '.gitignore-каталог внутри дерева вместе с единственной копией оплаченного аудио',
    );
  }

  return resolved;
}
