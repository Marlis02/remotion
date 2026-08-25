// Интерфейс TTS-провайдера (`V-01`, ADR-0010 §8) — формы, и ни одной строки поведения.
//
// ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: потребитель ветвится по **capabilities**, а не по имени
// провайдера (ADR-0010 §8). Имя провайдера — это `providerId`, и он существует ровно для
// двух вещей: попасть в `voiceKey` (ADR-0006 §2) и в provenance дубля («как сделано»).
// Сравнивать его в `if` запрещено — охранник в `eslint.config.js` (`CAPABILITY_SYNTAX`) и
// `tests/lints/adr0010-capability-branching.test.ts`.
//
// ПОЧЕМУ ЗНАЧЕНИЯ CAPABILITIES — ЛИТЕРАЛЬНЫЕ UNION'Ы, А НЕ `string`. Ветвление обязано быть
// исчерпывающим для КОМПИЛЯТОРА: с `string` появление третьего значения `seedSupport`
// не покраснело бы нигде, и «ветвление по capabilities» осталось бы обещанием. С union'ом
// `switch` без ветки на новое значение падает на `never`.
//
// ЧЕГО В ЭТОМ ФАЙЛЕ НЕТ И БЫТЬ НЕ МОЖЕТ (структурно, а не по договорённости):
//   * `previous_request_ids` — **V5**, ADR-0010 §4: хендлы недетерминированы, живут 2 часа и
//     образуют транзитивную цепочку ключей кэша. Стичинг выражается ТОЛЬКО текстом
//     (`previousText`/`nextText`), и `FACT` (SP-2, findings U5) он не тарифицируется;
//   * `pronunciation_dictionary_locators` — **V7**, ADR-0010 §7a: alias-правило меняет длину
//     нормализованного текста ⇒ `charIdentity` обязано нарушиться ⇒ штатная правка
//     произношения срабатывала бы аварийной лестницей приёмки. Произношение выражается
//     маркером `[say:]`, который живёт в исходнике и попадает в `voiceKey` по построению.
// Оба поля отсутствуют В ТИПЕ, а не «не заполняются»: при `exactOptionalPropertyTypes: true`
// «поля нет» и «поле есть со значением `undefined`» — разные типы. Поведенческая половина
// охранника — единственный конструктор запроса (`request.ts`) и тесты на сериализованной форме.

import type { Samples } from '@vpe/core-model';

// Тип блока `bind` живёт в каталоге стадии, которая его наполняет (`V-05`, вопрос 3), а не
// здесь. Импорт ТИПОВЫЙ и потому стирается: `bind/types.ts` в свою очередь берёт отсюда
// `ProviderAlignment` и `TokenBinding`, и цикла в собранном коде не возникает ни одного.
// Альтернатива — третий файл общих форм — развела бы `Take` и `TokenBinding` по разным
// адресам без единого выигрыша.
import type { TakeBind } from '../bind/types.js';

// ── Capabilities (ADR-0010 §8) ──────────────────────────────────────────────

/**
 * Единица таймкодов провайдера.
 *
 * `FACT` (SP-2, findings U4.2, 28/28 строк на двух голосах): у ElevenLabs единица —
 * **code point**, а не UTF-16 unit и не графема. `'none'` — законное значение: `FACT`
 * (r1 §5.1) половина альтернативных провайдеров пословных таймкодов не даёт вовсе, и такой
 * провайдер не отвергается — он обязан работать в паре с `bind: forced-alignment`.
 */
export type TimestampUnit = 'character' | 'word' | 'none';

/** Домены выравнивания. `normalized` существует только там, где есть нормализатор. */
export type TimestampDomain = 'original' | 'normalized';

/**
 * Формат PCM. `FACT` (r1 §0.6): `pcm_24000` доступен без Pro, 44.1 кГц требует Pro.
 * Внутри пайплайна mp3 нет ни на одном шаге (**V6**, ADR-0010 §9), поэтому перечень — только PCM.
 */
export type PcmFormat = 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100';

/**
 * Насколько провайдер держит seed.
 *
 * `'exact'` — тот же вход и тот же seed дают побайтово тот же звук (это `tts:mock@1`,
 * истина по построению). `'best-effort'` — `FACT` (r1 §2.3) вендор объявляет «Determinism is
 * not guaranteed» даже при фиксированном seed. `'none'` — seed не принимается вовсе.
 */
