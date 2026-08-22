// base32 — вторая половина `chunkKey` (ADR-0010 §3a):
//
//     chunkKey = base32( blake3( … ) )[:16]
//
// АЛФАВИТ: `INFERENCE`, не решение. ADR-0010 §3a называет функцию, но **не называет алфавит**;
// ни один другой документ репозитория его не называет тоже. Взят **RFC 4648 §6 base32**,
// приведённый к нижнему регистру, **без паддинга**:
//
//     abcdefghijklmnopqrstuvwxyz234567
//
// Три основания, каждое проверяемое: (1) RFC 4648 — единственный нормативный base32, и его
// алфавит не содержит `0`/`1`/`8`/`9`, то есть исключает пары `0`↔`O` и `1`↔`l` в имени файла
// (`voice/takes/<chunkKey>.json`); (2) нижний регистр — потому что имя файла попадает в git и
// обязано быть одинаковым на регистронезависимой ФС; (3) паддинг `=` не нужен и вреден:
// длина дайджеста фиксирована, а `=` в имени файла — лишний спецсимвол.
//
// **Если владелец назовёт другой алфавит, меняется он один — здесь**, и это меняет все
// `chunkKey`. Поэтому решение записано явно, а не растворено в коде.

/** RFC 4648 §6, строчными. */
export const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

const DECODE = new Map<string, number>(
  [...BASE32_ALPHABET].map((symbol, index) => [symbol, index]),
);

/** base32 без паддинга, строчными. */
export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 0x1f] ?? '';
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f] ?? '';
  }
  return out;
}

/**
 * Обратное преобразование. Существует ради проверяемости: односторонний кодировщик нельзя
 * проверить round-trip'ом, а любая ошибка в нём тихо переименовала бы все `chunkKey`.
 *
 * @throws `TypeError` на символе вне алфавита (в том числе на заглавных и на `0`/`1`/`8`/`9`),
 *   на длине, не соответствующей ни одному числу байт, и на ненулевых битах хвоста —
 *   последнее означает, что у одних и тех же байт две записи.
 */
export function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const symbol of text) {
    const value = DECODE.get(symbol);
    if (value === undefined) {
      throw new TypeError(`base32: символ \`${symbol}\` вне алфавита RFC 4648 (строчные + 2–7)`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if (bits >= 5) {
    throw new TypeError(`base32: длина ${String(text.length)} не соответствует целому числу байт`);
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new TypeError('base32: ненулевые биты в хвосте — у этих байт была бы вторая запись');
  }
  return Uint8Array.from(out);
}
