// blake3 — хэш ключей кэша (ADR-0006 §2), `chunkKey` и `voiceKey` (ADR-0010 §3a),
// `roleDigest` (V15) и `engineFingerprint` (ADR-0006 §3).
//
// РЕАЛИЗАЦИЯ — `@noble/hashes` 2.3.0: чистый JS, ноль зависимостей, MIT. Ни нативной сборки,
// ни WASM-блоба, и это не вкусовщина: нативный аддон или `.wasm` — это ещё один бинарный
// компонент, влияющий на байты, но не входящий в `engineFingerprint` (ADR-0006 §3, R14).
// Чистый JS такого компонента не создаёт — он воспроизводится из того же lockfile.
//
// Соответствие проверено официальными векторами BLAKE3 (см. `test/hash.test.ts`), а не
// доверием к пакету.

import { blake3 as nobleBlake3 } from '@noble/hashes/blake3.js';

import { asBlake3, type Blake3 } from '../types/brands.js';

const UTF8 = new TextEncoder();

const HEX = '0123456789abcdef';

/** hex строчными буквами, без зависимости от `Buffer` и от локали. */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX[(byte >> 4) & 0x0f] ?? '';
    out += HEX[byte & 0x0f] ?? '';
  }
  return out;
}

/**
 * Строка кодируется в UTF-8 **как есть**. Нормализация Unicode здесь НЕ выполняется:
 * ADR-0007 §6 требует NFC первым шагом лексера, то есть выше по потоку. Молчаливая
 * нормализация в хэш-функции сделала бы `blake3(x)` неотличимым от `blake3(nfc(x))` и
 * спрятала бы место, где нормализация обязана произойти.
 */
function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? UTF8.encode(input) : input;
}

/** Дайджест blake3, 32 байта. Нужен там, где дальше идёт `base32` (`chunkKey`). */
export function blake3Bytes(input: Uint8Array | string): Uint8Array {
  return nobleBlake3(toBytes(input));
}

/** Дайджест blake3 в hex, 64 строчных символа. */
export function blake3(input: Uint8Array | string): Blake3 {
  return asBlake3(toHex(blake3Bytes(input)));
}
