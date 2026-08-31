// `tts:mock@1` — детерминированный TTS-провайдер по интерфейсу ADR-0010 (`V-01`).
//
// ПЕРЕНОС SP-2, блок 8 (`docs/spikes/sp2/mock.mjs`, 222 строки). Перенос, а не переписывание:
// поведение сохранено, изменения — только те, которых потребовали типы и линты репозитория,
// и каждое из них перечислено строкой в отчёте `docs/impl/V-01/report.md`.
//
// Ни сети, ни ключа, ни кредитов. Истина известна ПО ПОСТРОЕНИЮ: alignment не «оценивается»,
// а является тем самым расписанием, по которому синтезирован PCM. Отсюда два следствия,
// которые нельзя потерять при типизации:
//   (1) интерфейс ADR-0010 действительно абстрактный, а не «ElevenLabs с другими именами
//       полей» (ADR-0010 §7) — иначе mock не собрался бы поверх него вовсе;
//   (2) материал с НУЛЕВОЙ ошибкой выравнивания для калибровки алигнера (U14, задача `A-03`) —
//       сама калибровка здесь не выполняется. Проверяется это свойство тестом «другой seed
//       меняет звук, но НЕ меняет alignment».
//
// ЧЕГО ЗДЕСЬ НЕТ. Сети — ни импортом, ни глобалью (**V9**, охранник
// `tests/lints/v9-no-network-in-voice.test.ts`, реестр разрешённых файлов пуст).
// `Math.random`, часов и `Intl` — **V8**, вместо них свой `mulberry32` (20 строк, ноль новых
// зависимостей). `node:crypto` — расширение D4: минт якоря остаётся единственным законным
// недетерминизмом модели, и сид mock'а считается БЕЗ crypto, как в спайке.
//
// ПРИЁМКИ ЗДЕСЬ БОЛЬШЕ НЕТ (`V-02`). Метрики, вердикт, диагностика отказа и лестница ретраев
// переехали в `packages/voice/src/acceptance/`: приёмка судит ОТВЕТ провайдера и потому не
// может принадлежать провайдеру. `takeHealth` ниже — тонкий делегат, оставленный ради
// потребителей `V-01`; mock стал ПОТРЕБИТЕЛЕМ приёмки, а не её хозяином.
//
// ПРАВИЛА ИНТЕРВАЛА ТОКЕНА ЗДЕСЬ ТОЖЕ БОЛЬШЕ НЕТ (`V-05`). `tokenIntervals` переехало в
// `packages/voice/src/bind/interval.ts` по тому же доводу: правило ADR-0010 §6 принадлежит
// стадии `bind`, а не провайдеру, и его адрес назван отчётом `V-04` §6 п. 6. Вместе с ним
// ушли и выдуманные идентификаторы якорей: `makeTake` больше не собирает их из порядкового
// номера токена — они приходят входом либо привязок нет вовсе (см. `makeTake`).

import { assertSafeInteger, msToSamples, type Samples } from '@vpe/core-model';
import { PCM_SAMPLE_MAX, PCM_SAMPLE_MIN, bytesFromPcm, pcmS16, type PcmS16 } from '@vpe/media';

import { VoiceError } from '../errors.js';

import { assessTake, type TakeAcceptance } from '../acceptance/health.js';
import { PROVIDER_TIMESTAMPS, bindProviderTimestamps } from '../bind/provider-timestamps.js';
import type { SourceTokenRef } from '../bind/types.js';
import { NORMALIZER_VERSION } from '../plan/keys.js';

import { sampleRateOfPcmFormat } from './capabilities.js';
import type {
  PcmFormat,
  ProviderAlignment,
  Take,
  TakeHealth,
  TokenBinding,
  TtsCapabilities,
  TtsProvider,
  TtsRequest,
  TtsResponse,
} from './types.js';

// --- capabilities (ADR-0010 §8: ветвление по возможностям, не по имени) ------
// Стоят ПЕРВЫМИ, потому что из них выводится частота: `MOCK_SAMPLE_RATE` — не отдельная
// константа рядом, а следствие объявленного формата (решение владельца, `V-01` вопрос 1).

