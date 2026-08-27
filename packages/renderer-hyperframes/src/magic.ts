// Расширение файла в каталоге композиции — ПО МАГИЧЕСКИМ БАЙТАМ.
//
// ПОЧЕМУ ВООБЩЕ ЕСТЬ ЭТА ЗАДАЧА. Запрос несёт `{sha256, path, role}` и `{sha256, path, family}`
// — расширения в нём нет ни одним полем (ADR-0008, «Контракт»), а браузеру нужен MIME, чтобы
// `<img src="./assets/<sha>.???">` вообще отобразился. Добавить `mime`/`ext` в запрос значило
// бы ИЗМЕНИТЬ КОНТРАКТ, что заданием `H-01` запрещено. Поэтому расширение ВЫВОДИТСЯ из байтов —
// решение владельца, вариант (а), §4 п. 6.
//
// ПОЧЕМУ НЕ ПО `path` ЗАПРОСА. Блоб в CAS адресуется своим sha256 и лежит БЕЗ расширения
// (ADR-0005 §8, `M-01`: `.store/<ab>/<sha>`); имя файла на входе — это адрес, а не тип.
// Вывод типа из имени вернул бы нас к «доверяем строке», от которого и уходит content-addressed
// хранилище.
//
// ПОЧЕМУ БЕЗ ЗАВИСИМОСТИ. Сигнатур пять, каждая — константный префикс; библиотека определения
// типов (`file-type` и родня) принесла бы десятки форматов, которых проект не поддерживает, и
// шестую внешнюю зависимость в пакет, чью карту зависимостей ADR-0009 называет поимённо.
//
// НЕИЗВЕСТНЫЙ ФОРМАТ — ОШИБКА, А НЕ `.bin`. Файл, чей тип мы не знаем, браузер отобразит
// «как получится», то есть по своему угадыванию, — и это ровно тот класс расхождения между
// машинами, ради которого шрифты передаются файлами с checksum (`FACT` r2 §7.4 п. 2).

import { RenderAdapterError } from './errors.js';

/** Одна сигнатура: смещение, байты, расширение, человеческое имя формата. */
interface Magic {
  readonly offset: number;
  readonly bytes: readonly number[];
  readonly ext: string;
  readonly name: string;
}

/**
 * Форматы, которые проект передаёт рендереру. Ровно те, что называет `asset-record/1`
 * (картинки), V10 (шрифты) и V6 (звук — в композицию не попадает, но отличать его от
 * «неизвестного» полезно: ошибка тогда называет причину, а не молчит).
 */
export const KNOWN_MAGIC: readonly Magic[] = Object.freeze([
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: 'png', name: 'PNG' },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], ext: 'jpg', name: 'JPEG' },
  // WebP: `RIFF....WEBP` — четыре байта размера между двумя маркерами, поэтому две записи.
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', name: 'RIFF-контейнер' },
  { offset: 0, bytes: [0x00, 0x01, 0x00, 0x00], ext: 'ttf', name: 'TrueType' },
  { offset: 0, bytes: [0x74, 0x72, 0x75, 0x65], ext: 'ttf', name: 'TrueType (true)' },
  { offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f], ext: 'otf', name: 'OpenType/CFF' },
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46], ext: 'woff', name: 'WOFF' },
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x32], ext: 'woff2', name: 'WOFF2' },
]);

const startsWith = (bytes: Uint8Array, magic: Magic): boolean => {
  if (bytes.length < magic.offset + magic.bytes.length) return false;
  return magic.bytes.every((b, i) => bytes[magic.offset + i] === b);
};

const isAt = (bytes: Uint8Array, offset: number, ascii: string): boolean =>
  [...ascii].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));

/**
 * Расширение файла по его первым байтам.
 *
 * @param bytes содержимое файла (достаточно первых 16 байт, но берётся весь буфер: он уже
 *   прочитан валидатором для сверки sha256, второго чтения не будет).
 * @param at адрес внутри запроса — попадёт в текст ошибки.
 * @throws {RenderAdapterError} `ADR-0008 форма` — формат неизвестен.
 */
export function extensionOf(bytes: Uint8Array, at: string): string {
  for (const magic of KNOWN_MAGIC) {
    if (!startsWith(bytes, magic)) continue;
    if (magic.ext !== 'webp') return magic.ext;
    // RIFF — семейство: WAV и WebP делят первые четыре байта. Различает их байт 8..11.
    if (isAt(bytes, 8, 'WEBP')) return 'webp';
    if (isAt(bytes, 8, 'WAVE')) {
      throw new RenderAdapterError('ADR-0008 форма', `${at}: файл — WAV (звук)`, [
        {
          rule: 'R5',
          at,
          message:
            'звук в каталоге композиции означал бы аудио-дорожку внутри сегмента, а сегменты ' +
            'немы (**R5**): дорожка ролика непрерывна и кодируется ОДИН раз при муксе (V6)',
        },
      ]);
    }
    break;
  }
  const head = [...bytes.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  throw new RenderAdapterError('ADR-0008 форма', `${at}: формат файла не опознан`, [
    {
      rule: 'ADR-0008 форма',
      at,
      message:
        `первые байты \`${head}\` не совпали ни с одной известной сигнатурой ` +
        `(${KNOWN_MAGIC.map((m) => m.name).join(', ')}). Расширение выводится из БАЙТОВ, ` +
        'потому что в запросе его нет ни одним полем, а добавить поле — значит изменить ' +
        'контракт ADR-0008. Неизвестный формат — отказ, а не `.bin`: браузер отобразил бы ' +
        'такой файл по своему угадыванию, и результат разошёлся бы между машинами',
    },
  ]);
}
