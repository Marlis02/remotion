// Целочисленная арифметика модели времени (ADR-0003 T1, T2).
//
// ЗАЧЕМ ЭТОТ ФАЙЛ. ADR-0003 T1 требует, чтобы `floorDiv`/`ceilDiv` жили рядом с `msToSamples`
// и были покрыты тем же property-тестом. ADR-0003 T2 требует, чтобы **каждое промежуточное
// произведение** проверялось `Number.isSafeInteger`. Второе требование исполнимо только если
// умножение — вызов функции, а не оператор: у оператора нет места, куда встроить проверку.
// Отсюда `mulExact`/`addExact`, и отсюда же то, что линт T1 («никаких `* sampleRate` вне
// `msToSamples`») ничему не мешает: законный путь к произведению один, и он проверяемый.
//
// ПОЧЕМУ ПРОВЕРКИ `Number.isSafeInteger` НА РЕЗУЛЬТАТЕ ДОСТАТОЧНО. Double представляет все
// целые до 2^53 точно, а IEEE-754 округляет результат умножения корректно. Значит: если
// истинное произведение ≤ 2^53 − 1, вычисленное равно ему **точно**; если истинное больше,
// вычисленное ≥ 2^53, и `Number.isSafeInteger` его отвергает (`MAX_SAFE_INTEGER` = 2^53 − 1,
// то есть само 2^53 уже не проходит). Промежутка, в котором цифры теряются молча, не остаётся.
// То же рассуждение — для сложения. Тест на границе 2^53 есть.
//
// ПОЧЕМУ ЗДЕСЬ ДОПУСКАЮТСЯ ОТРИЦАТЕЛЬНЫЕ. `Samples`/`Frames` неотрицательны по построению
// (`S-01`), но `floorDiv`/`ceilDiv` — общие целочисленные помощники, и в модели уже есть
// знаковые величины (`audio-profile/1 → avOffsetCompensationSamples`, ADR-0003 T6 `ε_i`).
// Помощник, врущий на отрицательных, — это отложенная ошибка, поэтому знак покрыт тестом.

import { TimeModelError } from './errors.js';

/**
 * @throws `TimeModelError` (T2), если значение не целое в пределах безопасных целых.
 * `name` — **имя величины**, а не имя переменной: по нему читается, какое произведение
 * переполнилось.
 */
export function assertSafeInteger(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TimeModelError(
      'ADR-0003 T2',
      `\`${name}\` = ${String(value)} — не целое в пределах Number.isSafeInteger (|x| ≤ 2^53 − 1). ` +
        'За этой границей сложение и умножение перестают быть точными молча, ' +
        'поэтому каждое промежуточное произведение проверяется, а не подразумевается.',
    );
  }
}

/** Произведение с проверкой T2 на обоих множителях и на результате. */
export function mulExact(a: number, b: number, name: string): number {
  assertSafeInteger(a, `${name} — левый множитель`);
  assertSafeInteger(b, `${name} — правый множитель`);
  const product = a * b;
  assertSafeInteger(product, name);
  return product;
}

/** Сумма с проверкой T2 на обоих слагаемых и на результате. */
export function addExact(a: number, b: number, name: string): number {
  assertSafeInteger(a, `${name} — левое слагаемое`);
  assertSafeInteger(b, `${name} — правое слагаемое`);
  const sum = a + b;
  assertSafeInteger(sum, name);
  return sum;
}

/**
 * Частное и остаток, вычисленные ТОЧНО.
 *
 * Наивное `Math.trunc(a / b)` на больших `a` промахивается на единицу: `a / b` — уже
 * округлённый double. Оператор `%` в ECMAScript определён как остаток от **точного**
 * деления (спецификация не разрешает ему округлять), поэтому `r` точен; `a − r` делится
 * на `b` нацело и по модулю не превосходит `|a|`, значит и это деление точное.
 */
function divRem(a: number, b: number, op: string): { q: number; r: number } {
  assertSafeInteger(a, `${op} — делимое`);
  assertSafeInteger(b, `${op} — делитель`);
  if (b === 0) {
    throw new TimeModelError('ADR-0003 T2', `${op}: деление на ноль`);
  }
  const r = a % b;
  const q = (a - r) / b;
  // `0 / -2` даёт `-0`; `-0` отвергается конструкторами брендов (`S-01`), и правильно —
  // счётчик со знаком минус не является счётчиком. Нормализуется здесь, а не у вызывающего.
  return { q: q === 0 ? 0 : q, r };
}

/** Деление с округлением к −∞. Целочисленно и точно, знак делимого и делителя любой. */
export function floorDiv(a: number, b: number): number {
  const { q, r } = divRem(a, b, 'floorDiv');
  return r !== 0 && (r < 0) !== (b < 0) ? q - 1 : q;
}

/** Деление с округлением к +∞. Целочисленно и точно, знак делимого и делителя любой. */
export function ceilDiv(a: number, b: number): number {
  const { q, r } = divRem(a, b, 'ceilDiv');
  return r !== 0 && (r < 0) === (b < 0) ? q + 1 : q;
}