/** Единственный формат PCM, который отдаёт mock. `FACT` (r1 §0.6): доступен без Pro. */
const MOCK_PCM_FORMAT: PcmFormat = 'pcm_24000';

export const capabilities: TtsCapabilities = Object.freeze({
  providerId: 'tts:mock@1',
  timestampUnit: 'character',
  /** `normalized` не существует: нормализатора нет по построению. */
  timestampDomains: Object.freeze(['original' as const]),
  /** Он всегда выключен — у mock нет второго слоя, который можно было бы включить. */
  canDisableNormalization: true,
  pcmFormats: Object.freeze([MOCK_PCM_FORMAT]),
  /** Сильнее, чем `best-effort` у ElevenLabs: `FACT` (r1 §2.3) там детерминизм не гарантирован. */
  seedSupport: 'exact',
  requestStitching: 'none',
  requiresNetwork: false,
});

/**
 * Частота дорожки mock'а — **свойство провайдера**, а не вход.
 *
 * Выведена из `capabilities.pcmFormats`, а не записана вторым числом: потребитель обязан
 * сверять `projectSampleRate` со списком форматов (`pcmFormatFor`), и если бы частота жила
 * отдельной константой, две записи одного факта разъехались бы при первой правке.
 */
export const MOCK_SAMPLE_RATE = sampleRateOfPcmFormat(MOCK_PCM_FORMAT);

// --- параметры синтеза (это и есть «истина по построению») -------------------

/** Профиль синтеза. Все длительности — ЦЕЛЫЕ миллисекунды (см. `schedule`). */
export interface MockProfile {
  readonly providerId: string;
  /** Фиксированные мс на произносимый символ. */
  readonly msPerChar: number;
  /** Пробел — не часть слова (ADR-0010 §6), но время занимает. */
  readonly msPerSpace: number;
  readonly punctuationPauseMs: Readonly<Record<string, number>>;
  /** Собственная длительность самого знака. */
  readonly punctuationSelfMs: number;
  /**
   * КУДА кладётся пауза. Значение по умолчанию — гипотеза спайка; какое значение
   * соответствует реальному провайдеру, ответил блок 3 SP-2: `FACT` — вся пауза лежит на
   * знаке и пробелах, в переменной пропорции, и в слова не попадает (ADR-0010 §6).
   */
  readonly pauseGoesTo: 'punct' | 'space';
  /** Mock не имитирует лид-ин: T7 обязан работать и при нуле. */
  readonly leadInMs: number;
  readonly tailMs: number;
  /** Несущая «голоса». */
  readonly toneHz: number;
  readonly toneAmplitude: number;
}

export const MOCK_PROFILE: MockProfile = Object.freeze({
  providerId: 'tts:mock@1',
  msPerChar: 55,
  msPerSpace: 40,
  punctuationPauseMs: Object.freeze({
    // Ключи-ловушки записаны `\u`-эскейпами, как в спайке: … — – неотличимы глазами от
    // соседей в diff'е, а от их байтов зависит вся раскладка пауз.
    '.': 320, '!': 320, '?': 320, ['\u2026']: 400,
    ',': 140, ';': 200, ':': 200, ['\u2014']: 220, ['\u2013']: 220,
  }),
  punctuationSelfMs: 20,
  pauseGoesTo: 'punct',
  leadInMs: 0,
  tailMs: 0,
  toneHz: 140,
  toneAmplitude: 0.22,
});

// --- seeded random (V8: Math.random запрещён) --------------------------------

/**
 * mulberry32 — 20 строк, своя, без единой новой зависимости (`V-01`: новые зависимости
 * запрещены). Возвращает генератор, а не число: состояние живёт в замыкании, и два вызова
 * `synthPcm` с одним seed идут по одной и той же последовательности.
 */
