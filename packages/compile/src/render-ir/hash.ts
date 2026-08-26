// `segmentIrHash` — идентичность содержимого сегмента, первое слагаемое `segmentKey`
// (ADR-0006 §2). Продюсер этой величины (долг №115) — здесь.
//
//     segmentIrHash = blake3( canonicalJson( RenderIrSegment ) )
//
// КАНОНИЧЕСКАЯ ФОРМА — ОДНА НА РЕПОЗИТОРИЙ, И ЭТО ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО.
// `canonicalJson` живёт в `packages/schema/src/canonical/json.ts` и уже реэкспортирован
// `core-model` (адресный блок `V-03`, вместе с `blake3`), поэтому `compile` потребляет её
// как есть — при том, что `@vpe/schema` из `compile` по карте ADR-0009 не резолвится вовсе.
// Второй формы здесь не заводится (норма `M-05`: одна каноническая форма на репозиторий).
// `media/src/cache/canonical.ts` — нетстринг для КЛЮЧЕЙ, другая форма для другой цели: она
// кодирует КОРТЕЖ полей инъективно, а здесь кодируется одна структура.
//
// ПОБОЧНАЯ ПОЛЬЗА, КОТОРУЮ СТОИТ НАЗВАТЬ. `canonicalJson` отвергает `bigint`, `Map`, `Set`,
// `undefined`, `NaN`, `±Infinity` и `-0`. Значит требование ADR-0008 «никаких `Map`/`Set`;
// запрос обязан пережить JSON round-trip» охраняется не только тестом round-trip, но и самим
// вычислением хэша: IR с `Map` внутри не получит `segmentIrHash` вовсе.

import { blake3, canonicalJson, type Blake3, type RenderIrSegment } from '@vpe/core-model';

/**
 * `blake3(canonicalJson(ir))` — 64 строчные hex-цифры.
 *
 * @throws {CanonicalJsonError} если в IR оказалось значение, не выразимое в JSON однозначно.
 */
export function segmentIrHash(ir: RenderIrSegment): Blake3 {
  return blake3(canonicalJson(ir));
}
