// Усиление и подавление дорожки — ЦЕЛОЧИСЛЕННО, ПО РАЦИОНАЛЬНОЙ ДРОБИ (`X-02`).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Микс складывает целые сэмплы (`mix.ts`), и чтобы это осталось
// правдой, всё, что стоит ДО сложения, обязано быть целочисленным тоже: `gainDb` подложки,
// `duckUnderSpeechDb` под речью и рампа между ними. Float на пути байтов означал бы, что два
// прогона одной сборки могут разойтись в последнем разряде, — то есть **AC4** держался бы на
// удаче реализации `Math.pow`.
//
// ГДЕ FLOAT ВСЁ-ТАКИ ЕСТЬ, И ПОЧЕМУ ЭТО НЕ ПРОТИВОРЕЧИЕ. Децибелы — величина логарифмическая,
// и перевод «дБ → отношение» без `Math.pow` не выражается. Он происходит РОВНО ОДИН РАЗ на
// клип (`gainFromDb`), даёт ЦЕЛЫЙ числитель при фиксированном знаменателе, и дальше по сэмплам
// идёт только целая арифметика. Приём и его охранник взяты у соседа дословно:
// `peakLimitFromDb` (`loudness.ts`) — единственное другое место тракта с `Math.pow` — проверяет
// устойчивость округления и ОТКАЗЫВАЕТ на пороге, где последний разряд `pow` решал бы исход.
//
// ЗНАМЕНАТЕЛЬ — `FULL_SCALE` (32768), И ЭТО НЕ ПРОИЗВОЛ. Шаг усиления при нём равен
// 1/32768 ≈ 0.0003 (−90 dBFS), то есть тоньше самой шкалы s16: ошибка представления усиления
// заведомо меньше кванта сэмпла. Взять меньший знаменатель значило бы округлять усиление
// грубее, чем звук; больший — не купить ничего, потому что результат всё равно целый сэмпл.
//
// ПРАВИЛО ОКРУГЛЕНИЯ У ВСЕХ ОДНО — `scaleSample` (`fade.ts`): к ближайшему, ничьи от нуля.
// Второго правила в тракте нет и быть не может (ADR-0003 T7, разбор — в шапке `fade.ts`).

import { addExact, assertSafeInteger, floorDiv, mulExact } from '@vpe/core-model';

import { AudioError } from './errors.js';
import { scaleSample } from './fade.js';
import { FULL_SCALE } from './loudness.js';
import { pcmS16, type PcmS16 } from './pcm.js';

/**
 * Насколько произведение обязано отстоять от ПОЛУЦЕЛОГО, чтобы округление не зависело от
 * платформы. У `peakLimitFromDb` опасен нуль расстояния до ЦЕЛОГО (там `Math.floor`), здесь —
 * до половины (здесь округление к ближайшему), и величина взята та же.
 */
const STABILITY_EPSILON = 1e-6;

/**
 * Усиление рациональной дробью: `numerator / denominator`, оба целые, знаменатель > 0.
 *
 * ЗНАЧЕНИЕ, А НЕ ЧИСЛО С ПЛАВАЮЩЕЙ ТОЧКОЙ, — чтобы усиление можно было НАПЕЧАТАТЬ в плане
 * (`dumpAudioPlan`) и сверить глазами: `4125/32768` проверяемо, `0.12589254117941673` — нет.
 */
export interface Gain {
  readonly numerator: number;
  readonly denominator: number;
}

/** Усиление «как есть». Отдельным значением, чтобы «без изменения» не писалось дробью. */
export const UNITY_GAIN: Gain = { numerator: FULL_SCALE, denominator: FULL_SCALE };