export type SeedSupport = 'exact' | 'best-effort' | 'none';

/**
 * Чем провайдер умеет сшивать соседние чанки.
 *
 * `'text'` — `previous_text`/`next_text` (единственное, что разрешено v1, ADR-0010 §4).
 * `'request-ids'` — хендлы предыдущих запросов; **capability существует, а поля запроса нет**,
 * и это не противоречие: возможность провайдера описывается честно, а решение ею не
 * пользоваться принято ADR-0010 §4 и охраняется формой `TtsRequest`.
 */
export type RequestStitching = 'none' | 'text' | 'request-ids';

/** Семь полей ADR-0010 §8 плюс имя провайдера. Ветвление — только по ним. */
export interface TtsCapabilities {
  /** Имя провайдера. В `voiceKey` и в provenance — да; в `if` — нет (ADR-0010 §8). */
  readonly providerId: string;
  readonly timestampUnit: TimestampUnit;
  readonly timestampDomains: readonly TimestampDomain[];
  /** `FACT` (SP-2): при `apply_text_normalization: "off"` числа, даты и деньги не трогаются. */
  readonly canDisableNormalization: boolean;
  readonly pcmFormats: readonly PcmFormat[];
  readonly seedSupport: SeedSupport;
  readonly requestStitching: RequestStitching;
  /** `false` — провайдер исполним в тестовом контуре без сети и без ключа (**V9**). */
  readonly requiresNetwork: boolean;
}

// ── Запрос (V5, V7 невыразимы) ──────────────────────────────────────────────

/**
 * Запрос к провайдеру речи. Строится ТОЛЬКО конструктором `ttsRequest` (`request.ts`).
 *
 * `applyTextNormalization` имеет тип-литерал `'off'`, а не `boolean`: нормализатор
 * переписывает текст, а маппинг original↔normalized API не отдаёт (`FACT` r1 §1.4) — то есть
 * включённая нормализация ломает span-map трансдьюсера (`C-03`) молча. Единственное законное
 * значение в v1 — `'off'`, и это записано типом, а не проверкой.
 */
export interface TtsRequest {
  /** Фактически отправляемый текст — он же входит в `charIdentity` приёмки (ADR-0010 §1). */
  readonly spokenText: string;
  readonly modelId: string;
  /** Идентификатор голоса. В репозиторий не попадает: значение приходит из `process.env`. */
  readonly voiceId: string;
  readonly seed: number;
  readonly outputFormat: PcmFormat;
  readonly applyTextNormalization: 'off';
  /** Стичинг только текстом (ADR-0010 §4). `FACT` (SP-2 U5): контекст не тарифицируется. */
  readonly previousText?: string;
  readonly nextText?: string;
  /** Настройки провайдера. Раскрываются в `cacheKeyView` поимённо (ADR-0006 §2), не «оптом». */
  readonly providerOpts?: Readonly<Record<string, unknown>>;
}

// ── Ответ ───────────────────────────────────────────────────────────────────

/**
 * Выравнивание в форме `/with-timestamps`: три массива одной длины.
 *
 * `FACT` (r1 §1.3): оба поля alignment **nullable** — могут не прийти вовсе; приёмка обязана
 * это обрабатывать, а не падать по `undefined`.
 */
export interface ProviderAlignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

/** Ответ провайдера. Имена полей — как у провайдера, чтобы граница была видна глазами. */
export interface TtsResponse {
  readonly audio_base64: string;
  readonly alignment: ProviderAlignment | null;
  readonly normalized_alignment: ProviderAlignment | null;
}

/**
 * Провайдер речи. Две вещи и ничего сверх: чем он умеет и как синтезирует.
 *
 * `Promise` в подписи стоит потому, что настоящий провайдер сетевой; `tts:mock@1` синхронен
 * по построению (`requiresNetwork: false`) и оборачивает свою чистую функцию — это видно
 * в `mock.ts` и проверено тестом «обёртка отдаёт то же, что чистая функция».
 */
