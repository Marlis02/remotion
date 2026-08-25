// 18 unit-тестов интерфейса провайдера — ПЕРЕНОС `docs/spikes/sp2/mock.test.mjs` (блок 8 SP-2).
//
// Состав не урезан и не переставлен: восемнадцать случаев идут в том же порядке, с тем же
// материалом (`TXT`, `SEED`, `🚢 ahead`, `café` в NFC и NFD, `stop. Then`, `a. b`,
// `N A S A kept a station.`) и с теми же утверждениями. Механических отличий ровно три, и
// все три — следствие принятых решений сессии, а не смены проверяемого свойства:
//
//   1. `node:test` + `assert/strict` → `vitest` (`describe`/`it`/`expect`): в репозитории один
//      прогонщик тестов, и второй не заводится ради переноса;
//   2. `schedule` отдаёт ЦЕЛЫЕ МИЛЛИСЕКУНДЫ вместо секунд (решение владельца, вопрос 7) —
//      поэтому в тесте паузы сравнение идёт без множителя 1000, само неравенство то же;
//   3. `synthPcm` отдаёт `PcmS16` вместо `Buffer` (формат тракта `M-03`) — «побайтово» тем
//      самым проверяется через `bytesFromPcm`, то есть на тех же байтах, что уйдут в WAV.
//
// Разбор каждого отличия — `docs/impl/V-01/report.md`, раздел «Отклонения от спайка».
//
// ПРАВКА `V-02` (2026-08-24), механическая: приёмка получила пороги ОБЯЗАТЕЛЬНЫМ параметром
// (умолчания в коде были бы второй записью чисел профиля), поэтому вызовы `takeHealth` и
// `makeTake` получили объект `ACCEPTANCE`, прочитанный ИЗ ФИКСТУРЫ, а `rejectReason` стал
// литеральным union'ом — три ассерта, сверявшие свободный текст регуляркой, сверяют теперь
// причину. Проверяемые свойства и их число не изменились ни в одном из девятнадцати случаев;
// разбор — `docs/impl/V-02/report.md`, раздел «Правки чужих тестов».

import { bytesFromPcm, type PcmS16 } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import { refsOf } from './bind-helpers.js';
import { fixtureTakeAcceptance } from './fixture.js';

import {
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  PROVIDER_TIMESTAMPS,
  capabilities,
  makeTake,
  providerSecondsToSamples,
  schedule,
  synthPcm,
  synthesize,
  takeHealth,
  tokenIntervals,
} from '../src/index.js';

const TXT = 'Dr. Smith arrived, and the tide turned.';
const SEED = 20260821;
/** Пороги — из `fixtures/minimal/profiles/audio.yaml`, а не из литералов (`V-02`). */
const ACCEPTANCE = fixtureTakeAcceptance();

/** Байты дорожки — ровно те, что уйдут в WAV. Сравнение `Buffer.equals` побайтовое. */
const bytesOf = (pcm: PcmS16): Buffer => Buffer.from(bytesFromPcm(pcm));

