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