export interface TtsProvider {
  readonly capabilities: TtsCapabilities;
  synthesize(request: TtsRequest): Promise<TtsResponse>;
}

// ── Дубль (ADR-0010 §1, §2, §5) ─────────────────────────────────────────────

/**
 * Причина отказа — ЛИТЕРАЛЬНЫЙ UNION, а не свободная строка (`V-02`).
 *
 * По тому же доводу, по которому литеральны capabilities (`V-01`): потребитель приёмки
 * (лестница, отчёт A/B, будущий `V-05`) обязан ветвиться исчерпывающе ДЛЯ КОМПИЛЯТОРА. Со
 * `string` появление седьмой причины не покраснело бы нигде; с union'ом `switch` без новой
 * ветки падает на `never`. Человеческий текст отказа при этом не потерян — он живёт в
 * `explainRejection` (`acceptance/health.ts`) вместе с `codePointDiff`, который показывает
 * МЕСТО расхождения, а не только факт.
 */
export type TakeRejectReason =
  /** `alignment: null` — оба поля ответа nullable (`FACT` r1 §1.3). Отказ, а не `TypeError`. */
  | 'no-alignment'
  /** `characters.join('')` не равен отправленному spoken-тексту (**V1**). */
  | 'char-identity'
  /** Три массива alignment разной длины. */
  | 'lengths'
  /** `start` убывает либо `start > end` (эпсилон 1e-9 — в секундах провайдера). */
  | 'monotonic'
  /** `uniqueTimestampRatio` ниже `takeAcceptance.minUniqueTimestampRatio` профиля. */
  | 'unique-ratio'
  /** Серия одинаковых стартов длиннее `takeAcceptance.maxEqualRun` профиля. */
  | 'equal-run'
  /**
   * `end[last]` вышел за пределы фактического PCM ДАЛЬШЕ ДОПУСКА `⌈sampleRate/1000⌉`
   * (ADR-0003 T7 после SP-2, `V-04`). Величина при этом отрицательна, но отрицательность
   * сама по себе отказом не является: превышение до одной миллисекунды законно.
   */
  | 'tail-residual';

/**
 * Метрики приёмки дубля (ADR-0010 §1).
 *
 * Восемь полей формы roadmap. Вычисление живёт в `acceptance/health.ts` (`V-02`, перенос
 * `sp2/lib/analyze.mjs`); в `V-01` оно временно лежало в `mock.ts`, потому что там же лежала
 * его спайковая форма. Пороги в этой структуре НЕ хранятся: они — данные профиля
 * (`audio-profile/1`, блок `takeAcceptance`), а не свойство дубля.
 */
export interface TakeHealth {
  /** `characters.join('') === отправленный spoken-текст`. `FACT` (SP-2): 56/56 на двух голосах. */
  readonly charIdentity: boolean;
  readonly lengthsMatch: boolean;
  readonly monotonic: boolean;
  readonly uniqueTimestampRatio: number;
  readonly maxEqualRun: number;
  /**
   * `end[last]` против фактической длины PCM.
   *
   * **`number`, а не бренд `Samples`, и это не недосмотр:** величина бывает ОТРИЦАТЕЛЬНОЙ —
   * именно ею и измеряется «таймкоды вышли за пределы фактического PCM». `asSamples`
   * отрицательные отвергает (`S-01`), то есть бренд здесь сделал бы невыразимым ровно то
   * состояние, ради обнаружения которого поле заведено.
   *
   * ЗНАК — ЕЩЁ НЕ ОТКАЗ (`V-04`): отвергается дубль при `tailResidualSamples < −⌈sampleRate/1000⌉`,
   * то есть за пределом одной миллисекунды дорожки (ADR-0003 T7 после SP-2). Поле остаётся
   * ИЗМЕРЕНИЕМ, а порог его чтения живёт в `assessTake` рядом со своим ADR.
   */
  readonly tailResidualSamples: number;
  readonly verdict: 'accepted' | 'rejected';
  /**
   * `null` у принятого дубля — поля НЕТ только у необязательного, а причина обязана быть
   * названа явно: при `exactOptionalPropertyTypes: true` «поля нет» и «поле есть со значением
   * `null`» — разные типы, и второе читается однозначно («причины нет»), а первое — нет.
   */
  readonly rejectReason: TakeRejectReason | null;
}