function mulberry32(a: number): () => number {
  let state = a;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a от текста, смешанный с seed'ом дубля.
 *
 * **Индексация здесь по UTF-16 units — и это НЕ дефект F13.** Правило «единица индексации —
 * code point» (ADR-0010 §10) относится к span-map и к alignment, то есть к величинам, которые
 * сверяются с ответом провайдера. Здесь считается вход генератора случайных чисел: от него
 * требуется только детерминированность, а какой обход строки её даёт — безразлично. Тождество
 * `charIdentity` и длина `characters` от этой функции не зависят вовсе.
 *
 * Общей формы с `seedOf` (`core-model`, ADR-0007 §1) НЕТ намеренно (решение владельца,
 * `V-01` вопрос 5): `seedOf` — иерархия seed'ов УЗЛОВ РЕНДЕРА от `seedRoot`, а здесь вход
 * TTS-провайдера из `project.yaml → voice.seed`. Долг с адресом `V-06`.
 */
function seedFrom(str: string, seed: number): number {
  let h = (seed >>> 0) ^ 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Последний символ — NBSP (`\u00A0`), эскейпом: в исходнике он неотличим от пробела. */
const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\u00A0';

const isPunct = (c: string): boolean =>
  Object.prototype.hasOwnProperty.call(MOCK_PROFILE.punctuationPauseMs, c);

/** Пауза знака по профилю. Знак, которого в таблице нет, паузы не даёт. */
const pauseOf = (profile: MockProfile, c: string): number => profile.punctuationPauseMs[c] ?? 0;

// --- расписание --------------------------------------------------------------

/**
 * Расписание по символам.
 *
 * ЕДИНИЦА МАССИВА — **CODE POINT**, а не UTF-16 unit: ADR-0010 §10 F13 требует монотонности
 * span-map именно в code point'ах, и `FACT` (SP-2, findings U4.2) длина `alignment.characters`
 * совпала с числом code points на 28/28 строк каждого из двух голосов.
 *
 * ЕДИНИЦА ВРЕМЕНИ — **целые миллисекунды** (решение владельца, `V-01` вопрос 7, вариант «а»).
 * В спайке та же величина сразу делилась на 1000 и хранилась секундами; здесь она остаётся
 * целой, а в сэмплы переводится единственной разрешённой функцией `msToSamples` (ADR-0003 T1).
 * Числа при этом те же: `floor(ms · 24000 / 1000) === ms · 24` для любого целого `ms`, и это
 * покрыто отдельным тестом на границах. Секунды для формы ответа получаются обратно из
 * сэмплов — тот же double, потому что деление IEEE корректно округлено.
 */
export interface MockSchedule {
  readonly chars: readonly string[];
  readonly startMs: readonly number[];
  readonly endMs: readonly number[];
  readonly totalMs: number;
  readonly voicedMs: number;
}

export function schedule(spokenText: string, profile: MockProfile = MOCK_PROFILE): MockSchedule {
  const chars = [...spokenText];
  const startMs = new Array<number>(chars.length);
  const endMs = new Array<number>(chars.length);
  let tMs = profile.leadInMs;

  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i] ?? '';
    let dur: number;
    if (isPunct(c)) {
      dur = profile.punctuationSelfMs + (profile.pauseGoesTo === 'punct' ? pauseOf(profile, c) : 0);
    } else if (isSpace(c)) {
      const prev = i > 0 ? (chars[i - 1] ?? '') : null;
      const carried =
        profile.pauseGoesTo === 'space' && prev !== null && isPunct(prev) ? pauseOf(profile, prev) : 0;
      dur = profile.msPerSpace + carried;
    } else {
      dur = profile.msPerChar;
    }
    startMs[i] = tMs;
    endMs[i] = tMs + dur;
    tMs += dur;
  }
  const totalMs = tMs + profile.tailMs;
  return { chars, startMs, endMs, totalMs, voicedMs: tMs - profile.leadInMs };
}

// --- синтез PCM --------------------------------------------------------------

/**
 * Длина краевого микрофейда символа, в сэмплах. Значение спайка (48 ≈ 2 мс при 24 кГц);
 * с `audioProfile.crossfadeSamples` (72, `M-03`) НЕ связано и связано быть не должно: это
 * форма «голоса» mock'а, а не параметр тракта.
 */
const CHAR_RAMP_SAMPLES = 48;

export interface MockPcm {
  readonly pcm: PcmS16;
  readonly numSamples: Samples;
  readonly schedule: MockSchedule;
}

/**
 * PCM s16le моно 24 кГц: тон на произносимых символах, тишина на пробелах и паузах.
 *
 * Отдаёт `PcmS16` — внутренний тип тракта (`M-03`), а не `Buffer`: выход mock'а обязан
 * проходить в `mixSaturating`/`encodeWav` без переупаковки, и это проверяется тестом.
 */
