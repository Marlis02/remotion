// Общий инструмент тестов PCM-тракта (`M-03`).
//
// ПРАВИЛО ЭТИХ ТЕСТОВ: НИ ОДНОГО БИНАРНИКА В РЕПОЗИТОРИИ. Всякий сигнал синтезируется кодом
// из констант, поэтому golden-ожидания записаны числами, а не «файлом, который когда-то
// сняли». Второе следствие того же правила: ожидание можно проверить глазами по формуле.
//
// `fixtures/` эти тесты только ЧИТАЮТ. Значения профиля (`crossfadeSamples`, `resampler`,
// `loudness`) приходят из настоящей `fixtures/minimal/profiles/audio.yaml` читателем
// `S-02` — вторая копия чисел в тесте означала бы, что тест проверяет сам себя.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioProfileSchema, CompileProfileSchema, readFamily, type AudioProfile } from '@vpe/schema';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const AUDIO_PROFILE_FILE = path.join(REPO, 'fixtures/minimal/profiles/audio.yaml');
export const COMPILE_PROFILE_FILE = path.join(REPO, 'fixtures/minimal/profiles/compile.yaml');

/** `audio-profile/1` фикстуры — через читателя семейств, а не своим разбором YAML. */
export function audioProfileFixture(): AudioProfile {
  const { value } = readFamily(AUDIO_PROFILE_FILE, { expectFamily: 'audio-profile' });
  return AudioProfileSchema.parse(value);
}

/** `projectSampleRate` фикстуры. Умолчаний у тракта нет — частота приходит входом. */
export function projectSampleRateFixture(): number {
  const { value } = readFamily(COMPILE_PROFILE_FILE, { expectFamily: 'compile-profile' });
  return CompileProfileSchema.parse(value).projectSampleRate;
}

/**
 * Побайтовое равенство двух дорожек PCM — БЕЗ `toEqual` (`CP-05fix`, 2026-08-27).
 *
 * ПОЧЕМУ НЕ `expect([...a]).toEqual([...b])`. Спред разворачивает типизированный массив в
 * JS-массив боксированных чисел, а `toEqual` обходит его поэлементно и строит дифф. На выходе
 * ресемплера это 24 000 элементов, на дорожке ролика (`compile`) — 1 178 400, и там проверка
 * заняла больше пяти секунд, то есть таймаут теста (снято при приёмке `CP-05`).
 * `Buffer.compare` сравнивает те же байты одним нативным вызовом.
 *
 * ДИАГНОСТИКА УЛУЧШЕНА, А НЕ ПОТЕРЯНА: голое `Buffer.compare(...) === 0` дало бы
 * «false !== true». При несовпадении здесь ищется ПЕРВЫЙ расходящийся индекс и печатается
 * окно вокруг него — `toEqual` показал бы начало массива, а расхождение ресемплера лежит там,
 * где ему вздумается.
 *
 * `byteOffset`/`byteLength` передаются явно: `subarray` — окно в чужой буфер, и
 * `Buffer.from(a.buffer)` без них прочёл бы соседние байты.
 */
export function expectSameSamples(actual: Int16Array, expected: Int16Array, where: string): void {
  if (sameSamples(actual, expected)) return;
  if (actual.length !== expected.length) {
    throw new Error(`${where}: длина ${String(actual.length)} против ${String(expected.length)} сэмплов`);
  }
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at += 1;
  const from = Math.max(0, at - 2);
  const to = Math.min(actual.length, at + 3);
  throw new Error(
    `${where}: первое расхождение на сэмпле ${String(at)} из ${String(actual.length)}. ` +
      `Получено [${[...actual.subarray(from, to)].join(', ')}], ` +
      `ожидалось [${[...expected.subarray(from, to)].join(', ')}] (окно [${String(from)}, ${String(to)}))`,
  );
}

/**
 * То же сравнение ЗНАЧЕНИЕМ — для теста, которому нужно ОТРИЦАНИЕ («выход другой»).
 *
 * Отдельной функцией, а не `try/catch` вокруг `expectSameSamples`: перехватывать собственную
 * диагностику, чтобы узнать булево, — это способ однажды поймать чужую ошибку и принять её за
 * ответ.
 */
export function sameSamples(actual: Int16Array, expected: Int16Array): boolean {
  const view = (array: Int16Array): Buffer => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  return actual.length === expected.length && Buffer.compare(view(actual), view(expected)) === 0;
}

/** Дорожка из перечисленных сэмплов — самый частый вход golden-теста. */
export function samplesOf(values: readonly number[]): Int16Array {
  return Int16Array.from(values);
}

/**
 * Пила: `value(i) = start + step·i`, обрезанная по шкале s16 БЕЗ насыщения (значения
 * подбираются вызывающим так, чтобы обрезать было нечего). Нужна там, где важно, чтобы
 * соседние сэмплы отличались предсказуемо.
 */
export function ramp(length: number, start: number, step: number): Int16Array {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) out[i] = start + step * i;
  return out;
}

/** Постоянный уровень. Ровно то, на чём видно и микс, и насыщение, и фейд. */
export function constant(length: number, value: number): Int16Array {
  const out = new Int16Array(length);
  out.fill(value);
  return out;
}
