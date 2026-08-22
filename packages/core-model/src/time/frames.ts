// Кадровая арифметика на рациональном `fps{num, den}` (ADR-0003 T2, T3).
//
// ФОРМУЛЫ ВОСПРОИЗВЕДЕНЫ ДОСЛОВНО (ADR-0003 T2):
//
//     samplesPerFrame     = sampleRate * fpsDen / fpsNum                          (рационально)
//     frameStartSample(f) = floor(f * sampleRate * fpsDen / fpsNum)
//     frameOfSample(x)    = floor((2*x*fpsNum + sampleRate*fpsDen) / (2*sampleRate*fpsDen))
//
// Последняя — round-half-up, записанный целочисленно. `Math.round(x / S)` на double дал бы
// на достижимых входах тот же результат (ADR-0003, Alternatives: запас ~26 двоичных порядков),
// и это записано там как факт; целочисленная форма взята потому, что «одно исключение из
// правила «никаких float в компиляторе» хуже, чем ноль исключений».
//
// КАЖДОЕ ПРОМЕЖУТОЧНОЕ ПРОИЗВЕДЕНИЕ ПРОВЕРЕНО (T2) — через `mulExact`/`addExact`, и у каждого
// в сообщении стоит **имя величины** (`f · sampleRate · fpsDen`), а не имя переменной.
// Оператор `*` в этом файле не встречается ни разу: он и не может встретиться, потому что
// линт T1 запрещает `* sampleRate` вне `ms.ts` — а сюда всё равно нужна проверка на каждом шаге.
//
// ЗАПАС ДО 2^53. Худший достижимый случай — `frameOfSample` при 10 часах, 48 кГц и 30000/1001:
// `2 · x · fpsNum` ≈ 2 · 1.73·10⁹ · 30000 ≈ 1.0·10¹⁴, то есть ~90 раз до 9.0·10¹⁵. ADR обещает
// «запас три порядка»; здесь он посчитан для самой дорогой из пяти проверяемых fps.

import { asFrames, asSamples, type Frames, type Samples } from '@vpe/schema';

import { assertTimeGrid, type TimeGrid } from './grid.js';
import { addExact, floorDiv, mulExact } from './integer.js';
import { type FrameInterval } from './interval.js';
import { rational, type Rational } from './rational.js';

/**
 * Сэмплов на кадр — **точная** рациональная величина, а не double.
 *
 * При 48000 и 30000/1001 это 1601.6 (в двоичной дроби непредставимо), при 24000 и 30/1 — 800.
 * Функция, точная в одном случае и приблизительная в другом, хуже функции, которая никогда
 * не притворяется, — поэтому возвращается пара.
 */
export function samplesPerFrame(grid: TimeGrid): Rational {
  assertTimeGrid(grid);
  return rational(mulExact(grid.sampleRate, grid.fps.den, 'sampleRate · fpsDen'), grid.fps.num);
}

/**
 * Первый сэмпл кадра `f`: `floor(f * sampleRate * fpsDen / fpsNum)`.
 *
 * @throws `TimeModelError` (T2) на негодной сетке или переполнении промежуточного произведения.
 */
export function frameStartSample(grid: TimeGrid, frame: Frames): Samples {
  assertTimeGrid(grid);
  const byRate = mulExact(frame, grid.sampleRate, 'f · sampleRate');
  const numerator = mulExact(byRate, grid.fps.den, 'f · sampleRate · fpsDen');
  return asSamples(floorDiv(numerator, grid.fps.num));
}

/**
 * Длительность кадра `f` в сэмплах: `frameStartSample(f + 1) − frameStartSample(f)`.
 *
 * Величина **непостоянна**, когда `samplesPerFrame` дробное: при 48000 и 30000/1001 кадры
 * идут 1602/1601/1602/… Именно поэтому «сумма длительностей кадров за секунду == `sampleRate`»
 * (ADR-0003 T2) — содержательный тест, а не тавтология.
 */
export function frameLengthInSamples(grid: TimeGrid, frame: Frames): Samples {
  const next = asFrames(addExact(frame, 1, 'f + 1'));
  return asSamples(frameStartSample(grid, next) - frameStartSample(grid, frame));
}

/**
 * Кадр, которому принадлежит сэмпл `x`, с округлением half-up:
 * `floor((2*x*fpsNum + sampleRate*fpsDen) / (2*sampleRate*fpsDen))`.
 *
 * Проверка формулы из ADR-0003 T2: при `sampleRate = 24000, fps = 30/1` —
 * `frameOfSample(800) = 1`, `frameOfSample(400) = 1`, `frameOfSample(399) = 0`.
 *
 * ВНИМАНИЕ (T3): это АБСОЛЮТНОЕ квантование. Квантовать полагается относительно начала своего
 * сегмента — `localFrame(x) = frameOfSample(x − segmentStartSample)`, — и делает это `CP-04`,
 * а не эта функция: сегментов в `C-01` ещё нет.
 *
 * @throws `TimeModelError` (T2) на негодной сетке или переполнении промежуточного произведения.
 */
export function frameOfSample(grid: TimeGrid, sample: Samples): Frames {
  assertTimeGrid(grid);
  const twoX = mulExact(2, sample, '2 · x');
  const left = mulExact(twoX, grid.fps.num, '2 · x · fpsNum');
  const rateByDen = mulExact(grid.sampleRate, grid.fps.den, 'sampleRate · fpsDen');
  const numerator = addExact(left, rateByDen, '2 · x · fpsNum + sampleRate · fpsDen');
  const denominator = mulExact(2, rateByDen, '2 · sampleRate · fpsDen');
  return asFrames(floorDiv(numerator, denominator));
}

/**
 * `clipDurationInFrames = frameEnd − frameStart` (ADR-0003 T3, имя разведено в m2).
 *
 * Результат всегда ≥ 1: нулевой интервал непредставим (`frameInterval` его отвергает).
 * Случай «вышло 0 ⇒ принудительно 1 кадр с записью в BuildRecord» (T3) — это правило
 * УКЛАДЧИКА, и живёт оно там же, где укладчик (`CP-04`): здесь нечему записывать в
 * BuildRecord и не из чего выбирать.
 */
export function clipDurationInFrames(interval: FrameInterval): Frames {
  return asFrames(interval.frameEnd - interval.frameStart);
}
