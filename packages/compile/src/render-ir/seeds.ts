// Материализация seed'ов в IR (ADR-0007 §2: «рендерер их не выводит»).
//
// ФОРМУЛА НЕ ПОВТОРЯЕТСЯ ЗДЕСЬ НИ ОДНИМ СИМВОЛОМ. `seedOf` из `core-model` — единственное
// место, где живёт `blake3(canonicalJson([seedRoot, chapterId, sceneId, recordId, purpose]))`,
// и вторая копия обессмыслила бы греп-охранник **D2**, который стережёт ровно тот файл.
// Здесь — только вызов и перевод результата в форму, переживающую JSON.
//
// **D2 ТИПОМ, А НЕ ДИСЦИПЛИНОЙ.** `SeedNode` — четыре поля формулы; `segmentId` в него не
// присваивается, потому что в `SeedScope` (`types.ts`) его нет и взять его этой функции
// неоткуда: `materializeSeeds` не принимает ни сегмента, ни его id, ни индекса. Это и есть
// исполнимая форма «`segmentId` в seed не входит» (ADR-0007 §1). Греп по коду вычисления —
// вторая половина охранника, третья — сравнение IR двух проектов (**T3**/AC4-b).
//
// `purpose` = `templateId` (решение владельца 1, 2026-08-26, вариант «а»). ADR-0007 §1
// определяет `purpose` как «строковую константу шаблона» (`'kenburns.jitter'`) — то есть
// перечень purposes принадлежит МАНИФЕСТУ шаблона, а манифестов нет: `templates-spec`/`TS-01`
// не написан. Взято самое узкое, что не выдумывает перечня: один seed на клип, ключ — id
// шаблона целиком (`'kenburns@1'`). Когда `TS-01` объявит настоящие purposes, карта вырастет
// числом ключей, а формула не изменится. **Цена, принятая явно:** seed шаблона тогда сменится
// один раз, то есть кэш сегментов инвалидируется — до первого ролика это ничего не стоит.
// Долг с адресом `TS-01`.
//
// У ПОРОЖДЁННОЙ `[img:]`-ЗАПИСИ SEED'ОВ НЕТ ВОВСЕ (решение владельца 1-bis). `recordId` —
// «явный случайный id записи режиссуры, выданный CLI и записанный в `direction/*.yaml`»
// (ADR-0007 §1), а у порождённой записи нет ни одного из двух событий (решение владельца
// `C-05`, долг №21: она объект МОДЕЛИ, а не запись `direction/1`). Формула без `recordId` не
// записывается; изобретать правило его вывода `CP-04` не вправе — это `TS-01` вместе с
// манифестом. `still@1` — статичная картинка, случайность ей не нужна.

import { seedOf, type SeedHex } from '@vpe/core-model';

import type { SeedScope } from './types.js';

/** Сколько hex-цифр в seed'е: `uint64` — 8 байт (ADR-0007 §1, `SEED_BYTES`). */
const SEED_HEX_LENGTH = 16;

/**
 * `purpose → seed` для одного клипа.
 *
 * Пустой объект, если `scope === null`. Форма результата — обычный объект: **`Map` в IR
 * запрещён** (ADR-0008 «Гарантии входа»: JSON round-trip), и `canonicalJson` его отвергает.
 *
 * @param seedRoot `project.yaml` → `seedRoot` (ADR-0007 §1).
 * @param scope три поля формулы; `null` у порождённой `[img:]`-записи.
 * @param templateId он же `purpose` до `TS-01`.
 * @throws {ModelError} из `seedOf`, если `seedRoot` не целое ≥ 0.
 */
export function materializeSeeds(
  seedRoot: number,
  scope: SeedScope | null,
  templateId: string,
): Readonly<Record<string, SeedHex>> {
  if (scope === null) return {};
  const seed = seedOf(seedRoot, {
    chapterId: scope.chapterId,
    sceneId: scope.sceneId,
    recordId: scope.recordId,
    purpose: templateId,
  });
  return { [templateId]: toSeedHex(seed) };
}

/**
 * `uint64` → 16 строчных hex-цифр, big-endian.
 *
 * ОБРАТНО ТЕ ЖЕ БАЙТЫ, ЧТО ПРОЧИТАЛ `seedOf`: он берёт первые 8 байт дайджеста как
 * `BigInt('0x' + digest.slice(0, 16))`, здесь — обратное преобразование с добивкой нулями
 * слева. Через `number` этот путь не проходит: `uint64` не помещается в
 * `Number.isSafeInteger`, и 99.9 % значений потеряли бы младшие биты МОЛЧА (ADR-0007 §1,
 * решение владельца `C-05` вопрос 3) — ровно тот класс дефекта, против которого написан §3.
 */
export function toSeedHex(seed: bigint): SeedHex {
  return seed.toString(16).padStart(SEED_HEX_LENGTH, '0');
}
