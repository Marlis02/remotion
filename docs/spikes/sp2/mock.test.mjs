// SP-2 блок 8 — unit-тесты интерфейса провайдера. Запуск: ./run.sh --test mock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  synthesize, synthPcm, schedule, takeHealth, tokenIntervals, makeTake,
  capabilities, MOCK_PROFILE, SAMPLE_RATE,
} from './mock.mjs';

const TXT = 'Dr. Smith arrived, and the tide turned.';
const SEED = 20260821;

test('capabilities: набор полей из ADR-0010 §8 присутствует целиком', () => {
  for (const k of ['providerId','timestampUnit','timestampDomains','canDisableNormalization',
                   'pcmFormats','seedSupport','requestStitching','requiresNetwork']) {
    assert.ok(k in capabilities, `нет capability ${k}`);
  }
  assert.equal(capabilities.requiresNetwork, false);
  assert.equal(capabilities.canDisableNormalization, true);
});

test('форма ответа совпадает с ElevenLabs /with-timestamps', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  assert.ok(typeof r.audio_base64 === 'string' && r.audio_base64.length > 0);
  for (const dom of [r.alignment, r.normalized_alignment]) {
    assert.ok(Array.isArray(dom.characters));
    assert.ok(Array.isArray(dom.character_start_times_seconds));
    assert.ok(Array.isArray(dom.character_end_times_seconds));
  }
});

test('charIdentity выполняется по построению', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  assert.equal(r.alignment.characters.join(''), TXT);
});

test('нормализатора нет: normalized строго равен original', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  assert.deepEqual(r.normalized_alignment, r.alignment);
});

test('единица массива — code point, а не UTF-16 unit (F13)', () => {
  const ship = '\uD83D\uDEA2 ahead';   // U+1F6A2
  const r = synthesize({ text: ship, seed: SEED });
  assert.equal(r.alignment.characters.length, [...ship].length);
  assert.notEqual(r.alignment.characters.length, ship.length); // UTF-16 длиннее
  assert.equal(r.alignment.characters.join(''), ship);
});

test('NFC и NFD дают РАЗНЫЕ дубли — расхождение обязано быть видимым (F16)', () => {
  const nfc = 'caf\u00E9', nfd = 'cafe\u0301';   // NFC vs NFD
  const a = synthesize({ text: nfc, seed: SEED });
  const b = synthesize({ text: nfd, seed: SEED });
  assert.notEqual(a.alignment.characters.length, b.alignment.characters.length);
  assert.equal(a.alignment.characters.join(''), nfc);
  assert.equal(b.alignment.characters.join(''), nfd);
});

test('длины трёх массивов равны и время монотонно', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  const n = r.alignment.characters.length;
  assert.equal(r.alignment.character_start_times_seconds.length, n);
  assert.equal(r.alignment.character_end_times_seconds.length, n);
  for (let i = 0; i < n; i++) {
    assert.ok(r.alignment.character_start_times_seconds[i] <= r.alignment.character_end_times_seconds[i]);
    if (i) assert.ok(r.alignment.character_start_times_seconds[i] >= r.alignment.character_start_times_seconds[i - 1]);
  }
});

test('приёмка: здоровый дубль принимается', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  const h = takeHealth(TXT, r.alignment, r.__mock.numSamples);
  assert.equal(h.verdict, 'accepted');
  assert.equal(h.charIdentity, true);
  assert.equal(h.uniqueTimestampRatio, 1);
  assert.equal(h.maxEqualRun, 1);
  assert.ok(h.tailResidualSamples >= 0);
});

test('приёмка: вырожденный alignment ОТВЕРГАЕТСЯ (баг провайдера r1 §2.1)', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  const n = r.alignment.characters.length;
  const degenerate = { ...r.alignment,
    character_start_times_seconds: new Array(n).fill(0.5),
    character_end_times_seconds: new Array(n).fill(0.6) };
  const h = takeHealth(TXT, degenerate, r.__mock.numSamples);
  assert.equal(h.verdict, 'rejected');
  assert.match(h.rejectReason, /uniqueTimestampRatio/);
});

