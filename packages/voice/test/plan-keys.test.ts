// `V-03` — ключи: инъективность канонической формы, состав `chunkKey`/`voiceKey`, три свойства
// `roleDigest` (ADR-0010 §3a, ADR-0006 §2).

import { CacheError } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import {
  CHUNK_KEY_LENGTH,
  TTS_PIPELINE_VERSION,
  VoiceError,
  canonicalFields,
  chunkKey,
  int,
  json,
  roleDigest,
  text,
  voiceKey,
  type ChunkAddress,
  type VoiceKeyFields,
  type VoiceRolePreset,
} from '../src/index.js';

import { fixtureRoles, fixtureVoice } from './fixture.js';

const ADDRESS: ChunkAddress = {
  chapterId: 'main',
  sceneId: 'intro',
  paragraphOrdinalInScene: 1,
  splitIndex: 0,
};

const voice = fixtureVoice();

const FIELDS: VoiceKeyFields = {
  spokenChunkText: 'The morning began the same way.',
  providerId: voice.providerId,
  modelId: voice.modelId,
  voiceId: voice.voiceId,
  seed: voice.seed,
  providerOpts: {},
  roleDigest: roleDigest([]),
  ttsPipelineVersion: TTS_PIPELINE_VERSION,
};

const asText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// ── 1. Инъективность канонической формы ────────────────────────────────────────────────────

describe('ADR-0010 §3a — каноническая форма входа ключей инъективна', () => {
  it('пара, дающая ОДНУ наивную склейку, даёт РАЗНЫЕ канонические формы', () => {
    // Ровно та коллизия, ради которой рамка и заведена: `"a"+"bc" === "ab"+"c"`.
    const naive = (parts: readonly string[]): string => parts.join('');
    expect(naive(['a', 'bc'])).toBe(naive(['ab', 'c']));

    const left = canonicalFields([text('a'), text('bc')]);
    const right = canonicalFields([text('ab'), text('c')]);
    expect(asText(left)).toBe('s1:as2:bc');
    expect(asText(right)).toBe('s2:abs1:c');
    expect(asText(left)).not.toBe(asText(right));
  });

  it('та же коллизия на НАСТОЯЩЕМ адресе: `chapterId`/`sceneId` пишет автор', () => {
    const spoken = 'One sentence.';
    const a = chunkKey({ ...ADDRESS, chapterId: 'main', sceneId: 'intro' }, spoken);
    const b = chunkKey({ ...ADDRESS, chapterId: 'mainin', sceneId: 'tro' }, spoken);
    expect(a).not.toBe(b);
  });

  it('тег типа отделяет строку `"7"` от числа `7`', () => {
    expect(asText(canonicalFields([text('7')]))).toBe('s1:7');
    expect(asText(canonicalFields([int(7)]))).toBe('i1:7');
  });

  it('длина считается в БАЙТАХ UTF-8, а не в code points и не в UTF-16 units', () => {
    // `🚢` — четыре байта, два UTF-16 units, один code point. Рамка обязана сказать «4».
    expect(asText(canonicalFields([text('\u{1F6A2}')]))).toBe('s4:\u{1F6A2}');
  });

  it('перестановка полей меняет форму: инъективность объявлена для КОРТЕЖА', () => {
    expect(asText(canonicalFields([text('a'), int(1)]))).not.toBe(
      asText(canonicalFields([int(1), text('a')])),
    );
  });

  // ПРАВКА `M-05`: класс ошибки сменился с `VoiceError` на `CacheError`, потому что сама
  // каноническая форма переехала в `@vpe/media` (решение владельца 2026-08-25, вопрос 2:
  // ключей три, считаются они в двух пакетах, форма у всех обязана быть ОДНОЙ). Проверяемое
  // свойство при этом не ослаблено ни на букву — оно то же самое и в том же месте: разные
  // значения не имеют права дать один ключ. Правило в имени ошибки стало точнее: было
  // `ADR-0010 §3a` (ключи стадии `voice`), стало `ADR-0006 §2` (формулы всех трёх ключей).
  it('целое вне `Number.isSafeInteger` и `-0` отвергаются, а не приводятся молча', () => {
    expect(() => canonicalFields([int(2 ** 53)])).toThrow(CacheError);
    expect(() => canonicalFields([int(-0)])).toThrow(/-0/);
    expect(() => canonicalFields([int(1.5)])).toThrow(CacheError);
    // Правило названо ЗНАЧЕНИЕМ, а не текстом сообщения: по нему ищется охранник.
    expect(() => canonicalFields([int(1.5)])).toThrow(/ADR-0006 §2/);
  });

  it('объектное поле канонизируется одной функцией: порядок ключей не влияет', () => {
    expect(asText(canonicalFields([json({ b: 2, a: 1 })]))).toBe(
      asText(canonicalFields([json({ a: 1, b: 2 })])),
    );
  });
});

// ── 2. Состав `chunkKey` ───────────────────────────────────────────────────────────────────

