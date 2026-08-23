// Внутренний формат PCM-тракта и его границы (`M-03`, roadmap §4 «`M-03` — PCM-тракт»).
//
// ФОРМАТ ТРАКТА — PCM s16le, МОНО, `projectSampleRate`. Решение владельца по вопросу 1
// сессии `M-03`; статус — `INFERENCE`, и вот из чего он выведен:
//
//   * `FACT` (ADR-0010 §9, r1 §0.6): речь запрашивается в `pcm_24000` — это s16 little-endian
//     моно. Второго формата на входе тракта нет ни у одного шага;
//   * `FACT` (ADR-0003 «Разделение sampleRate»): `projectSampleRate` — источник истины
//     физического времени, и музыка ресемплится в него **один раз на ingest**;
//   * битность и число каналов не называет НИ ОДИН ADR и не описывает схема `audio-profile/1`
//     (там `deliverySampleRate`, кодек, битрейт — про доставку, а не про тракт). Поэтому две
//     константы ниже — единственное место репозитория, где эта величина записана, и рядом
//     стоит кандидат в правку ADR-0003 (отчёт `M-03`).
//
// ПОЧЕМУ s16, А НЕ s32 ДЛЯ ПРОМЕЖУТОЧНОГО МИКСА (тот же вопрос 1). Цена s16 — clamp при
// сложении двух дорожек около полной шкалы. Цена s32 — ВТОРОЙ формат тракта и конверсия
// s32→s16 с собственным правилом округления, то есть ещё одно место, где детерминизм течёт.
// Выбран s16 везде; насыщение при этом не молчит — `mixSaturating` возвращает число
// обрезанных сэмплов фактом в отчёте (решение владельца: отказа не делать, решение
// «так и должно быть» принимает `CP-05`).
//
// ПОРЯДОК БАЙТОВ ВЫПИСАН РУКАМИ, И ЭТО НЕ ПЕДАНТИЗМ. `new Int16Array(bytes.buffer)` читает
// байты в порядке ХОЗЯИНА процесса; на big-endian машине тот же байтовый вход дал бы другие
// сэмплы, и весь тракт молча поменял бы звук — при этом все тесты на маленькой машине
// остались бы зелёными. Поэтому обе конверсии идут через `DataView` с явным `littleEndian`.

import { assertSafeInteger, mulExact } from '@vpe/core-model';

import { AudioError } from './errors.js';

/** Каналов у внутреннего формата ровно один. Стерео сводится на ingest, а не в тракте. */
export const PCM_CHANNELS = 1;

/** Битность внутреннего формата. Она же — битность `pcm_24000` у провайдера речи. */
export const PCM_BITS_PER_SAMPLE = 16;

/** Байт на сэмпл при `PCM_BITS_PER_SAMPLE = 16` и `PCM_CHANNELS = 1`. */
export const PCM_BYTES_PER_SAMPLE = 2;

/** Нижняя граница шкалы s16. Асимметрия шкалы (−32768 против +32767) — свойство формата. */
export const PCM_SAMPLE_MIN = -32768;

/** Верхняя граница шкалы s16. */
export const PCM_SAMPLE_MAX = 32767;

/**
 * Дорожка внутреннего формата.
 *
 * `channels` присутствует ПОЛЕМ, хотя значение сегодня одно: тип `1` делает стерео
 * невыразимым для компилятора, а не для комментария, — и в тот день, когда каналов станет
 * два, покраснеет каждое место, которое считало моно молча.
 *
 * ОГОВОРКА, ВХОДЯЩАЯ В ТИП: `Int16Array` изменяем, и `readonly` на поле охраняет ссылку, а не
 * содержимое. Конструктор массив НЕ копирует — на 60-секундном Short это 1.4 МБ на каждый
 * вызов, а вызовов в тракте много. Договор: **`pcmS16` принимает владение массивом**,
 * вызывающий его после этого не трогает. Долг записан в `docs/DEBTS.md`.
 */
export interface PcmS16 {
  /** Частота дискретизации дорожки. В миксе обязана равняться `projectSampleRate`. */
  readonly sampleRate: number;
  readonly channels: typeof PCM_CHANNELS;
  readonly samples: Int16Array;
}