/**
 * Статус привязки токена (ADR-0010 §5, инвариант **V8**).
 *
 * `'measured'` — время ИЗМЕРЕНО (таймкоды провайдера либо forced alignment).
 * `'interpolated'` — время ВЫВЕДЕНО из соседей. **В v1 это значение не порождается никем**, и
 * это записано здесь намеренно: оно зарезервировано ТИПОМ, чтобы будущий биндер
 * (`ctc-fa@1`/`mfa@3`, `V-05`) добавлял ветку, а не поле. Охранник резервирования — тест
 * «в `packages/voice/src/**` литерал `'interpolated'` встречается только в этом объявлении».
 * `'absent'` — времени НЕТ вовсе: токен из одних непроизносимых code point'ов (эмодзи,
 * символы без букв и цифр). `FACT` (SP-2 U6): такие code points получают у провайдера интервал
 * НУЛЕВОЙ длины, и если бы движок записал их как `[t, t]`, субтитр получил бы слово нулевой
 * длительности, а AC5-b — точку в статистике вместо пропуска. ADR-0010 §1 требует ровно
 * обратного: `status: 'absent'`, а не интервал `[t, t]`.
 */
export type TokenBindingStatus = 'measured' | 'interpolated' | 'absent';

/**
 * Привязка токена к сэмплам (ADR-0010 §5).
 *
 * РАЗМЕЧЕННОЕ ОБЪЕДИНЕНИЕ, А НЕ ПЛОСКАЯ ЗАПИСЬ, — и это исполнимая форма **V8**. У `absent`
 * полей `startSample`/`endSample` НЕТ ЗНАЧЕНИЯ вовсе: «компилятор не выдумывает время»
 * перестаёт быть договорённостью и становится тем, что нельзя выразить. Интервал `[t, t]` для
 * проглоченного слова не «запрещён проверкой» — он не типизируется.
 *
 * **Кандидат в правку ADR-0010 §5:** там `startSample`/`endSample` объявлены `Samples` без
 * `null`, то есть на бумаге `absent` обязан нести какое-то время. Расхождение внесено сознательно
 * (`V-02`), подтверждено решением владельца (`V-05`, вопрос 2: «форма **V8** первична») и
 * оформлено готовым текстом правки ADR в отчёте `V-05`; долг №77 сужен до этой правки.
 */
export type TokenBinding =
  | {
      /**
       * Якорь токена исходника из ledger'а (`C-04`, пространство `w:` — внутреннее,
       * ADR-0004 §1, §2). Настоящие id приносит стадия `bind` (`V-05`); минт остаётся
       * в `core-model`, `bind` якорей не порождает.
       */
      readonly anchorId: string;
      readonly startSample: Samples;
      readonly endSample: Samples;
      readonly status: 'measured' | 'interpolated';
      /**
       * `null` — БИНДЕР НЕ ИЗМЕРЯЕТ УВЕРЕННОСТЬ, а не «уверенность плохая» (решение владельца,
       * `V-05` вопрос 2). У `provider-timestamps@1` числа уверенности нет по построению: в
       * ответе провайдера такого поля не существует вовсе, и записанная `1` была бы выдумкой
       * того же класса, что нулевой `leadInSamples` до `V-04` (долг №85). Настоящие числа
       * принесёт акустический биндер (`A-03`), и тогда `null` и `0.62` станут различимы.
       */
      readonly confidence: number | null;
    }
  | {
      readonly anchorId: string;
      /** Времени нет: ни `null`-заглушки в сэмплах, ни интервала нулевой длины. */
      readonly startSample: null;
      readonly endSample: null;
      readonly status: 'absent';
      /** Уверенности в несуществующем интервале не бывает — только `null`. */
      readonly confidence: null;
    };

/** Класс голоса. `FACT` (SP-2): он определяет доступность голоса на тарифе, а не только вкус. */
export type VoiceCategory = 'premade' | 'professional' | 'cloned' | 'none';

