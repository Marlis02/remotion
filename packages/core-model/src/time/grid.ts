// Геометрия времени: частота дискретизации и кадровая частота.
//
// УМОЛЧАНИЙ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ. `fps = {num: 30, den: 1}` — величина `compileProfile`,
// то есть **часть произведения** (ADR-0003, раздел «fps = 30 — решение, а не умолчание»);
// `projectSampleRate = 24000` выбран по `FACT` r1 §0.6, а не по fps. Константа в модели
// означала бы, что смена fps правится в двух местах, а ключи кэша считаются от одного из них.
//
// ИНВАРИАНТА ДЕЛИМОСТИ `sampleRate % fps == 0` НЕТ (ADR-0003 T2, Context п. 1): он связывал бы
// выбор fps с тарифом TTS. Поэтому `fps` — рациональная пара, и `30000/1001` выразимо точно.
//
// ПОЧЕМУ СЕТКА ПРОВЕРЯЕТСЯ НА КАЖДОМ ВХОДЕ, А НЕ ТОЛЬКО В КОНСТРУКТОРЕ. `TimeGrid` —
// структурный тип: любой объектный литерал подходящей формы ему соответствует, и модель
// не может узнать, прошёл ли он `timeGrid()`. Это ровно то рассуждение, по которому `S-01`
// не пускает бренды через каст. Цена — три `Number.isSafeInteger` на вызов; она мала рядом
// с ценой сегмента, посчитанного при `fpsNum = 0`.

import { TimeModelError } from './errors.js';
import { assertSafeInteger } from './integer.js';

/**
 * Кадровая частота как точная дробь `num / den`.
 * Форма совпадает с `FpsSchema` (`compile-profile/1`, `@vpe/schema`) — тип-тест это стережёт.
 */
export interface Fps {
  readonly num: number;
  readonly den: number;
}

/** Пара величин, задающая перевод между сэмплами и кадрами. Обе — поля `compileProfile`. */
export interface TimeGrid {
  /** `projectSampleRate`: сэмплов в секунде. */
  readonly sampleRate: number;
  readonly fps: Fps;
}

function assertPositive(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value <= 0) {
    throw new TimeModelError('ADR-0003 T2', `\`${name}\` = ${String(value)} — ожидалось целое > 0`);
  }
}

/**
 * Проверяет сетку. Идемпотентна и вызывается каждой функцией кадровой арифметики.
 *
 * @throws `TimeModelError` (T2), если `sampleRate`, `fps.num` или `fps.den` не целое > 0.
 */
export function assertTimeGrid(grid: TimeGrid): void {
  if (typeof grid !== 'object' || grid === null) {
    throw new TimeModelError('ADR-0003 T2', `сетка времени: ожидался объект, получено ${typeof grid}`);
  }
  assertPositive(grid.sampleRate, 'sampleRate');
  assertPositive(grid.fps?.num, 'fps.num');
  assertPositive(grid.fps?.den, 'fps.den');
}

/**
 * Конструктор сетки: проверяет и замораживает.
 *
 * @throws `TimeModelError` (T2) — см. `assertTimeGrid`.
 */
export function timeGrid(sampleRate: number, fps: Fps): TimeGrid {
  const grid: TimeGrid = { sampleRate, fps: { num: fps?.num, den: fps?.den } };
  assertTimeGrid(grid);
  return Object.freeze({ sampleRate: grid.sampleRate, fps: Object.freeze(grid.fps) });
}
