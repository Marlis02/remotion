// `store-lock/1` — что ОБЯЗАНО лежать в `.store` (ADR-0005 §1, §8, §8a).

import { z } from 'zod';

import { sha256Hex } from './common.js';
import { identifier } from './marks.js';

/**
 * Форма записи собрана из двух источников репозитория и **не является решением этой сессии**:
 * ADR-0005 §1 даёт `sha256 → {size, kind, origin}`, комментарий самой фикстуры добавляет
 * `replicas` (инвариант M8/P7: для `kind: voice|snapshot|ai-image` реплик ≥ 2).
 *
 * ПОЧЕМУ ЭТО НЕ ЗАБЛОКИРОВАЛО ЗАДАЧУ: в фикстуре `entries: []`, то есть ни одна запись не
 * может противоречить схеме сегодня. Окончательную форму называет `M-01` («CAS `.store` и
 * `store.lock`») — там появится первый настоящий вход. Записано в отчёте `S-02` как материал
 * для `M-01`, а не выдано за норму.
 *
 * `entries` — СПИСОК, а не карта, хотя комментарий фикстуры пишет `sha256 → {…}`: в файле
 * стоит `entries: []`, у карты пустое значение было бы `{}`. Форма файла старше комментария.
 */
const StoreLockEntrySchema = z
  .object({
    sha256: sha256Hex(),
    size: z.int().nonnegative(),
    kind: identifier(),
    origin: identifier(),
    replicas: z.array(identifier()),
  })
  .strict();

export const StoreLockSchema = z
  .object({
    schema: z.literal('store-lock/1'),
    // Пустой ⇒ первый же `vpe build` потребует `vpe store verify` (P7).
    lastVerifiedAt: identifier().nullable(),
    entries: z.array(StoreLockEntrySchema),
  })
  .strict();

export type StoreLock = z.infer<typeof StoreLockSchema>;
