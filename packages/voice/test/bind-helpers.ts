// Общее для тестов стадии `bind` (`V-05`). Не тест — вспомогательный модуль (образец
// `packages/core-model/test/anchors-helpers.ts` и `packages/voice/test/fixture.ts`).
//
// ПОЧЕМУ ТЕСТЫ ИДУТ ЧЕРЕЗ НАСТОЯЩИЙ LEDGER, А НЕ ЧЕРЕЗ РУЧНЫЕ ССЫЛКИ НА ТОКЕНЫ. Ссылка,
// собранная в тесте руками, несёт выдуманный идентификатор якоря — ровно то, что `V-05` убрала
// из `makeTake`. С настоящим `syncLedger` тест проверяет заодно и связку: якоря приходят из
// того же места, откуда придут на сборке, а их порядок — из того же обхода.
//
// ИСТОЧНИК СЛУЧАЙНОСТИ ПОДСТАВЛЕН И ОБЪЯВЛЕН МОКОМ (тот же приём, что в `C-04`): минт — это
// CSPRNG, и без подстановки два прогона одного теста давали бы разные идентификаторы, то есть
// «привязки те же» проверялось бы вместе со случайностью. Значения при этом различны внутри
// прогона — иначе инвариант **A3** (уникальность живых) справедливо покраснел бы.

import {
  EMPTY_LEDGER,
  parseSource,
  sourceText,
  syncLedger,
  type AnchorBinding,
  type RandomBytes,
  type SourceDocument,
  type SourceText,
} from '@vpe/core-model';

import {
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  speechPlan,
  synthesize,
  tokensOfPlan,
  type MockProfile,
  type ProviderAlignment,
  type SourceTokenRef,
  type SpeechPlan,
} from '../src/index.js';

import { fixtureVoice } from './fixture.js';

/** Предел раскроя. Абзацы тестов короче него; деления в этих тестах нет ни одного. */
export const MAX_CHUNK_CHARS = 600;

export const FILE = 'source/01-bind.md';

/** Seed синтеза. Константа: падение обязано воспроизводиться, а не «повторяться иногда». */
export const SEED = 20260825;

/**
 * Детерминированный источник байтов минта. Счётчик, а не генератор: от него требуется только
 * различность значений внутри прогона и повторяемость между прогонами.
 */
export function countingRandom(start = 1): RandomBytes {
  let n = start;
  return (byteLength: number): Uint8Array => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i += 1) {
      out[i] = (n + i * 7) & 0xff;
    }
    n = (n + 13) & 0xff;
    return out;
  };
}

/** Исходник диалекта из абзацев: одна глава, одна сцена, ни одного маркера. */
export function sourceOf(paragraphs: readonly string[]): string {
  return `schema: source-dialect/1\n\n# chapter: main\n\n## scene: intro\n\n${paragraphs.join('\n\n')}\n`;
}

export interface BindFixture {
  readonly raw: string;
  readonly source: SourceText;
  readonly document: SourceDocument;
  readonly plan: SpeechPlan;
  readonly anchors: readonly AnchorBinding[];
  readonly tokens: ReadonlyMap<string, readonly SourceTokenRef[]>;
}

/**
 * Весь путь до стадии `bind`: разбор → ledger → план → раздача токенов по чанкам.
 *
 * `maxChunkChars` — ПАРАМЕТР, а не константа, и это найдено протоколом нарушений (№19):
 * при пределе 600 каждый абзац тестов даёт РОВНО ОДНУ часть, у неё `spokenStart = 0`, и
 * пересчёт смещения на начало части (`token.spokenStart - from`) оказывается тождеством —
 * то есть не проверяется ни одной пробой. Малый предел заставляет абзац делиться, и вторая
 * часть начинается не с нуля.
 */
export function bindFixture(
  paragraphs: readonly string[],
  maxChunkChars: number = MAX_CHUNK_CHARS,
): BindFixture {
  const raw = sourceOf(paragraphs);
  const document = parseSource(raw, { file: FILE, sampleRate: MOCK_SAMPLE_RATE });
  const sync = syncLedger(document, EMPTY_LEDGER, { random: countingRandom() });
  const plan = speechPlan({
    document,
    source: sourceText(FILE, raw),
    maxChunkChars,
    voice: fixtureVoice(),
  });
  return {
    raw,
    source: sourceText(FILE, raw),
    document,
    plan,
    anchors: sync.bindings,
    tokens: tokensOfPlan({ plan, document, maxChunkChars, anchors: sync.bindings }),
  };
}

/** Токены единственного абзаца — самый частый вход этих тестов. */
export function refsOf(paragraph: string): readonly SourceTokenRef[] {
  const fixture = bindFixture([paragraph]);
  const chunk = fixture.plan.chunks[0];
  if (chunk === undefined) throw new Error(`абзац \`${paragraph}\` не дал ни одного чанка плана`);
  return fixture.tokens.get(chunk.chunkKey) ?? [];
}

/** Ответ `tts:mock@1` на тот же текст. Истина по построению: alignment и есть расписание. */
export function alignmentOf(text: string, profile: MockProfile = MOCK_PROFILE): ProviderAlignment {
  return synthesize({ text, seed: SEED, profile }).alignment;
}

/**
 * Ответ БЕЗ одного слова — дубль, из которого «TTS проглотил слово».
 *
 * Вырезаются code point'ы самого слова и ОДИН пробел перед ним, чтобы в тексте ответа не
 * осталось двойного пробела: имитируется пропуск при синтезе, а не порча массива.
 * `charIdentity` при этом нарушается — так и должно быть, ровно этим такой дубль и опознаётся.
 */
export function withoutWord(alignment: ProviderAlignment, word: string): ProviderAlignment {
  const chars = [...alignment.characters];
  const points = [...word];
  const at = indexOfWord(chars, points);
  const from = at > 0 && chars[at - 1] === ' ' ? at - 1 : at;
  const to = at + points.length;
  const keep = <T>(values: readonly T[]): readonly T[] => [...values.slice(0, from), ...values.slice(to)];
  return {
    characters: keep(chars),
    character_start_times_seconds: keep(alignment.character_start_times_seconds),
    character_end_times_seconds: keep(alignment.character_end_times_seconds),
  };
}

/**
 * Ответ, в котором у произносимого слова НУЛЕВАЯ длительность (`end == start`).
 *
 * Такого дубля `tts:mock@1` не порождает: у него каждая буква длится `msPerChar`. Но
 * `FACT` (SP-2 U6) провайдер выдаёт нулевые интервалы — непроизносимым code point'ам, — и
 * ничто не мешает испорченному ответу выдать его слову. Запрет `[t, t]` (ADR-0010 §1) без
 * такой пробы не охранялся бы ничем: правило, в граничную точку которого не попадает ни одна
 * проба, зелено при любой реализации (находка протокола `V-04`).
 */
export function withZeroLengthWord(alignment: ProviderAlignment, word: string): ProviderAlignment {
  const chars = [...alignment.characters];
  const at = indexOfWord(chars, [...word]);
  const starts = [...alignment.character_start_times_seconds];
  const ends = [...alignment.character_end_times_seconds];
  for (let i = at; i < at + [...word].length; i += 1) {
    ends[i] = starts[at] ?? 0;
    starts[i] = starts[at] ?? 0;
  }
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function indexOfWord(chars: readonly string[], points: readonly string[]): number {
  for (let i = 0; i + points.length <= chars.length; i += 1) {
    if (points.every((c, k) => chars[i + k] === c)) return i;
  }
  throw new Error(`слова \`${points.join('')}\` нет в ответе провайдера — оснастка теста сломана`);
}