export function synthPcm(spokenText: string, seed: number, profile: MockProfile = MOCK_PROFILE): MockPcm {
  assertSafeInteger(seed, 'seed');
  const sch = schedule(spokenText, profile);
  const numSamples = msToSamples(sch.totalMs, MOCK_SAMPLE_RATE);
  const samples = new Int16Array(numSamples); // ноль = тишина
  const rnd = mulberry32(seedFrom(spokenText, seed));
  // Одна детерминированная «высота» на весь дубль + лёгкая девиация на символ.
  const base = profile.toneHz * (0.94 + 0.12 * rnd());

  for (let i = 0; i < sch.chars.length; i += 1) {
    const c = sch.chars[i] ?? '';
    if (isSpace(c) || isPunct(c)) continue; // тишина в паузах — это и есть «пауза»
    const s0 = msToSamples(sch.startMs[i] ?? 0, MOCK_SAMPLE_RATE);
    const s1 = msToSamples(sch.endMs[i] ?? 0, MOCK_SAMPLE_RATE);
    const f = base * (0.97 + 0.06 * rnd());
    // `n` объявлен `number`, а не выведен из `s0`: `Samples` — бренд, и `n += 1` на
    // брендированной переменной компилятор справедливо не пропускает. Счётчик цикла — это
    // индекс, а не величина времени.
    for (let n: number = s0; n < s1 && n < numSamples; n += 1) {
      // Равномощный микрофейд по краям символа, чтобы не было щелчков.
      const into = n - s0;
      const left = s1 - n;
      const ramp = Math.min(1, into / CHAR_RAMP_SAMPLES, left / CHAR_RAMP_SAMPLES);
      const v = Math.sin((2 * Math.PI * f * n) / MOCK_SAMPLE_RATE) * profile.toneAmplitude * ramp;
      samples[n] = Math.max(PCM_SAMPLE_MIN, Math.min(PCM_SAMPLE_MAX, Math.round(v * PCM_SAMPLE_MAX)));
    }
  }
  return { pcm: pcmS16(MOCK_SAMPLE_RATE, samples), numSamples, schedule: sch };
}

// --- синтез: ответ той же формы, что у ElevenLabs `/with-timestamps` ---------

export interface MockSynthesizeOptions {
  readonly text: string;
  readonly seed?: number;
  readonly profile?: MockProfile;
}

/** Ответ mock'а. `alignment` у него не бывает `null` — истина известна по построению. */
export interface MockSynthesis extends TtsResponse {
  readonly alignment: ProviderAlignment;
  readonly normalized_alignment: ProviderAlignment;
  readonly __mock: {
    readonly numSamples: Samples;
    readonly sampleRate: number;
    readonly seed: number;
    readonly providerId: string;
    readonly pcm: PcmS16;
  };
}

/**
 * Синтез. Чистая функция — она же арифметическое ядро провайдера.
 *
 * Секунды выводятся ИЗ СЭМПЛОВ (`sample / sampleRate`), а не из миллисекунд (`ms / 1000`):
 * вторая форма запрещена линтом T1, а результат у них побитово один и тот же — обе дают
 * ближайший double к `ms/1000`, потому что деление IEEE-754 корректно округлено, а `ms · 24`
 * и `24000` представимы точно. Побочная польза: таймкод по построению согласован с той
 * дорожкой, которая реально синтезирована, а не с намерением.
 */
export function synthesize(options: MockSynthesizeOptions): MockSynthesis {
  const { text, seed = 0, profile = MOCK_PROFILE } = options;
  const { pcm, numSamples, schedule: sch } = synthPcm(text, seed, profile);

  const starts = sch.startMs.map((ms) => msToSamples(ms, MOCK_SAMPLE_RATE) / MOCK_SAMPLE_RATE);
  const ends = sch.endMs.map((ms) => msToSamples(ms, MOCK_SAMPLE_RATE) / MOCK_SAMPLE_RATE);
  const alignment: ProviderAlignment = {
    characters: sch.chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };

  return {
    audio_base64: Buffer.from(bytesFromPcm(pcm)).toString('base64'),
    alignment,
    // Нормализатора нет по построению ⇒ normalized строго равен original.
    normalized_alignment: alignment,
    __mock: { numSamples, sampleRate: MOCK_SAMPLE_RATE, seed, providerId: profile.providerId, pcm },
  };
}

