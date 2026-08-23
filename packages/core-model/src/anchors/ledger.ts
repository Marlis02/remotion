// `anchors.lock.jsonl` — ledger якорей (ADR-0004 §4, ADR-0005 §10; инварианты **A3** и **A8**).
//
// ВХОД — ТЕКСТ, А НЕ ПУТЬ. `core-model` не умеет читать диск (**M3**), файл читает вызывающий —
// ровно как у лексера (`C-02`). Разбор идёт через `parseFamilyText` из `@vpe/schema`: тот же
// код, что у `readFamily`, вынесенный из него в `C-04` именно ради этого вызова. Второй
// разборщик JSONL здесь был бы второй копией одного цикла и разошёлся бы с первой.
//
// ЧТО ЗНАЧИТ «КАНОНИЧЕСКИЙ ПОРЯДОК» У ЭТОГО ФАЙЛА (A8). Порядок дописывания, и никакой другой.
// ADR-0005 §10 объявляет «строка = запись, add-only», а любая сортировка (по id, по сцене)
// переставляла бы строки при каждом минте: старый префикс перестал бы быть префиксом, merge
// перестал бы быть объединением множеств, и обещание §10 («конфликт возникает ровно там, где он
// настоящий») превратилось бы в конфликт на каждой параллельной правке. Поэтому канон здесь
// проверяется ПРЕФИКСОМ (`assertAddOnly`), а не сравнением с отсортированной копией.
//
// ЗАПИСЬ ОПИСЫВАЕТ ЯКОРЬ НА МОМЕНТ СВОЕЙ РЕВИЗИИ; ТЕКУЩЕЕ СОСТОЯНИЕ — ПОСЛЕДНЯЯ ЗАПИСЬ ID.
// Это не украшение, а единственная форма, при которой add-only и word-diff совместимы. Диффу
// (§4: «берётся список токенов из предыдущего ledger'а») нужен УПОРЯДОЧЕННЫЙ список токенов
// предыдущего разбора. Под add-only порядок нельзя ни переписать, ни вывести из порядка строк:
// минт нового слова дописывается в КОНЕЦ файла, а стоит оно в середине текста, поэтому свёртка
// по строкам дала бы диффу неверный порядок и на следующем же прогоне переминтила бы это слово
// — то есть «два `parse` подряд» перестали бы давать одинаковый результат. Поэтому якорь, у
// которого изменились `ordinal`/`prev`/`next`, получает НОВУЮ строку с тем же `id`, а старая
// не трогается: add-only соблюдён буквально, а текущее состояние — свёртка «последняя запись
// каждого id». Цена — рост файла при правках текста; она записана в отчёте и в `docs/DEBTS.md`.
//
// `mintedAtRev` — РЕВИЗИЯ ЭТОЙ ЗАПИСИ (`INFERENCE`: ADR-0004 §4 называет поле, но не определяет
// его семантику). Ревизия минта якоря = минимум `mintedAtRev` по его записям, то есть выводима
// из файла и не требует внешнего счётчика; следующая ревизия = максимум по файлу + 1.

import { parseFamilyText, renderFamily, type AnchorEntry } from '@vpe/schema';

import { AnchorLedgerError } from './errors.js';

/** Имя файла ledger'а (ADR-0005 §1). Оно же уходит в сообщения об ошибках разбора. */
export const LEDGER_FILE = 'anchors.lock.jsonl';

/** Пустой ledger: ни одной записи. Ревизия такого файла — 0, первая запись пойдёт в 1. */
export const EMPTY_LEDGER: readonly AnchorEntry[] = [];

/**
 * Разбирает текст `anchors.lock.jsonl`.
 *
 * @throws {FamilyReadError} нет шапки `{"schema":"anchors/1"}` первой строкой, не то семейство,
 *   неизвестная версия, строка не разбирается как JSON.
 * @throws {z.ZodError} запись не соответствует схеме `anchors/1` — с путём к полю.
 */
export function parseLedger(text: string, file: string = LEDGER_FILE): readonly AnchorEntry[] {
  const { value } = parseFamilyText(text, file, { expectFamily: 'anchors' });
  return value as readonly AnchorEntry[];
}

/**
 * Каноническая форма файла целиком: шапка первой строкой, дальше запись на строку.
 *
 * Пишет `renderFamily` из `@vpe/schema` — тот же писатель, что у остальных одиннадцати
 * семейств. Своего эмиттера здесь нет и быть не должно: порядок ключей внутри записи задан
 * порядком объявления в схеме (`S-02`), и вторая его копия разъехалась бы с первой.
 */
export function renderLedger(records: readonly AnchorEntry[]): string {
  return renderFamily('anchors', records);
}

/** Следующая ревизия: максимум по файлу + 1. У пустого ledger'а первая ревизия — 1. */
export function nextRev(records: readonly AnchorEntry[]): number {
  let max = 0;
  for (const record of records) {
    if (record.mintedAtRev > max) max = record.mintedAtRev;
  }
  return max + 1;
}

/** Последняя запись каждого id — текущее состояние якоря. Порядок карты = порядок первых записей. */
export function latestById(records: readonly AnchorEntry[]): Map<string, AnchorEntry> {
  const out = new Map<string, AnchorEntry>();
  for (const record of records) out.set(record.id, record);
  return out;
}