/** Частота дискретизации: целое > 0. Проверка T2 — `assertSafeInteger` из `@vpe/core-model`. */
function assertSampleRate(sampleRate: number): void {
  assertSafeInteger(sampleRate, 'sampleRate');
  if (sampleRate <= 0) {
    throw new AudioError(
      'ADR-0003 «Разделение sampleRate»',
      `\`sampleRate\` = ${String(sampleRate)}: ожидалось целое > 0`,
    );
  }
}

/**
 * Единственный конструктор дорожки. Принимает владение массивом (см. оговорку у `PcmS16`).
 */
export function pcmS16(sampleRate: number, samples: Int16Array): PcmS16 {
  assertSampleRate(sampleRate);
  return { sampleRate, channels: PCM_CHANNELS, samples };
}

/**
 * Тишина заданной длины. Отдельной функцией, а не `new Int16Array(n)` у вызывающего: длина
 * проверяется тем же `assertSafeInteger`, что и всё остальное время тракта.
 */
export function silence(sampleRate: number, lengthSamples: number): PcmS16 {
  assertSafeInteger(lengthSamples, 'lengthSamples');
  if (lengthSamples < 0) {
    throw new AudioError(
      'M-03 формат тракта (INFERENCE)',
      `\`lengthSamples\` = ${String(lengthSamples)}: длина дорожки неотрицательна`,
    );
  }
  return pcmS16(sampleRate, new Int16Array(lengthSamples));
}

/**
 * Граница, ради которой написан критерий готовности «микс не зависит от версии ресемплера»:
 * в тракт (и, в частности, в микс) попадает ТОЛЬКО дорожка, уже приведённая к
 * `projectSampleRate`. Ресемплинг живёт строго на ingest (ADR-0010 §9), поэтому дорожка
 * с чужой частотой — не повод ресемплировать здесь, а повод отказать.
 */
export function assertProjectRate(pcm: PcmS16, projectSampleRate: number, where: string): void {
  assertSampleRate(projectSampleRate);
  if (pcm.sampleRate !== projectSampleRate) {
    throw new AudioError(
      'ADR-0003 «Разделение sampleRate»',
      `${where}: дорожка на ${String(pcm.sampleRate)} Гц при projectSampleRate = ` +
        `${String(projectSampleRate)} Гц. Ресемплинг музыки происходит ОДИН РАЗ на ingest ` +
        '(ADR-0010 §9) — тогда микс остаётся сложением целых сэмплов, и версия ресемплера ' +
        'не влияет на выход сборки. Приведите дорожку на ingest, а не здесь.',
    );
  }
}

/**
 * Байты s16le → дорожка. Вход — сырой поток (stdout ресемплера) либо кусок `data` из WAV.
 *
 * `bytes.byteOffset` учитывается: `Uint8Array` бывает окном в чужой буфер, и представление
 * с нулевым смещением прочитало бы чужие байты.
 */
export function pcmFromBytes(sampleRate: number, bytes: Uint8Array): PcmS16 {
  if (bytes.length % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new AudioError(
      'M-03 формат тракта (INFERENCE)',
      `длина потока ${String(bytes.length)} Б не кратна ${String(PCM_BYTES_PER_SAMPLE)} Б: ` +
        'формат тракта — PCM s16 моно, и половина сэмпла означает обрезанный вход.',
    );
  }
  const count = bytes.length / PCM_BYTES_PER_SAMPLE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(mulExact(i, PCM_BYTES_PER_SAMPLE, 'смещение сэмпла'), true);
  }
  return pcmS16(sampleRate, samples);
}

/** Дорожка → байты s16le. Обратная к `pcmFromBytes` побайтово; round-trip покрыт тестом. */
export function bytesFromPcm(pcm: PcmS16): Uint8Array {
  const bytes = new Uint8Array(mulExact(pcm.samples.length, PCM_BYTES_PER_SAMPLE, 'длина потока'));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.samples.length; i += 1) {
    view.setInt16(mulExact(i, PCM_BYTES_PER_SAMPLE, 'смещение сэмпла'), pcm.samples[i] ?? 0, true);
  }
  return bytes;
}
