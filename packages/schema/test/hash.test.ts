// `S-01` — blake3 и base32.
//
// Векторы blake3 — ОФИЦИАЛЬНЫЕ, а не посчитанные этой же библиотекой: проверка пакета самим
// пакетом ничего не проверяет. Источник — `test_vectors/test_vectors.json` референсной
// реализации BLAKE3:
//
//   https://raw.githubusercontent.com/BLAKE3-team/BLAKE3/master/test_vectors/test_vectors.json
//   получено 2026-08-22, HTTP 200; 35 случаев, взято 12.
//
// Правило построения входа — из шапки того же файла, дословно: «The input in each case is
// filled with a repeating sequence of 251 bytes: 0, 1, 2, ..., 249, 250, 0, 1, ... and so on».
// Длины выбраны по границам алгоритма: блок = 64 байта, чанк = 1024 байта, поэтому взяты
// 0–3, 63/64/65, 1023/1024/1025, 2048/2049 — то есть «до/ровно/после» каждой границы.
// Режимы `keyed_hash` и `derive_key` не проверяются: движок их не использует.

import { describe, expect, it } from 'vitest';

import {
  BASE32_ALPHABET,
  asBlake3,
  base32,
  base32Decode,
  blake3,
  blake3Bytes,
  canonicalJson,
} from '../src/index.js';

/** `0, 1, …, 250, 0, 1, …` — правило из шапки официального файла векторов. */
function officialInput(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_unused, i) => i % 251);
}

/** [длина входа, первые 32 байта расширенного вывода в hex]. */
const BLAKE3_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
  [1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
  [2, '7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63'],
  [3, 'e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f'],
  [63, 'e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b'],
  [64, '4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98'],
  [65, 'de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee'],
  [1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
  [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
  [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
  [2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
  [2049, '5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030'],
];

describe('S-01 — blake3 против официальных векторов BLAKE3', () => {
  it.each(BLAKE3_VECTORS)('вход длиной %i байт', (length, expected) => {
    expect(blake3(officialInput(length))).toBe(expected);
  });

  it('дайджест — 32 байта, и hex получен из них', () => {
    const bytes = blake3Bytes(officialInput(0));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(blake3(officialInput(0))).toBe(BLAKE3_VECTORS[0]?.[1]);
  });

  it('результат проходит конструктор бренда: 64 строчных hex-символа', () => {
    const digest = blake3('что угодно');
    expect(() => asBlake3(digest)).not.toThrow();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('строка кодируется в UTF-8 и ничем не отличается от тех же байт', () => {
    const text = 'caf\u00e9 \u{1F600}';
    expect(blake3(text)).toBe(blake3(new TextEncoder().encode(text)));
  });

  it('NFC и NFD дают РАЗНЫЕ хэши: нормализация — обязанность лексера, не хэша', () => {
    // ADR-0007 §6: NFC первым шагом лексера. Молчаливая нормализация здесь спрятала бы место,
    // где она обязана произойти, и NFD-вход выглядел бы обработанным.
    expect(blake3('caf\u00e9')).not.toBe(blake3('cafe\u0301'));
  });

  it('канонический JSON — законный вход хэша, и порядок вставки на него не влияет', () => {
    // ADR-0006 §2: ключ стадии = хэш канонической формы проекции. Это связка, ради которой
    // существуют обе функции: без канонизации `{a,b}` и `{b,a}` дали бы разные ключи кэша.
    expect(blake3(canonicalJson({ a: 1, b: 2 }))).toBe(blake3(canonicalJson({ b: 2, a: 1 })));
    expect(blake3(canonicalJson({ a: 1, b: 2 }))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('S-01 — base32 (RFC 4648, строчные, без паддинга)', () => {
  it('алфавит — ровно RFC 4648 §6 в нижнем регистре, 32 символа без 0/1/8/9', () => {
    expect(BASE32_ALPHABET).toBe('abcdefghijklmnopqrstuvwxyz234567');
    expect(BASE32_ALPHABET.length).toBe(32);
    expect(new Set(BASE32_ALPHABET).size).toBe(32);
    for (const bad of ['0', '1', '8', '9']) expect(BASE32_ALPHABET).not.toContain(bad);
  });

  // RFC 4648 §10 «Test Vectors», приведённые к нижнему регистру и без `=`.
  const RFC_VECTORS: ReadonlyArray<readonly [string, string]> = [
    ['', ''],
    ['f', 'my'],
    ['fo', 'mzxq'],
    ['foo', 'mzxw6'],
    ['foob', 'mzxw6yq'],
    ['fooba', 'mzxw6ytb'],
    ['foobar', 'mzxw6ytboi'],
  ];

  it.each(RFC_VECTORS)('RFC 4648 §10: base32("%s")', (input, expected) => {
    expect(base32(new TextEncoder().encode(input))).toBe(expected);
  });

  it('round-trip на всех длинах 0…64 байт (seeded, без Math.random)', () => {
    let state = 0xc0ff_ee01 >>> 0;
    const next = (): number => {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      return state & 0xff;
    };
    for (let length = 0; length <= 64; length += 1) {
      const bytes = Uint8Array.from({ length }, () => next());
      const text = base32(bytes);
      expect(base32Decode(text), `длина ${String(length)}`).toEqual(bytes);
      expect(text).toMatch(/^[a-z2-7]*$/);
    }
  });

  it('на дайджесте blake3 даёт 52 символа, из которых `chunkKey` берёт первые 16', () => {
    // ADR-0010 §3a: chunkKey = base32(blake3(…))[:16]. Само усечение — задача `V-03`;
    // здесь проверяется, что материала на него хватает.
    const text = base32(blake3Bytes(officialInput(0)));
    expect(text.length).toBe(52); // ceil(32 * 8 / 5)
    expect(text.slice(0, 16)).toMatch(/^[a-z2-7]{16}$/);
  });

  it('декодер отвергает символы вне алфавита, в том числе заглавные', () => {
    expect(() => base32Decode('MY')).toThrow(/вне алфавита/);
    expect(() => base32Decode('my0')).toThrow(/вне алфавита/);
    expect(() => base32Decode('my=')).toThrow(/вне алфавита/);
  });

  it('декодер отвергает длину, не соответствующую целому числу байт', () => {
    // 1 символ = 5 бит — ни одного полного байта.
    expect(() => base32Decode('a')).toThrow(/целому числу байт/);
  });

  it('декодер отвергает ненулевой хвост: иначе у одних байт две записи', () => {
    // `my` кодирует байт `f` (0x66) и оставляет 2 нулевых бита. `mz` — те же 8 бит данных
    // плюс мусор в хвосте; принять оба означало бы потерять однозначность `chunkKey`.
    expect(base32Decode('my')).toEqual(new TextEncoder().encode('f'));
    expect(() => base32Decode('mz')).toThrow(/ненулевые биты/);
  });
});