/**
 * Живые якоря: те, у кого ПОСЛЕДНЯЯ запись имеет `status: 'live'`.
 *
 * Наивный фильтр по строкам (`records.filter((r) => r.status === 'live')`) считал бы живым
 * каждый помеченный мёртвым якорь: строка со `status: 'live'` остаётся в файле навсегда — её
 * нельзя ни удалить, ни изменить (A8). Свёртка — единственное честное чтение add-only-журнала.
 */
export function liveAnchors(records: readonly AnchorEntry[]): Map<string, AnchorEntry> {
  const out = new Map<string, AnchorEntry>();
  for (const [id, record] of latestById(records)) {
    if (record.status === 'live') out.set(id, record);
  }
  return out;
}

/** Поля, которые у одного якоря не меняются НИКОГДА. Их расхождение — не история, а коллизия. */
function identityOf(record: AnchorEntry): string {
  return [record.chapterId, record.sceneId, record.surface, record.origin].join(' ');
}

/**
 * **A3 — все якоря со `status: live` уникальны.**
 *
 * ЧТО ИМЕННО ЛОВИТСЯ. Merge двух веток, отошедших от одной ревизии: `jsonl` мержится как
 * объединение множеств (ADR-0005 §10), поэтому обе ветки приносят свои строки, и в файле
 * оказываются две ЖИВЫЕ записи одного id, описывающие РАЗНЫЕ якоря. Свёртка молча взяла бы
 * последнюю — то есть один из двух якорей исчез бы вместе со всем, что к нему привязано.
 *
 * ПРИЗНАК — РАЗНАЯ ЛИЧНОСТЬ: `chapterId`/`sceneId`/`surface`/`origin`. У одного якоря они не
 * меняются никогда: слово с другой поверхностной формой — другое слово (диффом оно не
 * сматчится), а слово, уехавшее в другую сцену, минтится заново (дифф идёт посценно). Меняться
 * могут только `ordinal`/`prev`/`next` — позиция и контекст, и их расхождение между двумя
 * записями одного id есть ИСТОРИЯ, а не коллизия.
 *
 * ЧЕГО ЭТА ПРОВЕРКА НЕ ЛОВИТ, И ПОЧЕМУ ЭТО ПРИНЯТО. Если две ветки выдали один id ОДНОМУ И ТОМУ
 * ЖЕ слову в одной и той же сцене, личности совпадут и проверка промолчит. Соблазн добавить
 * второй признак («две записи в одной ревизии — значит писателей было два») отвергнут ЗАМЕРОМ:
 * он краснеет на самом обычном сценарии — обе ветки правят соседние слова, обе дописывают
 * свежий контекст ОДНОМУ уцелевшему якорю, и это не конфликт, а история, которая на следующем
 * же разборе схлопывается сама. Ложное срабатывание на штатной работе дороже, чем незакрытый
 * случай с вероятностью 2⁻⁸⁰, помноженной на совпадение слова и сцены; случай записан долгом.
 *
 * @throws {AnchorLedgerError} найден дубль живого id.
 */
export function assertUniqueLive(records: readonly AnchorEntry[]): void {
  const live = liveAnchors(records);
  const byId = new Map<string, AnchorEntry[]>();
  for (const record of records) {
    if (!live.has(record.id)) continue;
    const bucket = byId.get(record.id);
    if (bucket === undefined) byId.set(record.id, [record]);
    else bucket.push(record);
  }

  for (const [id, bucket] of byId) {
    const identities = new Set(bucket.map(identityOf));
    if (identities.size > 1) {
      const shown = bucket
        .map((r) => `\`${r.surface}\` (сцена \`${r.sceneId}\`, ревизия ${String(r.mintedAtRev)})`)
        .join(' и ');
      throw new AnchorLedgerError(
        'A3',
        `id \`${id}\` описывает разные якоря: ${shown}. Так выглядит merge двух веток, ` +
          'минтивших одинаковые id разным токенам (ADR-0004 §4, M3). Ни одну из веток нельзя ' +
          'принять молча: правка, привязанная к этому id, применилась бы к чужому слову',
      );
    }
  }
}

/**
 * **A8 — история не переписывается.**
 *
 * Писатель отказывается сохранять файл, в котором изменилась или исчезла хотя бы одна уже
 * существующая строка. Проверка ровно такая: прежний текст обязан быть ПРЕФИКСОМ нового —
 * построчно, включая шапку.
 *
 * @throws {AnchorLedgerError} строка изменилась, исчезла или файл стал короче.
 */
export function assertAddOnly(previousText: string, nextText: string): void {
  if (previousText === '') return;
  const before = previousText.split('\n');
  const after = nextText.split('\n');
  // Хвостовой перевод строки даёт пустой элемент в конце обоих массивов — он не запись.
  if (before[before.length - 1] === '') before.pop();
  if (after[after.length - 1] === '') after.pop();

  if (after.length < before.length) {
    throw new AnchorLedgerError(
      'A8',
      `в новом файле ${String(after.length)} строк против ${String(before.length)} в прежнем: ` +
        'записи ledger’а не удаляются. Исчезнувший якорь помечается `status: "dead"` НОВОЙ ' +
        'строкой (ADR-0004 §4)',
      after.length + 1,
    );
  }
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      throw new AnchorLedgerError(
        'A8',
        'существующая строка изменена, а ledger — add-only (ADR-0005 §10). Было: ' +
          `${before[index] ?? ''} ; стало: ${after[index] ?? ''}. ` +
          'Смена состояния якоря — НОВАЯ строка, а не правка старой',
        index + 1,
      );
    }
  }
}