/**
 * Децибелы → рациональное усиление со знаменателем `FULL_SCALE`.
 *
 * `0 дБ` обрабатывается ДО всякого float: `10^0 = 1` точно, и считать это незачем (тот же
 * приём, что у `peakLimitFromDb` с порогом `≥ 0`).
 *
 * @throws {AudioError} значение не конечно; усиление > 0 дБ (подложка громче полной шкалы —
 *   это не «громче», а гарантированное насыщение: правило «компилятор не выдумывает звук»
 *   запрещает поднимать уровень выше принесённого автором); округление неустойчиво.
 */
export function gainFromDb(db: number): Gain {
  if (!Number.isFinite(db)) {
    throw new AudioError('X-02 микс (ADR-0003 T7)', `усиление = ${String(db)} дБ: ожидалось конечное число`);
  }
  if (db === 0) return UNITY_GAIN;
  if (db > 0) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `усиление = +${String(db)} дБ: тракт не поднимает уровень выше принесённого. ` +
        'Подложка громче полной шкалы означала бы насыщение по построению, а не решение ' +
        'автора; приведите громкость файла на ingest.',
    );
  }

  const exact = Math.pow(10, db / 20) * FULL_SCALE;
  const distance = Math.abs(exact - Math.floor(exact) - 0.5);
  if (distance <= STABILITY_EPSILON) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `усиление ${String(db)} дБ даёт числитель ${String(exact)}, лежащий к полуцелому ближе, ` +
        `чем ${String(STABILITY_EPSILON)}: округление зависело бы от реализации \`Math.pow\`. ` +
        'Возьмите значение, отстоящее от полуцелого (например, на 0.1 дБ дальше).',
    );
  }
  return { numerator: Math.round(exact), denominator: FULL_SCALE };
}

/** Проверка формы усиления — одна на все входы этого файла. */
function assertGain(gain: Gain, where: string): void {
  assertSafeInteger(gain.numerator, `${where}: числитель усиления`);
  assertSafeInteger(gain.denominator, `${where}: знаменатель усиления`);
  if (gain.denominator <= 0 || gain.numerator < 0) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `${where}: усиление ${String(gain.numerator)}/${String(gain.denominator)} — ` +
        'знаменатель обязан быть > 0, числитель ≥ 0',
    );
  }
}

/** Дорожка, умноженная на усиление. Копия, а не мутация: дорожка — значение. */
export function applyGain(pcm: PcmS16, gain: Gain): PcmS16 {
  assertGain(gain, 'усиление дорожки');
  if (gain.numerator === gain.denominator) return pcmS16(pcm.sampleRate, new Int16Array(pcm.samples));
  const out = new Int16Array(pcm.samples.length);
  for (let i = 0; i < pcm.samples.length; i += 1) {
    out[i] = scaleSample(pcm.samples[i] ?? 0, gain.numerator, gain.denominator);
  }
  return pcmS16(pcm.sampleRate, out);
}

/** Окно речи в координатах ЭТОЙ дорожки: `[fromSample, toSample)`. */
export interface DuckWindow {
  readonly fromSample: number;
  readonly toSample: number;
}

export interface DuckOptions {
  /** Окна, под которыми дорожка уходит вниз. Порядок и пересечения значения не имеют. */
  readonly windows: readonly DuckWindow[];
  /** Уровень вне окон — `gainDb` клипа. */
  readonly base: Gain;
  /** Уровень внутри окон — `gainDb + duckUnderSpeechDb`. */
  readonly ducked: Gain;
  /** Длина рампы в сэмплах. Ноль — законное значение: ступенька вместо рампы. */
  readonly rampSamples: number;
}

