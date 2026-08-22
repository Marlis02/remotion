// Эталон и генератор для property-тестов `C-01`.
//
// ПОЧЕМУ ЭТАЛОН НА `BigInt`. ADR-0003 T1 требует «property-тест против точной рациональной
// величины». `BigInt` даёт точное целое любой длины, то есть проверка идёт против настоящей
// математики, а не против второй копии той же формулы на `number`. Формулы здесь записаны
// прямо (это и есть эталон), но АРИФМЕТИКА другая: у проверяемого кода — double с ручными
// проверками `Number.isSafeInteger`, у эталона — точные целые без верхней границы.
//
// ПОЧЕМУ БЕЗ `fast-check`. Он был разрешён, но не понадобился: эталон точный, домены
// (пять fps × три sampleRate) перебираются целиком, границы перебираются исчерпывающе, а
// случайная часть закрывается генератором ниже. Цена зависимости — сеть при установке и
// ещё одна строка в `pnpm-lock.yaml`; выигрыш — сжатие контрпримера, которого здесь не нужно:
// вход одномерный и печатается целиком.
//
// СИД — КОНСТАНТА, И ОН ПЕЧАТАЕТСЯ. Падение обязано быть воспроизводимым командой из
// сообщения, а не «перезапустите, вдруг повторится».

/** Сид генератора. Константа: прогон обязан быть воспроизводимым (Charter V8). */
export const SEED = 0xc01_2026;

/**
 * splitmix32 — 32-битный генератор с полным периодом. Взят потому, что помещается в шесть
 * строк и не требует зависимости; `Math.random` запрещён (Charter V8 / ADR-0007 §4).
 */
export function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** Целое из `[0, bound]`. `bound` может превышать 2^32 — тогда берутся два слова. */
export function nextInt(rng: () => number, bound: number): number {
  if (bound <= 0) return 0;
  const draw = bound < 0x1_0000_0000 ? rng() : rng() * 0x1_0000_0000 + rng();
  return draw % (bound + 1);
}

// ── Точные целочисленные деления на `BigInt` ────────────────────────────────
// `BigInt` делит с усечением к нулю, поэтому floor/ceil дописываются явно.

export function floorDivBig(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

export function ceilDivBig(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) === (b < 0n) ? q + 1n : q;
}

// ── Эталоны трёх формул ADR-0003 ────────────────────────────────────────────

// Эталоны принимают те же `number`, что и проверяемые функции, и поднимают их в `BigInt`
// сами. Поэтому под селекторы линта T1 они не попадают ПО ПОСТРОЕНИЮ, а не по исключению:
// правый операнд умножения — вызов `BigInt(sampleRate)`, а не идентификатор `sampleRate`,
// и делитель — `1000n`, а не числовой литерал `1000`.

/** T1: `floorDiv(ms * sampleRate, 1000)`, точно. */
export function msToSamplesBig(ms: number, sampleRate: number): bigint {
  return floorDivBig(BigInt(ms) * BigInt(sampleRate), 1000n);
}

/** T2: `floor(f * sampleRate * fpsDen / fpsNum)`, точно. */
export function frameStartSampleBig(frame: number, sampleRate: number, num: number, den: number): bigint {
  return floorDivBig(BigInt(frame) * BigInt(sampleRate) * BigInt(den), BigInt(num));
}

/** T2: `floor((2*x*fpsNum + sampleRate*fpsDen) / (2*sampleRate*fpsDen))`, точно. */
export function frameOfSampleBig(sample: number, sampleRate: number, num: number, den: number): bigint {
  const rate = BigInt(sampleRate);
  const den2 = BigInt(den);
  const denominator = 2n * rate * den2;
  return floorDivBig(2n * BigInt(sample) * BigInt(num) + rate * den2, denominator);
}

/** Сокращённая дробь — независимо от `rational()` в продакшн-коде. */
export function reduceBig(num: bigint, den: bigint): { num: bigint; den: bigint } {
  let a = num < 0n ? -num : num;
  let b = den < 0n ? -den : den;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  if (a === 0n) return { num: 0n, den: 1n };
  const sign = den < 0n ? -1n : 1n;
  return { num: (num / a) * sign, den: (den / a) * sign };
}

// ── Матрица прогонов ────────────────────────────────────────────────────────

/** Пять fps: три целых, две дробные (`30000/1001` назван ADR-0003 T2 поимённо). */
export const FPS_MATRIX = [
  { label: '30/1', num: 30, den: 1 },
  { label: '60/1', num: 60, den: 1 },
  { label: '24/1', num: 24, den: 1 },
  { label: '30000/1001', num: 30000, den: 1001 },
  { label: '24000/1001', num: 24000, den: 1001 },
] as const;

/** `24000` — `projectSampleRate` проекта (`FACT` r1 §0.6); остальные два — ходовые. */
export const SAMPLE_RATES = [24000, 44100, 48000] as const;

/** Десять часов — верхняя граница, названная заданием `C-01`. */
export const TEN_HOURS_SECONDS = 10 * 60 * 60;

/** Все пятнадцать пар «частота дискретизации × fps». */
export function matrix(): { rate: number; fps: (typeof FPS_MATRIX)[number] }[] {
  return SAMPLE_RATES.flatMap((rate) => FPS_MATRIX.map((fps) => ({ rate, fps })));
}
