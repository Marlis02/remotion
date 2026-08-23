// `store.lock` — единственный файл стора, который лежит В ГИТЕ (ADR-0005 §1, §8a).
//
// ЧИТАЕТСЯ И ПИШЕТСЯ ЧИТАТЕЛЕМ И ПИСАТЕЛЕМ СЕМЕЙСТВ (`S-02`), а не голым YAML-парсером.
// Причина ровно та же, по которой лексер `C-02` не копировал `publicAnchor()`: второй
// разборщик того же файла разошёлся бы с первым при первой правке формы — а форма
// `store-lock/1` уже пережила одну ревизию (`M-01`).
//
// КТО ЭТИМ ПОЛЬЗУЕТСЯ. Не `Store.put`: он в lock не пишет (см. `local.ts`). Пишет CLI —
// `vpe store fetch|push|verify` (`L-02`) и `vpe build`. Здесь только чистые операции над
// значением плюс запись файла канонической формой.

import { StoreLockSchema, readFamily, renderFamily, type StoreLock } from '@vpe/schema';

import { writeAtomic } from './atomic.js';

/**
 * Запись `store.lock`. Имени в публичном API `@vpe/schema` у неё нет, поэтому тип выводится
 * из самого семейства — второй копии формы в репозитории не появляется.
 */
export type StoreLockEntry = StoreLock['entries'][number];

/**
 * Читает `store.lock` штатным читателем семейств.
 *
 * `expectFamily` обязателен: без него файл чужого семейства дал бы стену `unrecognized_keys`
 * вместо одной строки «ожидался `store-lock/1`» (ровно то, ради чего в `S-02` заведён
 * отдельный шаг чтения шапки).
 *
 * @throws {import('@vpe/schema').FamilyReadError} нет шапки, не то семейство, битый формат.
 * @throws {import('zod').ZodError} тело не соответствует форме `store-lock/1`.
 */
export function readStoreLock(filePath: string): StoreLock {
  return StoreLockSchema.parse(readFamily(filePath, { expectFamily: 'store-lock' }).value);
}

/** Каноническая форма файла как текст (`renderFamily`, порядок ключей — из схемы). */
export function renderStoreLock(lock: StoreLock): string {
  return renderFamily('store-lock', lock);
}

/**
 * Пишет `store.lock` канонической формой — тем же атомарным примитивом, что и блобы (K7).
 *
 * Атомарность здесь не про CAS: `store.lock` лежит в рабочем дереве, и оборванная запись
 * оставила бы в git полуфайл, который читатель отвергнет целиком. Единственная копия списка
 * «что обязано лежать в сторе» стоит `tmp + rename`.
 */
export async function writeStoreLock(filePath: string, lock: StoreLock): Promise<void> {
  await writeAtomic(filePath, new TextEncoder().encode(renderStoreLock(lock)));
}

/**
 * Добавляет или заменяет запись по её sha256 и возвращает НОВОЕ значение.
 *
 * Порядок держится здесь, а не у вызывающего: он часть канонической формы файла (hex
 * sha256, побайтово-лексикографически, по возрастанию), и схема его проверяет. `parse` в
 * конце не украшение — он ловит и опечатку в записи, и мою же ошибку сортировки на месте
 * вызова, а не при записи файла через полсотни строк.
 */
export function upsertEntry(lock: StoreLock, entry: StoreLockEntry): StoreLock {
  const others = lock.entries.filter((existing) => existing.sha256 !== entry.sha256);
  const entries = [...others, entry].sort((left, right) =>
    left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0,
  );
  return StoreLockSchema.parse({ ...lock, entries });
}

/**
 * Проставляет момент последней проверки.
 *
 * **Время — ВХОД, а не `Date.now()`** (дух D9: «`now` — вход сборки»). Значение пишет
 * `vpe store verify`, то есть `L-02`; здесь только форма и её проверка. Часы в
 * `src/**` пакетов запрещены линтом — охранник `tests/lints/v8-clock-readers.test.ts`.
 */
export function withLastVerifiedAt(lock: StoreLock, verifiedAt: string | null): StoreLock {
  return StoreLockSchema.parse({ ...lock, lastVerifiedAt: verifiedAt });
}