/** Провенанс дубля — «как сделано» (ADR-0010 §2). В `voiceKey` входит не всё. */
export interface TakeProvenance {
  readonly providerId: string;
  readonly modelId: string;
  readonly voiceId: string;
  /** Часть provenance, а НЕ часть `voiceKey`: выводится из `voiceId` (ADR-0010 §2). */
  readonly voiceCategory: VoiceCategory;
  readonly seed: number;
  readonly requestId: string | null;
  /** «Сколько единиц отправлено» — code points `spokenText` (ADR-0010 §2), не «сколько стоило». */
  readonly billedUnits: number;
  /** `FACT` (r3 §3.2): тариф на дату генерации ретроспективно не восстановить. */
  readonly planTierAtGeneration: string;
  readonly generatedAt: string | null;
  readonly conditionedOn: readonly string[];
}

/**
 * Дубль (ADR-0010 §2). В `V-01` — **значение в памяти**: CAS не пишется, `pcm.sha256` равен
 * `null` до `V-03` (решение владельца, вопрос 2; долг с адресом).
 *
 * `pcm.sha256` типизирован `string | null`, а не брендом `Sha256`: `voice` по карте ADR-0009
 * зависит только от `core-model` и `media` и `@vpe/schema` не резолвит вовсе, а разрешение
 * владельца на реэкспорт из `core-model` — на одну строку (`Samples`/`asSamples`). Бренд
 * приходит вместе с настоящей записью в CAS, то есть с `V-03`; долг записан.
 */
export interface Take {
  readonly chunkKey: string;
  /**
   * Идентичность СОДЕРЖИМОГО — ключ кэша стадии `voice` (ADR-0006 §2). Добавлено `M-05`,
   * решение владельца 2026-08-25 (вопрос 3); кандидат в правку ADR-0010 §2 — в отчёте.
   *
   * ЗАЧЕМ ОН В КОММИТИМОМ АРТЕФАКТЕ, ЕСЛИ ФАЙЛ НАЗВАН `chunkKey`. Затем, что `.cache` в git
   * НЕ ИДЁТ, а оплаченные дубли — идут. Без этого поля индекс `voiceKey → sha256` жил бы
   * только в `.cache/voice/manifest.json`, и `rm -rf .cache` стоил бы ДЕНЕГ: пересчитать
   * `voiceKey` из содержимого дубля нечем — в нём нет ни `providerOpts`, ни `roleDigest`, ни
   * `ttsPipelineVersion`. С полем манифест становится ПРОИЗВОДНЫМ, восстановимым сканом
   * каталога (`voiceCacheFromTakes`), и долг №89 закрывается по-настоящему.
   *
   * `null` законен и означает ровно «дубль собран не укладкой плана»: так его пишет
   * `makeTake` (`tts:mock@1`, значение в памяти для тестов `V-01`), который плана не видит.
   * Пересборка кэша такой файл не пропускает молча, а отвергает — отказ громче потери.
   */
  readonly voiceKey: string | null;
  /** Фактически отправленный текст лежит РЯДОМ с дублём — на этом стоит AC6 (ADR-0010 §2). */
  readonly spokenText: string;
  readonly normalizerVersion: string;
  readonly sourceHash: string | null;
  readonly pcm: {
    readonly sha256: string | null;
    readonly numSamples: Samples;
    readonly sampleRate: number;
  };
  readonly leadInSamples: Samples;
  readonly tailSamples: Samples;
  readonly health: TakeHealth;
  readonly provenance: TakeProvenance;
  /**
   * Привязки токенов исходника ко времени — ЕДИНСТВЕННЫЙ потребляемый выход стадии `bind`.
   * Пустой список законен и означает ровно «стадия `bind` над этим дублём не работала».
   */
  readonly bindings: readonly TokenBinding[];
  /**
   * Входы пересчёта привязок (`V-05`, решение владельца, вопрос 4, вариант «А»): чем измерено,
   * какие токены измерялись и что ответил провайдер. `null` — дубль без стадии `bind`.
   *
   * ЭТО ДИАГНОСТИЧЕСКИЙ ВХОД, А НЕ ВТОРАЯ ИСТИНА О ВРЕМЕНИ — см. `TakeBind` (`bind/types.ts`).
   * Компилятор читает `bindings[]`; в `bind.providerAlignment` он не заглядывает.
   */
  readonly bind: TakeBind | null;
}
