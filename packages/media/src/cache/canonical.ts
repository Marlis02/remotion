// Инъективная каноническая форма входа ключей (`V-03`, ADR-0010 §3a, ADR-0006 §2).
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ЛЕЖИТ В `media/src/cache/`, ХОТЯ ПОЯВИЛСЯ В `voice` (`M-05`, решение
// владельца 2026-08-25, вопрос 2). Ключей кэша ТРИ (ADR-0006 §2), и считаются они в двух
// пакетах: `voiceKey` — в `voice` (он собирается из плана речи), `composeKey` и `segmentKey`
// — здесь. Каноническая форма у всех трёх обязана быть ОДНОЙ: разойдись две копии на одну
// строку — и переадресуется весь оплаченный кэш `voice`, а дубли не перегенерируются ни при
// каком промахе (ADR-0006 §2). Копию с охранником эквивалентности владелец отверг именно по
// этой цене: охранник проверяет выборку входов, а расхождение стоит всех денег сразу.
//
// Направление выбрано графом ADR-0009, а не вкусом: стрелка `voice → media` УЖЕ есть, обратной
// нет и быть не может, `core-model` закрыт (владелец отказался вскрывать его ради переезда
// файла). Поэтому форма живёт внизу, а `voice/plan/canonical.ts` остался РЕЭКСПОРТОМ — второй
// реализации в репозитории нет, и это проверяется грепом (`tests/lints/k1-one-canonical-form`).
// Цена, названная честно: модуль лежит в `cache/`, хотя сам по себе он не про кэш, а про
// инъективность входа хэша. Другого общего каталога у двух пакетов нет.
//
// ЧТО ЗДЕСЬ РЕШАЕТСЯ. Обе формулы записаны через «конкатенацию»:
//
//     chunkKey = base32( blake3( chapterId | sceneId | paragraphOrdinalInScene | splitIndex
//                                | blake3(spokenChunkText) ) )[:16]
//     voiceKey = blake3( spokenChunkText, providerId, modelId, voiceId, seed, providerOpts,
//                        roleDigest, ttsPipelineVersion )
//
// Знак конкатенации в ADR — математический, и наивная склейка строк ЕЙ НЕ РАВНА: пара
// `("a","bc")` и пара `("ab","c")` дают один и тот же вход `"abc"`, то есть два РАЗНЫХ места
// получают один `chunkKey` и делят один take-файл. Это не теоретическая придирка:
// `chapterId`/`sceneId` приходят из маркеров `## scene:` исходника, то есть их пишет автор, и
// подобрать такую пару может опечатка. Разделитель-символ (пробел, вертикальная черта) задачу
// не решает, а перекладывает: он обязан быть невозможным во ВСЕХ полях сразу, а `providerOpts`
// по ADR-0010 §8 — произвольный объект провайдера, который мы не нормируем.
//
// ФОРМА: НЕТСТРИНГ С ТЕГОМ ТИПА. Каждое поле кодируется как
//
//     <тег><длина полезной части в БАЙТАХ, десятично><двоеточие><полезная часть>
//
// Разбор однозначен: тег читается одним байтом, длина — до двоеточия, дальше ровно `длина`
// байт. Значит по байтам восстанавливается исходный кортеж, значит отображение инъективно —
// это доказательство, а не обещание, и оно стоит тестом (`plan-keys.test.ts`, «инъективность»).
//
// ТЕГ ТИПА НУЖЕН ОТДЕЛЬНО ОТ ДЛИНЫ. Без него строка `"7"` и число `7` дают одинаковые байты
// (`1:7`), то есть `seed: 7` и `seed: "7"` получили бы один ключ. С тегом это `s1:7` и `i1:7`.
//
// ЕДИНИЦА ДЛИНЫ — БАЙТ UTF-8, А НЕ CODE POINT И НЕ `String.length`. Хэшируются байты, поэтому
// и рамка обязана считаться в байтах: длина, посчитанная в UTF-16 units, разъехалась бы с
// содержимым на первом же не-ASCII символе, и разбор перестал бы быть однозначным ровно там,
// где текст перестаёт быть английским.

import { canonicalJson } from '@vpe/schema';

import { CacheError } from './errors.js';

const UTF8 = new TextEncoder();

/** Тег типа поля. Один байт, и он часть хэшируемого входа. */
export type PlanFieldKind = 'text' | 'int' | 'json';

/** Поле канонической формы: значение ПЛЮС его тип. */
export interface PlanField {
  readonly kind: PlanFieldKind;
  readonly value: unknown;
}

const TAG: Readonly<Record<PlanFieldKind, string>> = { text: 's', int: 'i', json: 'j' };

/** Строковое поле — идентификатор, хэш, произнесённый текст. */
export function text(value: string): PlanField {
  if (typeof value !== 'string') {
    throw new CacheError(
      'ADR-0006 §2',
      `поле канонической формы объявлено строкой, а пришло \`${typeof value}\` — ` +
        'молча привести его значило бы дать двум разным входам один ключ',
    );
  }
  return { kind: 'text', value };
}

/**
 * Целочисленное поле — `paragraphOrdinalInScene`, `splitIndex`, `seed`.
 *
 * Проверка на `Number.isSafeInteger` здесь не украшение: `2 ** 53` и `2 ** 53 + 1` дают одну и
 * ту же строку через `String`, то есть два разных seed'а получили бы один `voiceKey`. `-0`
 * отвергается отдельно — `String(-0)` равно `'0'`, и это второй способ получить ту же дыру.
 */
export function int(value: number): PlanField {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)) {
    throw new CacheError(
      'ADR-0006 §2',
      `целочисленное поле ключа = ${String(value)} — не целое в пределах ` +
        '`Number.isSafeInteger` либо `-0`. За этой границей разные значения дают одну ' +
        'десятичную запись, то есть два разных входа получают один ключ',
    );
  }
  return { kind: 'int', value };
}

