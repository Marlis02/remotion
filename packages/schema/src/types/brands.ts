// Branded-типы: `Samples`, `Frames`, `Sha256`, `Blake3`.
//
// ЗАЧЕМ БРЕНДЫ. `number` и `string` структурно совместимы со всем на свете: компилятор молча
// пропустит и сэмплы вместо кадров, и sha256 вместо blake3. Бренд делает эти ошибки
// невыразимыми, но только если значение НЕЛЬЗЯ получить кастом — поэтому единственный вход
// в тип здесь конструктор-валидатор, и никаких `as Samples` в остальном коде.
//
// ПОЧЕМУ ВРЕМЯ — ЦЕЛОЕ (ADR-0007 §3, roadmap `S-01`). Double разрешён ТОЛЬКО для геометрии
// (масштаб, поворот, прозрачность): там настоящий FP-риск — вычисление easing внутри рендерера,
// и тотальный фикспойнт от него не защищает. Время, индексы и счётчики — целые, и проверяется
// это `Number.isSafeInteger`, а не `Number.isInteger`: за границей 2^53 сложение перестаёт быть
// точным (`2^53 + 1 === 2^53`), то есть T2 «промежуточные произведения — `Number.isSafeInteger`»
// нарушается тихо.

declare const BRAND: unique symbol;

type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/** Сэмплы. Физическое время (ADR-0003 T1): единица — 1/`projectSampleRate` секунды. */
export type Samples = Brand<number, 'Samples'>;

/** Кадры. Время произведения (ADR-0003 T2). */
export type Frames = Brand<number, 'Frames'>;

/** sha256 в hex: CAS `.store`, `store.lock`, provenance ассетов (ADR-0005 §8). */
export type Sha256 = Brand<string, 'Sha256'>;

/** blake3 в hex: ключи кэша и `chunkKey`/`voiceKey` (ADR-0006 §2, ADR-0010 §3a). */
export type Blake3 = Brand<string, 'Blake3'>;

/** Длина hex-представления 32-байтового дайджеста. Обе величины — 32 байта. */
const HEX_DIGEST_LENGTH = 64;

/** Только строчные: один хэш обязан иметь ровно одну форму записи. */
const LOWERCASE_HEX = /^[0-9a-f]+$/;

function assertCountable(value: number, type: string): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${type}: ожидалось число, получено ${typeof value}`);
  }
  if (Object.is(value, -0)) {
    // `-0` отвергается везде одинаково — и здесь, и в `canonicalJson`. Иначе счётчик,
    // прошедший конструктор, уронил бы канонизацию на следующем шаге.
    throw new RangeError(`${type}: \`-0\` не является счётчиком (ADR-0007 §3)`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${type}: ожидалось целое в пределах Number.isSafeInteger, получено ${String(value)}`,
    );
  }
  if (value < 0) {
    throw new RangeError(`${type}: ожидалось значение ≥ 0, получено ${String(value)}`);
  }
}

function assertHexDigest(value: string, type: string): void {
  if (typeof value !== 'string') {
    throw new TypeError(`${type}: ожидалась строка, получено ${typeof value}`);
  }
  if (value.length !== HEX_DIGEST_LENGTH) {
    throw new RangeError(
      `${type}: ожидалось ${String(HEX_DIGEST_LENGTH)} hex-символов, получено ${String(value.length)}`,
    );
  }
  if (!LOWERCASE_HEX.test(value)) {
    // Именно ОТКАЗ, а не приведение к нижнему регистру: молчаливая нормализация означала бы,
    // что у одного дайджеста две законные записи, и сравнение строк перестаёт быть сравнением.
    throw new TypeError(`${type}: ожидался строчный hex \`[0-9a-f]\`, получено \`${value}\``);
  }
}

/** @throws `TypeError`/`RangeError`, если значение не целое ≥ 0 в пределах безопасных целых. */
export function asSamples(value: number): Samples {
  assertCountable(value, 'Samples');
  return value as Samples;
}

/** @throws `TypeError`/`RangeError`, если значение не целое ≥ 0 в пределах безопасных целых. */
export function asFrames(value: number): Frames {
  assertCountable(value, 'Frames');
  return value as Frames;
}

/** @throws `TypeError`/`RangeError`, если это не 64 строчных hex-символа. */
export function asSha256(value: string): Sha256 {
  assertHexDigest(value, 'Sha256');
  return value as Sha256;
}

/** @throws `TypeError`/`RangeError`, если это не 64 строчных hex-символа. */
export function asBlake3(value: string): Blake3 {
  assertHexDigest(value, 'Blake3');
  return value as Blake3;
}