/**
 * Подавление дорожки на окнах речи — ПО ОКНАМ ПЛАНА, А НЕ ПО СИГНАЛУ.
 *
 * ПОЧЕМУ НЕ САЙДЧЕЙН. `SP-VID` A2-бис (2026-09-10) измерил: `sidechaincompress` этой сборки
 * ffmpeg НЕДЕТЕРМИНИРОВАН — 4 разных sha из 32 прогонов при неизменных входах (долг №259).
 * Окна речи известны плану до сэмпла (`AudioPlan.elements`), поэтому огибающая считается по
 * НИМ: результат зависит только от чисел плана, и два прогона равны по построению.
 *
 * РАМПА СТОИТ ПЕРЕД ОКНОМ И ПОСЛЕ НЕГО, А НЕ ВНУТРИ. К первому сэмплу речи подложка обязана
 * быть уже внизу — иначе первый слог тонет ровно в том, что duck и должен был убрать.
 * Поэтому спуск занимает `rampSamples` ДО начала окна, подъём — столько же ПОСЛЕ конца.
 *
 * ПЕРЕСЕЧЕНИЯ РАМП РАЗРЕШАЮТСЯ МИНИМУМОМ, и это ровно правило «уровень по расстоянию до
 * БЛИЖАЙШЕЙ фразы»: между двумя фразами, отстоящими меньше чем на две рампы, подложка к
 * базовому уровню не возвращается вовсе — она поднимается ровно настолько, насколько успевает
 * за половину промежутка. Минимум ещё и делает результат независимым от порядка окон — то
 * есть от порядка элементов плана.
 */
export function applyDuck(pcm: PcmS16, options: DuckOptions): PcmS16 {
  assertGain(options.base, 'уровень вне речи');
  assertGain(options.ducked, 'уровень под речью');
  assertSafeInteger(options.rampSamples, 'длина рампы duck');
  if (options.rampSamples < 0) {
    throw new AudioError('X-02 микс (ADR-0003 T7)', `длина рампы = ${String(options.rampSamples)}: ожидалось ≥ 0`);
  }
  if (options.base.denominator !== options.ducked.denominator) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `знаменатели уровней разошлись (${String(options.base.denominator)} против ` +
        `${String(options.ducked.denominator)}): рампа между ними считалась бы в двух шкалах`,
    );
  }

  const length = pcm.samples.length;
  const denominator = options.base.denominator;
  const numerators = new Int32Array(length).fill(options.base.numerator);
  const ramp = options.rampSamples;

  const lower = (index: number, value: number): void => {
    if (index < 0 || index >= length) return;
    if (value < (numerators[index] ?? 0)) numerators[index] = value;
  };

  for (const window of options.windows) {
    for (let i = Math.max(0, window.fromSample); i < Math.min(length, window.toSample); i += 1) {
      lower(i, options.ducked.numerator);
    }
    // Спуск: `k` сэмплов до начала окна — уровень идёт от базового к подавленному.
    for (let k = 1; k <= ramp; k += 1) {
      lower(window.fromSample - k, rampNumerator(options.ducked, options.base, k, ramp));
    }
    // Подъём: `k` сэмплов после конца окна — зеркально.
    for (let k = 0; k < ramp; k += 1) {
      lower(window.toSample + k, rampNumerator(options.ducked, options.base, k + 1, ramp));
    }
  }

  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = scaleSample(pcm.samples[i] ?? 0, numerators[i] ?? 0, denominator);
  }
  return pcmS16(pcm.sampleRate, out);
}

/**
 * Числитель на `k`-м шаге линейной рампы из `from` в `to` (`k = 0 … steps`).
 *
 * Целочисленно и тем же правилом округления, что у сэмплов: `from + round(Δ·k/steps)`,
 * где `round` — к ближайшему, ничьи от нуля. Монотонность — свойство линейной функции с
 * монотонным округлением, и она проверяется тестом, а не предполагается.
 */
function rampNumerator(from: Gain, to: Gain, k: number, steps: number): number {
  if (steps <= 0) return to.numerator;
  const delta = to.numerator - from.numerator;
  const magnitude = delta < 0 ? -delta : delta;
  const scaled = floorDiv(
    addExact(mulExact(mulExact(magnitude, k, 'рампа: |Δ|·k'), 2, 'удвоенное произведение'), steps, 'округление'),
    mulExact(steps, 2, 'удвоенный шаг'),
  );
  return from.numerator + (delta < 0 ? -scaled : scaled);
}
