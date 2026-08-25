// Контракт хранилища байтов (ADR-0005 §8) и договорная ошибка «нет байтов».

import { asSha256, StoreLockSchema, type BlobKind, type Sha256 } from '@vpe/schema';

/**
 * **Интерфейс из ПЯТИ методов — дословно ADR-0005 §8.** Ни шестого, ни пятого с другой
 * сигнатурой здесь быть не может, и это не стилистика: ADR объявляет минимальность
 * интерфейса причиной, по которой добавление третьего бэкенда (внешний SSD, git-LFS)
 * остаётся конфигурацией, а не переписыванием.
 *
 * ОТДЕЛЬНО: метода удаления в списке НЕТ — `.store` не подлежит LRU-GC никогда (**K10**),
 * `vpe store gc` не пишется. Охранник — `store-layout.test.ts`.
 */
export interface Store {
  has(sha: Sha256): Promise<boolean>;
  read(sha: Sha256): Promise<Uint8Array>;
  put(bytes: Uint8Array, kind: BlobKind): Promise<Sha256>;
  path(sha: Sha256): Promise<string>;
  missing(required: readonly Sha256[]): Promise<readonly Sha256[]>;
}

/**
 * «Байтов нет» — ошибка, которая НЕСЁТ ПЕРЕЧЕНЬ. Это фундамент сценария из критерия
 * готовности `M-01`: клон без стора обязан падать не словами «файл не найден», а точным
 * списком недостающих sha256, по которому человек запускает `vpe store fetch`.
 *
 * Список в поле `missing` — не украшение сообщения: `vpe store verify` (`L-02`) печатает
 * именно его, а не разбирает текст ошибки обратно.
 */
export class MissingBlobsError extends Error {
  /** Отсортированные (hex, побайтово) и уникальные sha отсутствующих блобов. */
  readonly missing: readonly Sha256[];

  constructor(missing: readonly Sha256[], context: string) {
    const list = missing.map((sha) => `  ${sha}`).join('\n');
    super(
      `${context}: в CAS нет ${String(missing.length)} блоб(ов):\n${list}\n` +
        'Байты лежат вне дерева проекта (ADR-0005 §8a) — принесите их `vpe store fetch`.',
    );
    this.name = 'MissingBlobsError';
    this.missing = missing;
  }
}

/**
 * Форма вида блоба берётся ИЗ СХЕМЫ семейства `store-lock/1`, а не вторым списком рядом.
 *
 * Ровно то же рассуждение, по которому `types/brands.ts` не хранит регулярку якоря: вторая
 * копия перечня разошлась бы с первой при первой правке, и `put` начал бы принимать вид,
 * который `store.lock` потом отвергнет.
 */
const BLOB_KIND = StoreLockSchema.shape.entries.element.shape.kind;

/**
 * Проверка вида на границе `put`.
 *
 * Зачем она при типизированном параметре: `kind` доезжает до `put` из данных (CLI, запись
 * ассета, ответ провайдера), а не только из литерала в коде. Правило **P7** («для
 * `voice|snapshot|ai-image` реплик ≥ 2») адресуется ЗНАЧЕНИЕМ этого поля — опечатка молча
 * вывела бы невосстановимые байты из-под правила.
 *
 * @throws `TypeError`, если вид не из перечня `store-lock/1`.
 */
export function assertBlobKind(value: string): BlobKind {
  const result = BLOB_KIND.safeParse(value);
  if (!result.success) {
    throw new TypeError(
      `kind \`${value}\` не из перечня ADR-0005 §8/§8a: ${BLOB_KIND.options.join(', ')}`,
    );
  }
  return result.data;
}

/**
 * sha256 из ДАННЫХ — в бренд, на границе.
 *
 * Заведена `M-05` и по той же причине, что `assertBlobKind` рядом: адрес блоба доезжает до
 * `Store` не только из литерала в коде. Кэш стадии `voice` хранит его строкой в манифесте,
 * take-файл — строкой в поле `pcm.sha256`, и оба читаются пакетом `voice`, который бренд
 * `Sha256` НЕ РЕЗОЛВИТ вовсе (карта ADR-0009: `packages/voice/node_modules/@vpe/` — два
 * симлинка, `@vpe/schema` среди них нет). Без этой функции у `voice` остался бы ровно один
 * способ позвать `store.read` — каст в бренд, а он запрещён линтом во всём репозитории
 * (`tests/lints/brand-casts.test.ts`) именно затем, чтобы проверка не подменялась обещанием.
 *
 * @throws `TypeError`, если строка не 64 строчных hex (`asSha256`, `S-01`).
 */
export function asBlobSha(value: string): Sha256 {
  return asSha256(value);
}
