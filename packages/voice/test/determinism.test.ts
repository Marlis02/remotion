// Детерминизм и арифметика перевода времени (`V-01`, решение владельца по вопросу 7).
//
// Два разных утверждения, и их нельзя смешивать:
//   * ДЕТЕРМИНИЗМ — один вход и один seed дают побайтово тот же PCM и те же интервалы;
//     разные seed'ы дают разный звук и ТЕ ЖЕ интервалы (истина по построению, на которой
//     позже стоит калибровка алигнера `A-03`);
//   * АРИФМЕТИКА — перевод через `msToSamples` даёт ровно те числа, что давал спайк
//     умножением на частоту. Это утверждение о ЦЕНЕ принятого решения, и оно проверяется
//     на границах, а не на одном примере.

import { msToSamples } from '@vpe/core-model';
import { bytesFromPcm } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import { MOCK_SAMPLE_RATE, makeTake, providerSecondsToSamples, synthPcm, synthesize } from '../src/index.js';

import { fixtureTakeAcceptance } from './fixture.js';

const TXT = 'Dr. Smith arrived, and the tide turned.';
/** Пороги — из `fixtures/minimal/profiles/audio.yaml`, а не из литералов (`V-02`). */
const ACCEPTANCE = fixtureTakeAcceptance();

/**
 * Сэмплов в миллисекунде при частоте mock'а — ЭТАЛОН, посчитанный НЕЗАВИСИМО, в `BigInt`.
 * Именно так это делает property-тест `C-01`: эталон обязан быть другим вычислением, а не
 * второй копией проверяемой формулы (и `/ 1000n` не подпадает под линт T1 — он про `1000`).
 */
const SAMPLES_PER_MS = Number(BigInt(MOCK_SAMPLE_RATE) / 1000n);

