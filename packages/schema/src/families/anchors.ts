// `anchors/1` — ledger якорей (ADR-0004 §4). JSONL: **строка = запись**, add-only.
//
// Форма записи дана ADR-0004 §4 дословно, поэтому здесь она не выводится, а переписывается:
//   { "id", "chapterId", "sceneId", "ordinal", "surface", "prev", "next",
//     "status": "live|dead", "mintedAtRev", "origin": "token|implicit" }

import { z } from 'zod';

import { identifier } from './marks.js';

/**
 * `w:<base32(csprng(128 бит))[:16]>` для токенов и `b:img-<alias>-<n>` для неявных битов
 * (ADR-0004 §4, §2a). Здесь — единственное место формата, где `w:` ЗАКОНЕН: ledger и есть
 * то внутреннее пространство, ссылки на которое запрещены всем остальным (§2, инвариант A1).
 */
const anchorId = (): z.ZodString =>
  identifier().regex(
    /^(w|b|sc|ch|r):[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'ожидался якорь с пространством имён `w:`/`b:`/`sc:`/`ch:`/`r:` (ADR-0004 §1)',
  );

export const AnchorEntrySchema = z
  .object({
    id: anchorId(),
    chapterId: identifier(),
    sceneId: identifier(),
    // Порядковый номер ВНУТРИ сцены: сквозного счётчика по документу нет (ADR-0010 §3a).
    ordinal: z.int().nonnegative(),
    // Поверхностная форма токена, не нормализованное слово (ADR-0004 §5).
    surface: z.string(),
    // `null` на краях: у первого токена нет предыдущего, у последнего — следующего.
    // ADR-0004 §6 берёт обе величины в `boundTo`, поэтому «нет соседа» обязано быть
    // выразимо явно, а не пустой строкой, неотличимой от пустого токена.
    prev: z.string().nullable(),
    next: z.string().nullable(),
    // Исчезнувшие помечаются `dead` и хранятся N ревизий (ADR-0004 §4).
    status: z.enum(['live', 'dead']),
    mintedAtRev: z.int().nonnegative(),
    // `implicit` — неявный бит `b:img-<alias>-<n>`, который минтит компилятор (§2a, M1).
    origin: z.enum(['token', 'implicit']),
  })
  .strict();

export type AnchorEntry = z.infer<typeof AnchorEntrySchema>;