test('приёмка: нарушенный charIdentity (alias словаря, ADR-0010 §7a) ОТВЕРГАЕТСЯ', () => {
  const sent = 'NASA kept a station.';
  const r = synthesize({ text: 'N A S A kept a station.', seed: SEED });
  const h = takeHealth(sent, r.alignment, r.__mock.numSamples);
  assert.equal(h.verdict, 'rejected');
  assert.match(h.rejectReason, /charIdentity/);
});

test('приёмка: отсутствующий alignment (оба поля nullable) ОТВЕРГАЕТСЯ', () => {
  const h = takeHealth(TXT, null, 1000);
  assert.equal(h.verdict, 'rejected');
  assert.match(h.rejectReason, /отсутствует/);
});

test('правило интервала токена D10 п.6: знак и пробел в слово не входят', () => {
  const r = synthesize({ text: 'stop. Then', seed: SEED });
  const toks = tokenIntervals(r.alignment);
  assert.deepEqual(toks.map((t) => t.text), ['stop', 'Then']);
  const idxDot = r.alignment.characters.indexOf('.');
  // конец слова `stop` = конец буквы `p`, а не конец точки
  assert.equal(toks[0].end, r.alignment.character_end_times_seconds[idxDot - 1]);
  assert.ok(toks[0].end < r.alignment.character_end_times_seconds[idxDot]);
  // и пауза за точкой не попала в слово
  assert.ok(toks[1].start > r.alignment.character_end_times_seconds[idxDot - 1] + 0.3);
});

test('пауза на пунктуации существует и настраивается', () => {
  const s = schedule('a. b');
  const iDot = 1;
  const dot = s.ends[iDot] - s.starts[iDot];
  assert.ok(dot * 1000 >= MOCK_PROFILE.punctuationPauseMs['.'], 'пауза не попала на знак');
  const alt = schedule('a. b', { ...MOCK_PROFILE, pauseGoesTo: 'space' });
  assert.ok((alt.ends[2] - alt.starts[2]) * 1000 >= MOCK_PROFILE.punctuationPauseMs['.'],
    'при pauseGoesTo=space пауза не попала на пробел');
});

test('детерминизм: тот же текст и тот же seed дают побайтово тот же PCM', () => {
  const a = synthPcm(TXT, SEED), b = synthPcm(TXT, SEED);
  assert.ok(a.pcm.equals(b.pcm));
  assert.equal(a.numSamples, b.numSamples);
});

test('другой seed меняет звук, но НЕ меняет alignment (истина по построению)', () => {
  const a = synthPcm(TXT, 1), b = synthPcm(TXT, 2);
  assert.ok(!a.pcm.equals(b.pcm));
  assert.deepEqual(a.schedule.starts, b.schedule.starts);
  assert.deepEqual(a.schedule.ends, b.schedule.ends);
});

test('длина PCM согласована с alignment: end[last] не выходит за numSamples (T7)', () => {
  const r = synthesize({ text: TXT, seed: SEED });
  const n = r.alignment.characters.length;
  const lastEnd = r.alignment.character_end_times_seconds[n - 1];
  assert.ok(Math.round(lastEnd * SAMPLE_RATE) <= r.__mock.numSamples);
});

test('дубль по раскладке ADR-0010 §2 собирается и содержит обязательные поля', () => {
  const take = makeTake({ chunkKey: 'test0000', spokenText: TXT, seed: SEED, sha256: 'deadbeef' });
  for (const k of ['chunkKey','spokenText','normalizerVersion','pcm','leadInSamples','tailSamples','health','provenance','bindings']) {
    assert.ok(k in take, `нет поля ${k}`);
  }
  assert.equal(take.health.verdict, 'accepted');
  assert.equal(take.provenance.planTierAtGeneration, 'none');
  assert.ok(take.bindings.length > 0);
  for (const b of take.bindings) {
    assert.equal(b.status, 'measured');
    assert.ok(b.endSample > b.startSample);
  }
});

test('bindings не пересекаются и идут по возрастанию', () => {
  const take = makeTake({ chunkKey: 'test0000', spokenText: TXT, seed: SEED });
  for (let i = 1; i < take.bindings.length; i++) {
    assert.ok(take.bindings[i].startSample >= take.bindings[i - 1].endSample);
  }
});
