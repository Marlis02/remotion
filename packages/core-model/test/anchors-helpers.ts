// Общее для тестов ledger'а. Не тест — вспомогательный модуль (образец `test/etalon.ts`).
//
// ДЕТЕРМИНИРОВАННЫЙ ИСТОЧНИК СЛУЧАЙНОСТИ — ЭТО МОК, И ОН ОБЪЯВЛЕН МОКОМ. Тест детерминизма
// («два `parse` подряд дают одинаковый результат») обязан отделить свойство ledger'а от
// свойства CSPRNG: с настоящим `csprng` он был бы зелёным и в том случае, когда минт зовётся на
// каждом прогоне, — просто потому, что второй прогон переминтил бы всё и файл всё равно
// «получился». Подстановка источника делает утверждение проверяемым: id не меняются, потому что
// МИНТ НЕ ЗОВЁТСЯ, а не потому, что он вернул то же самое.
//
// Тест двух веток (M3) пользуется тем же моком в обратную сторону: две ветки с ОДНИМ сидом — это
// в точности отвергнутый детерминированный минт `blake3(seedRoot ‖ ledgerRev ‖ mintIndex)`, и
// инвариант A3 обязан его поймать.

import { splitmix32 } from './etalon.js';
import type { RandomBytes } from '../src/index.js';

/** Сид мока минта. Константа: падение обязано воспроизводиться, а не «повторяться иногда». */
export const MINT_SEED = 0xc04_2026;

/**
 * Источник байтов из `splitmix32`. Внутри одной ветки значения различны (полный период),
 * между двумя ветками с одним сидом — совпадают. И то и другое нужно тестам.
 */
export function seededRandom(seed: number = MINT_SEED): RandomBytes {
  const next = splitmix32(seed);
  return (byteLength: number): Uint8Array => {
    const out = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 4) {
      const word = next();
      out[index] = (word >>> 24) & 0xff;
      if (index + 1 < byteLength) out[index + 1] = (word >>> 16) & 0xff;
      if (index + 2 < byteLength) out[index + 2] = (word >>> 8) & 0xff;
      if (index + 3 < byteLength) out[index + 3] = word & 0xff;
    }
    return out;
  };
}

/** Источник, возвращающий одну и ту же константу: «минт, ставший функцией». */
export function constantRandom(fill = 0x2a): RandomBytes {
  return (byteLength: number): Uint8Array => new Uint8Array(byteLength).fill(fill);
}
