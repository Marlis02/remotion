// Пометки на полях схемы, которые читает канонический писатель.
//
// ПОЧЕМУ ПОМЕТКА, А НЕ СПИСОК РЯДОМ СО СХЕМОЙ. P17 требует, чтобы значения-идентификаторы
// писались в кавычках. Единственный способ выполнить это, не угадывая по содержимому
// («похоже на id — закавычим»), — сказать это в схеме один раз, там же, где объявлено поле.
// Отдельный список путей рядом со схемой разъехался бы с ней при первой же правке.
//
// Механика — `.meta()` из zod 4: пометка кладётся в `z.globalRegistry` и читается оттуда.
// Проверено: она переживает `.shape` и `.optional().unwrap()`.

import { z } from 'zod';

interface FieldMarks {
  /** Значение — идентификатор: писатель обязан взять его в кавычки (P17). */
  readonly vpeIdentifier?: true;
}

/**
 * Идентификатор: непустая строка, которую канонический писатель заключает в кавычки.
 *
 * Кавычки здесь не косметика. `sha256` из шестнадцати нулей, `08`, `no`, `1.20`, `04:30` —
 * законные идентификаторы, и без кавычек YAML вернёт из них число, boolean или строку другой
 * формы (P16). Кавычки превращают «повезло, что распарсилось строкой» в «объявлено строкой».
 */
export function identifier(): z.ZodString {
  return z.string().min(1).meta({ vpeIdentifier: true } satisfies FieldMarks);
}

/** Читает пометки поля. Разворачивает `optional`/`nullable`, иначе пометка терялась бы. */
export function marksOf(node: unknown): FieldMarks {
  if (node === undefined || node === null) return {};
  let current: unknown = node;
  for (let depth = 0; depth < 8; depth += 1) {
    const marks: unknown = z.globalRegistry.get(current as never);
    if (marks !== undefined) return marks as FieldMarks;
    const def = (current as { _zod?: { def?: { type?: string } } })._zod?.def;
    if (def?.type !== 'optional' && def?.type !== 'nullable') return {};
    current = (current as { unwrap: () => unknown }).unwrap();
  }
  return {};
}

/** Помечено ли поле как идентификатор. */
export function isIdentifier(node: unknown): boolean {
  return marksOf(node).vpeIdentifier === true;
}