// --- приёмка дубля: делегат (владение — `acceptance/`, `V-02`) ---------------

/**
 * Метрики приёмки дубля — ВЫЗОВ приёмки, а не её вторая реализация.
 *
 * Функция оставлена в публичной поверхности mock'а потому, что её звали потребители `V-01`, и
 * потому, что провайдеру законно уметь оценить собственный ответ. Считает при этом
 * `assessTake` (`acceptance/health.ts`), и второй формулы метрик в репозитории нет.
 *
 * `acceptance` ОБЯЗАТЕЛЕН и значения по умолчанию не имеет: пороги — данные профиля
 * (`audio-profile/1`), а умолчание в коде было бы их второй записью, разъезжающейся с
 * `fixtures/minimal/profiles/audio.yaml` при первой правке. `sampleRate` умолчание имеет —
 * это СВОЙСТВО провайдера, выведенное из его же `capabilities.pcmFormats`, а не порог.
 */
export function takeHealth(
  spokenText: string,
  alignment: ProviderAlignment | null,
  numSamples: number,
  acceptance: TakeAcceptance,
  sampleRate: number = MOCK_SAMPLE_RATE,
): TakeHealth {
  return assessTake({ spokenText, alignment, numSamples, sampleRate, acceptance });
}

// --- правило интервала токена (ADR-0010 §6): ПЕРЕЕХАЛО В `bind/interval.ts` (`V-05`) -------
//
// Здесь его больше нет ни строкой. Правило принадлежит стадии `bind`, а не провайдеру: его
// адрес назван отчётом `V-04` §6 п. 6 дословно («его адрес `V-05`»), и потребителей у него
// теперь двое — биндер и этот файл. Mock остаётся ПОТРЕБИТЕЛЕМ правила, ровно как он уже
// потребитель приёмки (`V-02`). Единственное изменение поведения при переезде — классы
// символов перестали браться из таблицы пауз mock'а и стали свойствами Unicode; на выходе
// `tts:mock@1` это ноль отличий (разбор — шапка `bind/interval.ts`).

// --- дубль (ADR-0010 §2) -----------------------------------------------------

export interface MakeTakeFields {
  readonly chunkKey: string;
  readonly spokenText: string;
  readonly seed: number;
  /** Пороги приёмки из `audio-profile/1`. Умолчания нет: см. `takeHealth` выше. */
  readonly acceptance: TakeAcceptance;
  /** `null` до `V-03`: CAS в `V-01` не пишется (решение владельца, вопрос 2). */
  readonly sha256?: string | null;
  /**
   * Токены исходника с якорями (`V-05`). Их НЕТ у mock'а и быть не может: якоря живут в
   * ledger'е (`C-04`), а провайдер исходника не видит вовсе. Приходят входом — тогда дубль
   * получает настоящие привязки; не приходят — привязок нет, и это честное значение
   * (решение владельца, `V-05` вопрос 5).
   */
  readonly tokens?: readonly SourceTokenRef[];
}

/**
 * Дубль по раскладке ADR-0010 §2 — **значение в памяти**, без записи в `.store`.
 *
 * `voiceCategory` заполняется `'none'`: у mock'а нет голоса провайдера вовсе, а поле
 * обязательно (ADR-0010 §2, `V-05`) — пустое место здесь означало бы, что `V-06` может о нём
 * забыть. `billedUnits: 0` — mock ничего никуда не отправляет; у живого провайдера это будет
 * число отправленных code points `spokenChunkText`.
 *
 * ПРИВЯЗКИ БОЛЬШЕ НЕ ВЫДУМЫВАЮТСЯ (`V-05`, решение владельца, вопрос 5). До этой задачи
 * `makeTake` собирал идентификатор якоря строкой из порядкового номера токена. Это подделка
 * адреса в пространстве, которое минтится РОВНО в одном файле репозитория
 * (`core-model/src/anchors/mint.ts`, 128 бит CSPRNG, ADR-0004 §4), и в коммитимом артефакте
 * она того же класса, что нулевой `leadInSamples` до `V-04` (долг №85): значение выразимо,
 * проверить его нечем, а выглядит оно как измеренное. Теперь якоря приходят ВХОДОМ либо
 * привязок нет вовсе.
 */
