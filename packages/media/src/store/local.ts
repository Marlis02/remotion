// Локальный бэкенд CAS: каталог вне дерева проекта, раскладка `.store/ab/cd/<sha256>`.
//
// «БЭКЕНДОВ В V1 ДВА» (ADR-0005 §8): локальный каталог и один удалённый через rclone.
// Здесь первый; второй — `G-03`, и он же закрывает P7 («реплик ≥ 2»). Интерфейс между ними
// один и тот же, из пяти методов, — ровно поэтому второй бэкенд станет конфигурацией.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { asSha256, type BlobKind, type Sha256 } from '@vpe/schema';

import { writeAtomic } from './atomic.js';
import { blobPath } from './layout.js';
import { MissingBlobsError, assertBlobKind, type Store } from './types.js';

/**
 * sha256 содержимого. `node:crypto` в `media` законен: расширение **D4** ограничивает его
 * пакетом `core-model` (ADR-0007 §4 в ревизии `DOC-01`), а адресация по содержимому — прямое
 * требование ADR-0005 §8. Хэш здесь не «сверяется» с чем-то внешним: он ВЫЧИСЛЯЕТСЯ из
 * байтов, и именно поэтому `put` — это CAS, а не «положи, куда сказали».
 */
function sha256Of(bytes: Uint8Array): Sha256 {
  return asSha256(createHash('sha256').update(bytes).digest('hex'));
}

/** Отсутствие файла отличается от любой другой беды с диском и не должно её маскировать. */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export class LocalStore implements Store {
  /**
   * Корень CAS. Приходит ГОТОВЫМ: резолв (`~`, абсолютность, «вне дерева проекта») делает
   * вызывающий через `resolveStorePath`. Пакет `media` не читает `project.yaml` и не знает,
   * где `home`, — см. шапку `layout.ts`.
   */
  readonly #root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) {
      throw new TypeError(
        `корень стора \`${root}\` обязан быть абсолютным путём; резолв делает ` +
          '`resolveStorePath` у вызывающего, а не этот конструктор',
      );
    }
    this.#root = root;
  }

  /**
   * Есть ли байты по адресу.
   *
   * Спрашивается ИМЕННО про файл: `isFile()`, а не «что-нибудь существует». Временные файлы
   * записи невидимы здесь по построению — их имя (`<sha>.tmp-<pid>-<n>`) не равно адресу.
   */
  async has(sha: Sha256): Promise<boolean> {
    try {
      return (await stat(blobPath(this.#root, sha))).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Байты по адресу.
   *
   * Содержимое здесь НЕ перехэшируется: целостность стора — предмет `vpe store verify`
   * (`L-02`), и перехэширование на каждом чтении означало бы прогон всего оплаченного PCM
   * через sha256 на каждой сборке. Записано в отчёте `M-01` как осознанная граница.
   *
   * @throws {MissingBlobsError} байтов нет — с перечнем из одного sha.
   */
  async read(sha: Sha256): Promise<Uint8Array> {
    try {
      return await readFile(blobPath(this.#root, sha));
    } catch (error) {
      if (isNotFound(error)) throw new MissingBlobsError([sha], 'чтение блоба');
      throw error;
    }
  }

  /**
   * Кладёт байты и возвращает их адрес.
   *
   * Идемпотентен: если блоб уже лежит, файл не трогается вовсе — ни перезаписи, ни
   * переименования поверх. Это существеннее, чем экономия записи: перезапись поверх
   * существующего блоба — единственный способ ИСПОРТИТЬ уже оплаченные байты.
   *
   * `store.lock` этот метод НЕ пишет, и это решение, а не упущение (`M-01`, решение
   * владельца): в сигнатуре ADR-0005 §8 нет `origin`, стор адресуется вне дерева, а
   * машинные файлы в git пишет CLI (ADR-0005 §9). Запись в lock — `L-02` через `lock.ts`.
   */
  async put(bytes: Uint8Array, kind: BlobKind): Promise<Sha256> {
    assertBlobKind(kind);
    const sha = sha256Of(bytes);
    if (await this.has(sha)) return sha;
    await writeAtomic(blobPath(this.#root, sha), bytes);
    return sha;
  }

  /**
   * Локальный путь для рендерера (ADR-0005 §8).
   *
   * **Бросает, если байтов нет** (решение `M-01`): путь, выданный рендереру, обязан
   * указывать на существующие байты. Иначе ошибка стора всплыла бы внутри подпроцесса
   * рендерера (R2/R3) как «не открылся файл» — далеко от причины и без списка sha.
   * Спросить «есть ли» без исключения можно `has`.
   *
   * @throws {MissingBlobsError} байтов нет — с перечнем из одного sha.
   */
  async path(sha: Sha256): Promise<string> {
    const target = blobPath(this.#root, sha);
    if (!(await this.has(sha))) throw new MissingBlobsError([sha], 'путь до блоба');
    return target;
  }

  /**
   * ТОЧНЫЙ список отсутствующих sha — фундамент критерия «клон без стора падает со списком».
   *
   * Порядок детерминирован: hex, побайтово-лексикографически, по возрастанию — тот же ключ,
   * которым отсортированы записи `store.lock`. Дубликаты во входе схлопываются: список
   * «чего не хватает» — это множество, и повтор в требовании не должен удваивать строку в
   * отчёте `vpe store verify`.
   */
  async missing(required: readonly Sha256[]): Promise<readonly Sha256[]> {
    const unique = [...new Set(required)].sort();
    const present = await Promise.all(unique.map(async (sha) => this.has(sha)));
    return unique.filter((_, index) => present[index] !== true);
  }
}
