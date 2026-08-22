// Общие кирпичи схем семейств. Всё, что встречается больше чем в одном семействе.

import { z } from 'zod';

import { identifier } from './marks.js';

/** sha256 в hex: 64 строчных символа. Тот же контракт, что у бренда `Sha256` (`S-01`). */
export const sha256Hex = (): z.ZodString =>
  identifier().regex(/^[0-9a-f]{64}$/, 'ожидался sha256: 64 строчных hex-символа');

/** blake3 в hex, 64 строчных символа. */
export const blake3Hex = (): z.ZodString =>
  identifier().regex(/^[0-9a-f]{64}$/, 'ожидался blake3: 64 строчных hex-символа');

/**
 * Пространства имён якорей — ADR-0004 §1: `w:` (токен исходника, **внутреннее**), `b:` (бит),
 * `sc:`/`ch:` (сцена/глава), `r:` (запись режиссуры).
 *
 * ADR-0004 §2: **ни одна direction-запись и ни один override не имеют права ссылаться на `w:`**.
 * Здесь это исполнимо, а не декларативно: схема отвергает `w:` с сообщением про правило.
 * Строка **A1** реестра остаётся `named` — её вторая половина (греп по `overrides/**`)
 * появится вместе с семейством `override/1` в `C-04`/`O-01`.
 */
export const publicAnchor = (): z.ZodString =>
  identifier()
    .regex(/^(b|sc|ch|r):[A-Za-z0-9][A-Za-z0-9_-]*$/, 'ожидался якорь `b:`/`sc:`/`ch:`/`r:` (ADR-0004 §1)')
    .refine((value) => !value.startsWith('w:'), {
      message: 'ADR-0004 §2: ссылка на `w:` запрещена — только `b:`/`sc:`/`ch:`/`r:` (инвариант A1)',
    });

/** Момент времени на речевом таймлайне — только якорь (Charter V1). */
export const AnchorPointSchema = z
  .object({
    kind: z.literal('anchor'),
    anchor: publicAnchor(),
  })
  .strict();

/**
 * Геометрия времени произведения. `fps: { num, den }` — рациональная величина, а не double:
 * 30000/1001 обязано быть выразимо точно (ADR-0003 T2).
 */
export const FpsSchema = z
  .object({
    num: z.int().positive(),
    den: z.int().positive(),
  })
  .strict();

/**
 * Произвольное JSON-значение. Нужно ровно в одном месте — `direction/1 → params`: параметры
 * шаблона нормирует **манифест шаблона** (`TS-01`), а не это семейство. Проверять их здесь
 * значило бы держать вторую копию каждого шаблонного контракта.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