export function makeTake(fields: MakeTakeFields): Take {
  const { chunkKey, spokenText, seed, acceptance, sha256, tokens } = fields;
  const r = synthesize({ text: spokenText, seed });
  const numSamples = r.__mock.numSamples;
  const health = takeHealth(spokenText, r.alignment, numSamples, acceptance);

  // Привязки порождает СТАДИЯ `bind`, а не провайдер: mock здесь её потребитель, ровно как он
  // потребитель приёмки. Без токенов исходника привязывать нечего — и список пуст.
  const bound =
    tokens === undefined || tokens.length === 0
      ? { bindings: [] as readonly TokenBinding[], bind: null }
      : {
          bindings: bindProviderTimestamps({
            sampleRate: MOCK_SAMPLE_RATE,
            spokenText,
            tokens,
            providerAlignment: r.alignment,
          }),
          bind: {
            binderId: PROVIDER_TIMESTAMPS,
            tokens,
            providerAlignment: r.alignment,
          },
        };

  return {
    chunkKey,
    // `voiceKey` — `null` НЕ ПО НЕДОСМОТРУ (`M-05`): он собирается из плана речи
    // (`spokenChunkText`, провайдер, модель, голос, seed, `providerOpts`, `roleDigest`,
    // версия тракта), а `makeTake` плана не видит и видеть не должен — это значение в памяти
    // для тестов `V-01`. Тот же довод и та же форма, что у `sourceHash` строкой ниже.
    voiceKey: null,
    spokenText,
    normalizerVersion: NORMALIZER_VERSION,
    sourceHash: null,
    pcm: { sha256: sha256 ?? null, numSamples, sampleRate: MOCK_SAMPLE_RATE },
    leadInSamples: msToSamples(MOCK_PROFILE.leadInMs, MOCK_SAMPLE_RATE),
    tailSamples: msToSamples(MOCK_PROFILE.tailMs, MOCK_SAMPLE_RATE),
    health,
    provenance: {
      providerId: capabilities.providerId,
      modelId: 'mock',
      voiceId: 'mock',
      voiceCategory: 'none',
      seed,
      requestId: null,
      billedUnits: 0,
      planTierAtGeneration: 'none',
      // Ставки нет, потому что нет и отправки: `null` — «ставка не объявлена», и это не то же
      // самое, что `0` («дубль бесплатен»). Второе было бы утверждением о деньгах (`V-06`).
      planRateAtGeneration: null,
      generatedAt: null,
      conditionedOn: [],
    },
    bindings: bound.bindings,
    bind: bound.bind,
  };
}

// --- провайдер по интерфейсу -------------------------------------------------

/**
 * `tts:mock@1` как `TtsProvider`.
 *
 * Обёртка над чистой функцией, а не вторая реализация: `Promise` в подписи интерфейса стоит
 * ради сетевого провайдера, а mock синхронен по построению (`requiresNetwork: false`).
 * Тест сверяет, что обёртка отдаёт ровно то же, что `synthesize`.
 */
export const mockProvider: TtsProvider = Object.freeze({
  capabilities,
  // `async`, а не «вернуть `Promise.resolve`»: метод, объявленный возвращающим `Promise`, но
  // бросающий СИНХРОННО, мимо `.catch()` вызывающего проходит молча. Тест на отказ по формату
  // это и поймал — отказ обязан приходить отклонённым промисом.
  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    if (sampleRateOfPcmFormat(request.outputFormat) !== MOCK_SAMPLE_RATE) {
      throw new VoiceError(
        'ADR-0010 §9',
        `запрошен формат ${request.outputFormat}, а \`tts:mock@1\` отдаёт только ` +
          `${MOCK_PCM_FORMAT}. Формат выбирается по capability (\`pcmFormatFor\`), а не по имени провайдера.`,
      );
    }
    return synthesize({ text: request.spokenText, seed: request.seed });
  },
});
