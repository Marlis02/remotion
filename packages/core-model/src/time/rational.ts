// Рациональное число: числитель и знаменатель, оба целые.
//
// ЗАЧЕМ. ADR-0003 T2: «`samplesPerFrame = sampleRate * fpsDen / fpsNum` (может быть дробным —
// это нормально)». Вернуть эту величину числом типа `number` значило бы вернуть double:
// при 48000 и 30000/1001 это 1601.6 (не представимо точно в двоичной дроби), при 44100 и 30 —
// 1470 (представимо). Функция, которая иногда точна, а иногда нет, хуже функции, которая
// никогда не притворяется: величина возвращается парой и остаётся точной всегда.
//
// Пара всегда сокращена и знаменатель всегда положителен — иначе у одной величины было бы
// несколько записей, и сравнение пар перестало бы быть сравнением величин (та же причина,
// по которой `S-01` отвергает hex в верхнем регистре).

import { TimeModelError } from './errors.js';
import { assertSafeInteger } from './integer.js';

/** Точная рациональная величина: `num / den`, сокращена, `den > 0`. */
export interface Rational {
  readonly num: number;
  readonly den: number;
}

/** Наибольший общий делитель, алгоритм Евклида на остатках (`%` точен на безопасных целых). */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Конструктор рационального. Сокращает дробь и переносит знак в числитель.
 *
 * @throws `TimeModelError` (T2), если числитель или знаменатель не безопасное целое
 *   либо знаменатель равен нулю.
 */
export function rational(num: number, den: number): Rational {
  assertSafeInteger(num, 'rational — числитель');
  assertSafeInteger(den, 'rational — знаменатель');
  if (den === 0) {
    throw new TimeModelError('ADR-0003 T2', 'rational: знаменатель равен нулю');
  }
  const sign = den < 0 ? -1 : 1;
  const divisor = gcd(num, den);
  // `gcd(0, d) === d`, поэтому нулевой числитель даёт ровно `0/1`, а не `0/d`.
  if (divisor === 0) {
    return { num: 0, den: 1 };
  }
  const reducedNum = (num / divisor) * sign;
  return { num: reducedNum === 0 ? 0 : reducedNum, den: Math.abs(den) / divisor };
}
