// Разворачивание `[img: alias]` — единственный сахар диалекта (ADR-0002 §4).
//
// «`[img: alias]` разворачивается КОМПИЛЯТОРОМ (чистая функция, не форматтером и не в файле) в
// direction-запись с дефолтами: `track: visual`, `z: 0`, `until` = следующий `[img:]` или конец
// сцены, `template: still@1`. Порождённая запись ссылается на НЕЯВНЫЙ БИТ `b:img-<alias>-<n>`,
// который компилятор минтит в ledger в позиции маркера (ADR-0004 §2a), и НИКОГДА на `w:`».
//
// ЗАЧЕМ БИТ, А НЕ БЛИЖАЙШИЙ `w:` (M1, инвариант **A2**). В первой редакции `[img:]`
// «позиционировался по ближайшему `w:`» — то есть основной способ расстановки визуала (8 фото на
// ролик, AC1) ПОРОЖДАЛ ровно ту ссылку на `w:`, которую запрещает ADR-0004 §2. Правило,
// нарушаемое главным действием, — фикция. С собственным битом картинка не съезжает при правке
// соседнего слова: её якорь переносит word-diff наравне с остальными.
//
// A1 ЗДЕСЬ ТИПОВОЙ, А НЕ ДЕКЛАРАТИВНЫЙ. `at`/`until` объявлены как `PublicAnchorId`, а его
// единственный конструктор (`asPublicAnchorId`, `@vpe/schema`) валидирует формой `publicAnchor()`,
// которая `w:` ОТВЕРГАЕТ. Собрать порождённую запись со ссылкой на `w:` нельзя — это не проходит
// компилятор, а не только тест.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
//   * `recordId` — ADR-0002 §4 его не называет, а `direction/1` требует у каждой записи
//     (4 случайных байта, выданные CLI, ADR-0007 §1). Взять случайные байты компилятор не может:
//     `recordId` — вход seed'а (D1), случайный на каждом прогоне сломал бы AC4. Правило
//     вывода детерминированного `recordId` в ADR отсутствует, и здесь оно не изобретается
//     (решение владельца, `C-04`): порождённая запись показана БЕЗ него, расхождение с формой
//     `direction/1` записано в `docs/DEBTS.md` с адресом `C-05`.
//   * записи файла. Функция возвращает ЗНАЧЕНИЯ. `direction/*.yaml` порождённые записи не
//     содержат и содержать не должны — это и значит «не в файле» (ADR-0002 §4); в фикстуре об
//     этом сказано прямо, в шапке `fixtures/minimal/direction/01-intro.yaml`.

import { asPublicAnchorId } from '@vpe/schema';

import type { AnchorRef } from '../model/entities.js';
import type { SourceDocument } from '../source/ast.js';
import { anchorSlots, type AnchorSlot } from './slots.js';

// `AnchorRef` (ссылка на якорь, суженная до `PublicAnchorId`) объявлен в `model/entities.ts`:
// тип принадлежит МОДЕЛИ, а не разворачиванию `[img:]`. Здесь он был заведён потому, что
// `C-04` был первым, кому он понадобился; `C-05` завёл слой Score, и вторая копия
// двухполевого интерфейса разъехалась бы с первой при первой правке.

/**
 * Порождённая запись режиссуры. Поля — ровно те, что называет ADR-0002 §4.
 *
 * `params: { asset }` — `INFERENCE`, а не буква ADR: §4 называет `template: still@1`, но не
 * говорит, как alias доезжает до шаблона. Форма взята с уже существующей записи `still@1` в
 * `fixtures/minimal/direction/01-intro.yaml` (`params: { asset: "ledger", fit: cover }`);
 * `fit` не подставляется — умолчания параметров нормирует манифест шаблона (`TS-01`), а не эта
 * функция.
 */
export interface GeneratedDirectionRecord {
  readonly at: AnchorRef;
  readonly until: AnchorRef;
  readonly track: 'visual';
  readonly z: 0;
  readonly template: 'still@1';
  readonly params: { readonly asset: string };
}

const ref = (anchor: string): AnchorRef => ({ kind: 'anchor', anchor: asPublicAnchorId(anchor) });

/**
 * Разворачивает все `[img:]` документа.
 *
 * `until` — следующий `[img:]` ТОЙ ЖЕ сцены, иначе якорь сцены: `until` на scope-якоре означает
 * его конец (`direction/1`, ADR-0004 §7). Именно поэтому картинка не переезжает через границу
 * сцены сама собой.
 */
export function expandImg(document: SourceDocument): GeneratedDirectionRecord[] {
  const slots = anchorSlots(document).filter((slot): slot is AnchorSlot => slot.kind === 'img');
  const out: GeneratedDirectionRecord[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot === undefined || slot.id === null || slot.alias === undefined) continue;
    const following = slots[index + 1];
    const until =
      following !== undefined && following.sceneId === slot.sceneId && following.id !== null
        ? following.id
        : `sc:${slot.sceneId}`;
    out.push({
      at: ref(slot.id),
      until: ref(until),
      track: 'visual',
      z: 0,
      template: 'still@1',
      params: { asset: slot.alias },
    });
  }

  return out;
}