/**
 * Объектное поле — `providerOpts` и список применимых ролей.
 *
 * Канонизация ОДНА на весь репозиторий — `canonicalJson` из `@vpe/schema` (решение владельца,
 * `V-03` вопрос 5: «двух канонизаций одного объекта быть не должно»). После `M-05` это верно
 * буквально: и `voiceKey`, и `composeKey`, и `segmentKey` зовут ОДНУ эту функцию. Она сортирует ключи на всех
 * уровнях байтовым компаратором UTF-8 и отвергает `NaN`, `undefined`, `Map`, `Date` и циклы
 * ошибкой с путём — то есть ровно те «тихие приведения», из-за которых два разных объекта
 * получили бы один ключ.
 */
export function json(value: unknown): PlanField {
  return { kind: 'json', value };
}

/** Полезная часть поля как текст — до кодирования в UTF-8. */
function payload(field: PlanField): string {
  switch (field.kind) {
    case 'text':
      return field.value as string;
    case 'int':
      return String(field.value as number);
    case 'json':
      return canonicalJson(field.value);
  }
}

/**
 * Байты канонической формы кортежа полей.
 *
 * Возвращает БАЙТЫ, а не строку, и это не вкусовщина: `blake3` принимает `Uint8Array` без
 * повторного кодирования, а склейка строк с последующим `TextEncoder` завела бы вопрос про
 * непарные суррогаты (кодировщик заменяет их на `U+FFFD`) внутрь самой рамки. Здесь рамка
 * считается по уже посчитанным байтам и от содержимого не зависит вовсе.
 */
export function canonicalFields(fields: readonly PlanField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const field of fields) {
    const body = UTF8.encode(payload(field));
    const head = UTF8.encode(`${TAG[field.kind]}${String(body.length)}:`);
    parts.push(head, body);
    total += head.length + body.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