describe('`tts:mock@1` — перенос SP-2, блок 8', () => {
  it('capabilities: набор полей из ADR-0010 §8 присутствует целиком', () => {
    for (const k of [
      'providerId', 'timestampUnit', 'timestampDomains', 'canDisableNormalization',
      'pcmFormats', 'seedSupport', 'requestStitching', 'requiresNetwork',
    ]) {
      expect(k in capabilities, `нет capability ${k}`).toBe(true);
    }
    expect(capabilities.requiresNetwork).toBe(false);
    expect(capabilities.canDisableNormalization).toBe(true);
  });

  it('форма ответа совпадает с ElevenLabs /with-timestamps', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    expect(typeof r.audio_base64 === 'string' && r.audio_base64.length > 0).toBe(true);
    for (const dom of [r.alignment, r.normalized_alignment]) {
      expect(Array.isArray(dom.characters)).toBe(true);
      expect(Array.isArray(dom.character_start_times_seconds)).toBe(true);
      expect(Array.isArray(dom.character_end_times_seconds)).toBe(true);
    }
  });

  it('charIdentity выполняется по построению', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    expect(r.alignment.characters.join('')).toBe(TXT);
  });

  it('нормализатора нет: normalized строго равен original', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    expect(r.normalized_alignment).toEqual(r.alignment);
  });

  it('единица массива — code point, а не UTF-16 unit (F13)', () => {
    const ship = '\uD83D\uDEA2 ahead'; // U+1F6A2
    const r = synthesize({ text: ship, seed: SEED });
    expect(r.alignment.characters.length).toBe([...ship].length);
    expect(r.alignment.characters.length).not.toBe(ship.length); // UTF-16 длиннее
    expect(r.alignment.characters.join('')).toBe(ship);
  });

  it('NFC и NFD дают РАЗНЫЕ дубли — расхождение обязано быть видимым (F16)', () => {
    const nfc = 'caf\u00E9';
    const nfd = 'cafe\u0301';
    const a = synthesize({ text: nfc, seed: SEED });
    const b = synthesize({ text: nfd, seed: SEED });
    expect(a.alignment.characters.length).not.toBe(b.alignment.characters.length);
    expect(a.alignment.characters.join('')).toBe(nfc);
    expect(b.alignment.characters.join('')).toBe(nfd);
  });

  it('длины трёх массивов равны и время монотонно', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    const n = r.alignment.characters.length;
    expect(r.alignment.character_start_times_seconds.length).toBe(n);
    expect(r.alignment.character_end_times_seconds.length).toBe(n);
    for (let i = 0; i < n; i += 1) {
      const start = r.alignment.character_start_times_seconds[i] ?? Number.NaN;
      const end = r.alignment.character_end_times_seconds[i] ?? Number.NaN;
      expect(start <= end).toBe(true);
      if (i > 0) expect(start >= (r.alignment.character_start_times_seconds[i - 1] ?? Number.NaN)).toBe(true);
    }
  });

  it('приёмка: здоровый дубль принимается', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    const h = takeHealth(TXT, r.alignment, r.__mock.numSamples, ACCEPTANCE);
    expect(h.verdict).toBe('accepted');
    expect(h.charIdentity).toBe(true);
    expect(h.uniqueTimestampRatio).toBe(1);
    expect(h.maxEqualRun).toBe(1);
    expect(h.tailResidualSamples >= 0).toBe(true);
  });

  it('приёмка: вырожденный alignment ОТВЕРГАЕТСЯ (баг провайдера r1 §2.1)', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    const n = r.alignment.characters.length;
    const degenerate = {
      ...r.alignment,
      character_start_times_seconds: new Array<number>(n).fill(0.5),
      character_end_times_seconds: new Array<number>(n).fill(0.6),
    };
    const h = takeHealth(TXT, degenerate, r.__mock.numSamples, ACCEPTANCE);
    expect(h.verdict).toBe('rejected');
    expect(h.rejectReason).toBe('unique-ratio');
  });

  it('приёмка: нарушенный charIdentity (alias словаря, ADR-0010 §7a) ОТВЕРГАЕТСЯ', () => {
    const sent = 'NASA kept a station.';
    const r = synthesize({ text: 'N A S A kept a station.', seed: SEED });
    const h = takeHealth(sent, r.alignment, r.__mock.numSamples, ACCEPTANCE);
    expect(h.verdict).toBe('rejected');
    expect(h.rejectReason).toBe('char-identity');
  });

  it('приёмка: отсутствующий alignment (оба поля nullable) ОТВЕРГАЕТСЯ', () => {
    const h = takeHealth(TXT, null, 1000, ACCEPTANCE);
    expect(h.verdict).toBe('rejected');
    expect(h.rejectReason).toBe('no-alignment');
  });

  // ПРАВИЛО ИНТЕРВАЛА ТОКЕНА ЖИВЁТ ТЕПЕРЬ В `bind/` (`V-05`), а этот тест остаётся здесь и
  // остаётся про MOCK: он проверяет, что РАСПИСАНИЕ синтеза кладёт паузу на знак и пробел, а
  // не внутрь буквы. Правило §6 на пяти разделителях и статусы токенов переехали вместе со
  // стадией — `test/bind.test.ts` и `test/token-status.test.ts`.
  it('правило интервала токена D10 п.6: знак и пробел в слово не входят', () => {
    const r = synthesize({ text: 'stop. Then', seed: SEED });
    const toks = tokenIntervals(r.alignment);
    expect(toks.map((t) => t.text)).toEqual(['stop', 'Then']);
    const idxDot = r.alignment.characters.indexOf('.');
    const endOfP = r.alignment.character_end_times_seconds[idxDot - 1] ?? Number.NaN;
    const endOfDot = r.alignment.character_end_times_seconds[idxDot] ?? Number.NaN;
    // конец слова `stop` = конец буквы `p`, а не конец точки
    expect(toks[0]?.end).toBe(endOfP);
    expect((toks[0]?.end ?? Number.NaN) < endOfDot).toBe(true);
    // и пауза за точкой не попала в слово
    expect((toks[1]?.start ?? Number.NaN) > endOfP + 0.3).toBe(true);
  });

  it('пауза на пунктуации существует и настраивается', () => {
    const s = schedule('a. b');
    const iDot = 1;
    // В спайке величина хранилась секундами и сравнение шло через `dot * 1000`;
    // здесь она хранится целыми миллисекундами — неравенство то же, множителя нет.
    const dotMs = (s.endMs[iDot] ?? Number.NaN) - (s.startMs[iDot] ?? Number.NaN);
    expect(dotMs >= (MOCK_PROFILE.punctuationPauseMs['.'] ?? Number.NaN), 'пауза не попала на знак').toBe(true);
    const alt = schedule('a. b', { ...MOCK_PROFILE, pauseGoesTo: 'space' });
    const spaceMs = (alt.endMs[2] ?? Number.NaN) - (alt.startMs[2] ?? Number.NaN);
    expect(
      spaceMs >= (MOCK_PROFILE.punctuationPauseMs['.'] ?? Number.NaN),
      'при pauseGoesTo=space пауза не попала на пробел',
    ).toBe(true);
  });

  it('пауза лежит ТОЛЬКО в одном месте — знак и пробел взаимно исключены', () => {
    // Тест сверх восемнадцати. Найдено протоколом нарушений (№28): при `pauseGoesTo`,
    // выброшенном из ветки знака, пауза оказывалась и на знаке, и на пробеле одновременно,
    // а предыдущий тест оставался зелёным — он проверяет «не меньше», и обе половины его
    // проходили. Здесь закреплены ТОЧНЫЕ длительности обеих категорий в обоих режимах.
    const punct = schedule('a. b');
    expect((punct.endMs[1] ?? 0) - (punct.startMs[1] ?? 0)).toBe(
      MOCK_PROFILE.punctuationSelfMs + (MOCK_PROFILE.punctuationPauseMs['.'] ?? 0),
    );
    expect((punct.endMs[2] ?? 0) - (punct.startMs[2] ?? 0)).toBe(MOCK_PROFILE.msPerSpace);

    const space = schedule('a. b', { ...MOCK_PROFILE, pauseGoesTo: 'space' });
    expect((space.endMs[1] ?? 0) - (space.startMs[1] ?? 0)).toBe(MOCK_PROFILE.punctuationSelfMs);
    expect((space.endMs[2] ?? 0) - (space.startMs[2] ?? 0)).toBe(
      MOCK_PROFILE.msPerSpace + (MOCK_PROFILE.punctuationPauseMs['.'] ?? 0),
    );
  });

  it('детерминизм: тот же текст и тот же seed дают побайтово тот же PCM', () => {
    const a = synthPcm(TXT, SEED);
    const b = synthPcm(TXT, SEED);
    expect(bytesOf(a.pcm).equals(bytesOf(b.pcm))).toBe(true);
    expect(a.numSamples).toBe(b.numSamples);
  });

  it('другой seed меняет звук, но НЕ меняет alignment (истина по построению)', () => {
    const a = synthPcm(TXT, 1);
    const b = synthPcm(TXT, 2);
    expect(bytesOf(a.pcm).equals(bytesOf(b.pcm))).toBe(false);
    expect(a.schedule.startMs).toEqual(b.schedule.startMs);
    expect(a.schedule.endMs).toEqual(b.schedule.endMs);
  });

  it('длина PCM согласована с alignment: end[last] не выходит за numSamples (T7)', () => {
    const r = synthesize({ text: TXT, seed: SEED });
    const n = r.alignment.characters.length;
    const lastEnd = r.alignment.character_end_times_seconds[n - 1] ?? Number.NaN;
    expect(providerSecondsToSamples(lastEnd, MOCK_SAMPLE_RATE) <= r.__mock.numSamples).toBe(true);
  });

  it('дубль по раскладке ADR-0010 §2 собирается и содержит обязательные поля', () => {
    const take = makeTake({
      chunkKey: 'test0000', spokenText: TXT, seed: SEED, acceptance: ACCEPTANCE, sha256: 'deadbeef',
      tokens: refsOf(TXT),
    });
    for (const k of [
      'chunkKey', 'spokenText', 'normalizerVersion', 'pcm', 'leadInSamples', 'tailSamples',
      'health', 'provenance', 'bindings', 'bind',
    ]) {
      expect(k in take, `нет поля ${k}`).toBe(true);
    }
    expect(take.health.verdict).toBe('accepted');
    expect(take.provenance.planTierAtGeneration).toBe('none');
    expect(take.bindings.length > 0).toBe(true);
    for (const b of take.bindings) {
      expect(b.status).toBe('measured');
      // Сужение для компилятора: у `absent` времени нет вовсе (**V8**, `V-02`), и утверждение
      // про интервал к нему неприменимо. В `TXT` непроизносимых токенов нет ни одного.
      if (b.status === 'absent') throw new Error(`токен ${b.anchorId} получил absent`);
      expect(b.endSample > b.startSample).toBe(true);
    }
  });

  it('bindings не пересекаются и идут по возрастанию', () => {
    const take = makeTake({
      chunkKey: 'test0000', spokenText: TXT, seed: SEED, acceptance: ACCEPTANCE, tokens: refsOf(TXT),
    });
    expect(take.bindings.length > 1).toBe(true);
    for (let i = 1; i < take.bindings.length; i += 1) {
      expect((take.bindings[i]?.startSample ?? -1) >= (take.bindings[i - 1]?.endSample ?? -1)).toBe(true);
    }
  });

  // ПРАВКА `V-05`: без токенов исходника дубль привязок НЕ ИМЕЕТ, и это честное значение.
  // До этой задачи `makeTake` собирал идентификатор якоря из порядкового номера токена —
  // подделка адреса пространства, которое минтится только в `core-model` (ADR-0004 §4).
  it('без токенов исходника привязок нет вовсе: `bindings: []` и `bind: null`', () => {
    const take = makeTake({ chunkKey: 'test0000', spokenText: TXT, seed: SEED, acceptance: ACCEPTANCE });
    expect(take.bindings).toEqual([]);
    expect(take.bind).toBeNull();
  });

  it('с токенами дубль несёт и привязки, и входы их пересчёта', () => {
    const tokens = refsOf(TXT);
    const take = makeTake({
      chunkKey: 'test0000', spokenText: TXT, seed: SEED, acceptance: ACCEPTANCE, tokens,
    });
    expect(take.bindings.length).toBe(tokens.length);
    expect(take.bind?.binderId).toBe(PROVIDER_TIMESTAMPS);
    expect(take.bind?.tokens).toEqual(tokens);
    expect(take.bind?.providerAlignment).toEqual(synthesize({ text: TXT, seed: SEED }).alignment);
  });
});