describe('детерминизм синтеза', () => {
  it('один вход и один seed — побайтово тот же PCM', () => {
    const a = bytesFromPcm(synthPcm(TXT, 20260821).pcm);
    const b = bytesFromPcm(synthPcm(TXT, 20260821).pcm);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('один вход и один seed — те же интервалы токенов и те же привязки', () => {
    const a = makeTake({ chunkKey: 'k', spokenText: TXT, seed: 3, acceptance: ACCEPTANCE });
    const b = makeTake({ chunkKey: 'k', spokenText: TXT, seed: 3, acceptance: ACCEPTANCE });
    expect(a.bindings).toEqual(b.bindings);
    expect(a.health).toEqual(b.health);
  });

  it('разные seed — разный звук, НО тот же alignment (истина по построению)', () => {
    const a = synthesize({ text: TXT, seed: 1 });
    const b = synthesize({ text: TXT, seed: 2 });
    expect(a.audio_base64).not.toBe(b.audio_base64);
    expect(a.alignment).toEqual(b.alignment);
    // Свойство, ради которого mock вообще пишется: калибровка `A-03` меряет ошибку алигнера
    // против ИЗВЕСТНОЙ истины, и seed на эту истину влиять не имеет права.
    expect(makeTake({ chunkKey: 'k', spokenText: TXT, seed: 1, acceptance: ACCEPTANCE }).bindings).toEqual(
      makeTake({ chunkKey: 'k', spokenText: TXT, seed: 2, acceptance: ACCEPTANCE }).bindings,
    );
  });

  it('прогон подряд не накапливает состояние: третий вызов равен первому', () => {
    const first = synthesize({ text: TXT, seed: 9 }).audio_base64;
    synthesize({ text: 'something else entirely', seed: 42 });
    const third = synthesize({ text: TXT, seed: 9 }).audio_base64;
    expect(third).toBe(first);
  });
});

describe('длина PCM привязана к расписанию, а не «не меньше» его', () => {
  it('numSamples равен расписанию РОВНО, а не с запасом', () => {
    // Найдено протоколом нарушений (№23): `msToSamples(totalMs + 1)` оставлял пакет зелёным —
    // утверждение теста 16 («end[last] ≤ numSamples») лишний сэмпл только подтверждает.
    // Молча удлинившийся дубль — это рассинхрон речи и субтитров, который не ловит ничего.
    const { numSamples, schedule: sch } = synthPcm(TXT, 1);
    expect(numSamples).toBe(msToSamples(sch.totalMs, MOCK_SAMPLE_RATE));
  });

  it('хвостового остатка нет: end[last] совпадает с концом дорожки', () => {
    const r = synthesize({ text: TXT, seed: 1 });
    const take = makeTake({ chunkKey: 'k', spokenText: TXT, seed: 1, acceptance: ACCEPTANCE });
    const n = r.alignment.characters.length;
    const lastEnd = r.alignment.character_end_times_seconds[n - 1] ?? Number.NaN;
    expect(providerSecondsToSamples(lastEnd, MOCK_SAMPLE_RATE)).toBe(r.__mock.numSamples);
    // `tailMs` профиля равен нулю ⇒ остаток обязан быть ровно нулём, а не «неотрицательным».
    expect(take.health.tailResidualSamples).toBe(0);
  });
});

describe('перевод времени: `msToSamples` вместо умножения на частоту', () => {
  it('на границах floor не теряет ничего: msToSamples(ms) === ms · 24', () => {
    // Границы: ноль, единица, вокруг секунды, час, и самый большой безопасный вход
    // (`ms · sampleRate` обязан оставаться в пределах Number.isSafeInteger, T2).
    const maxMs = Math.floor(Number.MAX_SAFE_INTEGER / MOCK_SAMPLE_RATE);
    for (const ms of [0, 1, 2, 999, 1000, 1001, 55, 320, 3_600_000, maxMs]) {
      expect(msToSamples(ms, MOCK_SAMPLE_RATE), `ms = ${String(ms)}`).toBe(ms * SAMPLES_PER_MS);
    }
  });

  it('за границей T2 — отказ, а не молча потерянные разряды', () => {
    const beyond = Math.floor(Number.MAX_SAFE_INTEGER / MOCK_SAMPLE_RATE) + 1;
    expect(() => msToSamples(beyond, MOCK_SAMPLE_RATE)).toThrow();
  });

  it('секунды в ответе — те же double, что давал спайк делением на 1000', () => {
    // Эталон — десятичные литералы: `ms / 1000` даёт ближайший double к точному значению,
    // и ровно его же даёт `msToSamples(ms) / sampleRate` (деление IEEE-754 корректно
    // округлено, а `ms · 24` и 24000 представимы точно). Литерал здесь — независимая запись
    // того же вещественного числа, а не вторая формула.
    const r = synthesize({ text: 'a. b', seed: 0 });
    // Расписание 'a. b': a = 55 мс, '.' = 20 + 320 = 340 мс, ' ' = 40 мс, b = 55 мс.
    expect(r.alignment.character_start_times_seconds).toEqual([0, 0.055, 0.395, 0.435]);
    expect(r.alignment.character_end_times_seconds).toEqual([0.055, 0.395, 0.435, 0.49]);
  });

  it('«чужие секунды → сэмплы» — одна функция, и она согласована с расписанием', () => {
    const r = synthesize({ text: TXT, seed: 5 });
    const sch = synthPcm(TXT, 5).schedule;
    const n = r.alignment.characters.length;
    for (let i = 0; i < n; i += 1) {
      const seconds = r.alignment.character_start_times_seconds[i] ?? Number.NaN;
      const viaMs = msToSamples(sch.startMs[i] ?? 0, MOCK_SAMPLE_RATE);
      expect(providerSecondsToSamples(seconds, MOCK_SAMPLE_RATE), `символ №${String(i)}`).toBe(viaMs);
    }
  });

  it('слоп конверсии ограничен одной миллисекундой — измерен, а не обещан', () => {
    // Чужой alignment приходит секундами с плавающей точкой и в целые миллисекунды не
    // ложится. Цена принятого решения: округление до 1 мс, то есть ≤ sampleRate/1000
    // сэмплов. Проверяется на числах, а не рассуждением.
    //
    // `seconds * MOCK_SAMPLE_RATE` ниже — ЭТАЛОН, то есть точное вещественное «сколько это
    // сэмплов», а не вторая реализация перевода: измеряется как раз отклонение нашей функции
    // от него. Это тот же приём и то же основание, что у `BigInt`-эталона property-теста
    // `C-01` («эталон обязан быть НЕЗАВИСИМЫМ вычислением, иначе он не эталон, а вторая копия
    // проверяемой формулы» — комментарий T1 в `eslint.config.js`).
    const slop = SAMPLES_PER_MS;
    for (const seconds of [0.0004, 0.12345678, 1.9999999, 12.3456789]) {
      const got = providerSecondsToSamples(seconds, MOCK_SAMPLE_RATE);
      const exact = seconds * MOCK_SAMPLE_RATE;
      expect(Math.abs(got - exact), `seconds = ${String(seconds)}`).toBeLessThanOrEqual(slop);
    }
  });

  it('правило округления — К БЛИЖАЙШЕМУ, и оно закреплено, а не подразумевается', () => {
    // Найдено протоколом нарушений (№24): при `Math.floor` вместо `Math.round` весь пакет
    // оставался ЗЕЛЁНЫМ — ни одно утверждение не различало два правила округления.
    // Значения подобраны так, чтобы round и floor давали РАЗНЫЙ ответ (проверено численно:
    // 0.0005 · 1000 = 0.5, 0.0015 · 1000 = 1.5, 1.9999999 · 1000 = 1999.9999).
    expect(providerSecondsToSamples(0.0005, MOCK_SAMPLE_RATE)).toBe(1 * SAMPLES_PER_MS);
    expect(providerSecondsToSamples(0.0015, MOCK_SAMPLE_RATE)).toBe(2 * SAMPLES_PER_MS);
    expect(providerSecondsToSamples(1.9999999, MOCK_SAMPLE_RATE)).toBe(2000 * SAMPLES_PER_MS);
    // И ниже половины миллисекунды — по-прежнему ноль: правило симметрично, а не «вверх».
    expect(providerSecondsToSamples(0.0004, MOCK_SAMPLE_RATE)).toBe(0);
  });

  it('нечисловой и отрицательный таймкод — отказ с названным правилом', () => {
    expect(() => providerSecondsToSamples(Number.NaN, MOCK_SAMPLE_RATE)).toThrow(/секунды провайдера/);
    expect(() => providerSecondsToSamples(-0.001, MOCK_SAMPLE_RATE)).toThrow(/секунды провайдера/);
    expect(() => providerSecondsToSamples(Number.POSITIVE_INFINITY, MOCK_SAMPLE_RATE)).toThrow();
  });
});