describe('ADR-0010 §3a — `chunkKey` есть идентичность МЕСТА', () => {
  it('длина ровно 16 символов алфавита base32 RFC 4648 (строчные, без 0/1/8/9)', () => {
    const key = chunkKey(ADDRESS, 'Text.');
    expect(key).toHaveLength(CHUNK_KEY_LENGTH);
    expect(key).toMatch(/^[a-z2-7]{16}$/);
  });

  it('каждое поле адреса меняет ключ: ни одно не декоративно', () => {
    const base = chunkKey(ADDRESS, 'Text.');
    expect(chunkKey({ ...ADDRESS, chapterId: 'other' }, 'Text.')).not.toBe(base);
    expect(chunkKey({ ...ADDRESS, sceneId: 'other' }, 'Text.')).not.toBe(base);
    expect(chunkKey({ ...ADDRESS, paragraphOrdinalInScene: 2 }, 'Text.')).not.toBe(base);
    expect(chunkKey({ ...ADDRESS, splitIndex: 1 }, 'Text.')).not.toBe(base);
    expect(chunkKey(ADDRESS, 'Text!')).not.toBe(base);
  });

  it('два одинаковых абзаца в разных местах РАЗЛИЧИМЫ (иначе схлопнулись бы в один файл)', () => {
    const same = 'The archive holds the answer.';
    expect(chunkKey({ ...ADDRESS, sceneId: 'intro' }, same)).not.toBe(
      chunkKey({ ...ADDRESS, sceneId: 'turn' }, same),
    );
  });

  it('детерминирован: тот же вход — тот же ключ', () => {
    expect(chunkKey(ADDRESS, 'Text.')).toBe(chunkKey({ ...ADDRESS }, 'Text.'));
  });
});

// ── 3. Состав `voiceKey` ───────────────────────────────────────────────────────────────────

describe('ADR-0006 §2 — `voiceKey` есть идентичность СОДЕРЖИМОГО', () => {
  const key = (patch: Partial<VoiceKeyFields>): string => voiceKey({ ...FIELDS, ...patch });

  it('все восемь слагаемых входят в ключ поимённо', () => {
    const base = key({});
    expect(key({ spokenChunkText: 'Other.' })).not.toBe(base);
    expect(key({ providerId: 'tts:other@1' })).not.toBe(base);
    expect(key({ modelId: 'other' })).not.toBe(base);
    expect(key({ voiceId: 'OTHER_VOICE_ID' })).not.toBe(base);
    expect(key({ seed: FIELDS.seed + 1 })).not.toBe(base);
    expect(key({ providerOpts: { stability: 0.5 } })).not.toBe(base);
    expect(key({ roleDigest: roleDigest(fixtureRoles()) })).not.toBe(base);
    expect(key({ ttsPipelineVersion: 'tts-pipeline@2' })).not.toBe(base);
  });

  it('blake3 в hex: 64 строчных символа', () => {
    expect(key({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('два одинаковых текста в разных местах дают ОДИН `voiceKey` (**V4**)', () => {
    // Место в `voiceKey` не входит вовсе — на этом стоит «один оплаченный дубль».
    expect(key({})).toBe(key({}));
  });
});

// ── 4. `roleDigest`: три свойства ADR-0006 §2 ──────────────────────────────────────────────

describe('ADR-0006 §2 / **V15** — три свойства `roleDigest`', () => {
  const narrator = fixtureRoles()[0] as VoiceRolePreset;
  const quote: VoiceRolePreset = {
    roleId: 'quote',
    voice_id: 'VPE_MOCK_VOICE_ID',
    voice_settings: { stability: 0.3 },
  };

  it('1. правка ПРИМЕНИМОЙ роли меняет дайджест и, значит, `voiceKey`', () => {
    const before = roleDigest([narrator]);
    const after = roleDigest([{ ...narrator, voice_settings: { stability: 0.7 } }]);
    expect(after).not.toBe(before);
    expect(voiceKey({ ...FIELDS, roleDigest: after })).not.toBe(
      voiceKey({ ...FIELDS, roleDigest: before }),
    );
  });

  it('1a. правка ЛЮБОГО поля внутри `voice_settings` меняет дайджест — движок не знает семантики', () => {
    const a = roleDigest([{ ...narrator, voice_settings: { unknownKnob: 'left' } }]);
    const b = roleDigest([{ ...narrator, voice_settings: { unknownKnob: 'right' } }]);
    expect(a).not.toBe(b);
  });

  it('1b. правка `modelId` роли меняет дайджест; отсутствие поля ≠ поле со значением', () => {
    const inherited = roleDigest([narrator]);
    const explicit = roleDigest([{ ...narrator, modelId: 'mock-1' }]);
    expect(explicit).not.toBe(inherited);
  });

  it('2. правка роли, к чанку НЕ применимой, дайджест не трогает', () => {
    // Применима одна `narrator`; `quote` правится как угодно — её в множестве нет.
    const before = roleDigest([narrator]);
    const afterForeignEdit = roleDigest([narrator]);
    expect(afterForeignEdit).toBe(before);
    // И контроль: если бы дайджест считался от ВСЕГО файла, эти два были бы равны.
    expect(roleDigest([narrator, quote])).not.toBe(before);
  });

  it('2a. дайджест не зависит от ПОРЯДКА записей — только от множества', () => {
    expect(roleDigest([narrator, quote])).toBe(roleDigest([quote, narrator]));
  });

  it('2b. две записи с одним `roleId` отвергаются: в множестве они неразличимы', () => {
    expect(() => roleDigest([narrator, { ...narrator, voice_settings: { a: 1 } }])).toThrow(
      VoiceError,
    );
  });

  it('пустое множество — законный вход с собственным дайджестом', () => {
    expect(roleDigest([])).toMatch(/^[0-9a-f]{64}$/);
    expect(roleDigest([])).not.toBe(roleDigest([narrator]));
  });
});
