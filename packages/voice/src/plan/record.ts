// Укладка дубля: приёмка → PCM в CAS → take-файл → запись в `store.lock` (`V-03`).
//
// ЗДЕСЬ ИСПОЛНЯЕТСЯ **V4** — «`chunkKey` ≠ `voiceKey`: одинаковые абзацы дают два take-файла и
// один оплаченный дубль». Механика ровно одна и она видна глазами: перед вызовом источника
// смотрим `voiceKey` в индексе уже уложенного. Попадание — источник НЕ зовётся вовсе (в тесте
// это считается вызовами), а второй take-файл пишется со СВОИМ `chunkKey` и тем же
// `pcm.sha256`. Промах — зовём лестницу приёмки (`V-02`) и кладём байты в CAS.
//
// БАЙТЫ БЛОБА — СЫРОЙ s16le, БЕЗ WAV-ЗАГОЛОВКА (решение владельца `V-03`, вопрос 8). Довод про
// деньги: адрес блоба — sha256 СОДЕРЖИМОГО, и если в содержимое входит наш 44-байтный
// заголовок, то любая будущая правка формата заголовка переадресует ВСЕ оплаченные дубли, а
// перегенерировать их нельзя (ADR-0006 §2: take не перегенерируется ни при каком промахе).
// Формат при этом не теряется: `sampleRate` и `numSamples` лежат в take-файле рядом, а
// «моно, s16 little-endian» — единственный формат тракта (`M-03`).
//
// ГРАНИЦЫ РЕЧИ ИЗМЕРЯЮТСЯ ЗДЕСЬ (`V-04`, ADR-0003 T7), а не приходят входом. Долг №85 закрыт
// ровно этим: пока `leadInSamples`/`tailSamples` были параметром, ноль был законным входом в
// КОММИТИМЫЙ артефакт, тогда как `FACT` (SP-2 U4.3) настоящий лид-ин — 95–100 мс. Детектор
// зовётся на промахе `voiceKey`, вместе с укладкой байтов, и его ответ кладётся рядом с ними.
//
// ПРИВЯЗКИ ТОЖЕ СЧИТАЮТСЯ ЗДЕСЬ (`V-05`, ADR-0010 §5), а не приходят готовым списком. До этой
// задачи поле называлось `bindings` и несло функцию «чанк → готовые привязки»; тогда в
// коммитимый артефакт можно было положить любой список, в том числе выдуманный, — тот же класс
// дефекта, что края-параметры до `V-04` (долг №85). Теперь входом приходят ТОКЕНЫ с якорями
// (их минтит `C-04`, и это не дело укладки) и БИНДЕР (его выбирает вызывающий), а привязки
// ВЫЧИСЛЯЮТСЯ. Стадия зовётся на каждый чанк: у рефрена один звук на два места (**V4**), и
// привязки у них разные, потому что якоря разные.
//
// СЕТИ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: источник дубля ВНЕДРЯЕТСЯ (тот же приём, что у лестницы
// `V-02`), поэтому весь путь исполним в тестовом контуре без ключа и без сети (**V9**).
// Гейт ADR-0006 §9 («промах ключа не зовёт сеть молча, сборка падает без `--allow-tts`») стоит
// у ВЫЗЫВАЮЩЕГО — он и решает, какой источник подставить; здесь его нет намеренно, иначе
// решение «ходить ли в сеть» оказалось бы в двух местах сразу.

import path from 'node:path';

import { asSamples } from '@vpe/core-model';
import { bytesFromPcm, pcmFromBytes, upsertEntry, type PcmS16, type Store, type StoreLockEntry } from '@vpe/media';

import { VoiceError } from '../errors.js';

import { assessTake, explainRejection, type TakeAcceptance } from '../acceptance/health.js';
import { isPronounceable, wordsOf } from '../bind/interval.js';
import { providerTimestampsBinder } from '../bind/provider-timestamps.js';
import type { Binder, SourceTokenRef, TakeBind } from '../bind/types.js';
import {
  assessEdgeDrift,
  speechEdges,
  type EdgeDrift,
  type EdgeDriftEntry,
  type SpeechEdgeMeasurement,
  type SpeechEdgesParams,
} from '../edges/index.js';
import { acceptTakeWithRetries, type TakeAttemptRequest } from '../acceptance/ladder.js';
import type { ProviderAlignment, Take, TakeHealth, TakeProvenance, TokenBinding } from '../providers/types.js';

import { NORMALIZER_VERSION } from './keys.js';
import type { PlannedChunk, SpeechPlan } from './speech-plan.js';
import { takeFilePath, writeTakeFile } from './take-file.js';
import { readTakeBytes, type VoiceCache, type VoiceCacheRecord } from './voice-cache.js';

/** Что источник дубля отдаёт плану: ответ провайдера ПЛЮС фактические байты дорожки. */
export interface VoiceSynthesis {
  readonly alignment: ProviderAlignment | null;
  readonly pcm: PcmS16;
}

/** Источник дубля. Провайдер, обёртка над ним или подделка теста — сеть не обязательна. */
export type SpeechSource = (request: TakeAttemptRequest) => Promise<VoiceSynthesis> | VoiceSynthesis;

/** Провенанс, который знает только вызывающий: тариф, класс голоса, id запроса, время. */
export interface RecordProvenance {
  readonly voiceCategory: TakeProvenance['voiceCategory'];
  /** `FACT` (r3 §3.2): тариф на дату генерации ретроспективно не восстановить. */
  readonly planTierAtGeneration: string;
  readonly requestId?: string | null;
  /** Момент UTC. **Вход, а не часы**: часы запрещены линтом во всех `src` пакетов (**V8**, D4). */
  readonly generatedAt?: string | null;
}

/** Значение `store.lock` — берётся у писателя `@vpe/media`, второй копии формы не заводится. */
export type StoreLockValue = ReturnType<typeof upsertEntry>;

export interface RecordSpeechInput {
  readonly plan: SpeechPlan;
  /** Пороги приёмки из `audio-profile/1`. Умолчания нет (`V-02`). */
  readonly acceptance: TakeAcceptance;
  readonly source: SpeechSource;
  readonly store: Store;
  /** Значение `store.lock` до укладки. Возвращается НОВОЕ — файл пишет вызывающий. */
  readonly lock: StoreLockValue;
  /** Корень дерева проекта: `voice/takes/` лежит внутри него (ADR-0005 §1). */
  readonly projectRoot: string;
  /**
   * Параметры акустического детектора границ речи из `audio-profile/1` (`V-04`, ADR-0003 T7).
   *
   * ПРИХОДЯТ ПАРАМЕТРЫ, А НЕ ГОТОВЫЕ КРАЯ, и это правка `V-04` против `V-03`. Раньше поле
   * называлось `edges` и несло уже посчитанную пару `leadInSamples`/`tailSamples` с пометкой
   * «вычисление — граница задачи `V-04`»; в тестах туда шли нули. Пока края были ВХОДОМ, ноль
   * оставался выразим — а ноль в коммитимом артефакте боевого дубля есть ложь (`FACT` SP-2
   * U4.3: настоящий лид-ин 95–100 мс), и ровно об этом долг №85. Теперь края ИЗМЕРЯЮТСЯ здесь
   * же, из байтов принятого дубля, и подделать их вызывающему нечем.
   */
  readonly speechEdges: SpeechEdgesParams;
  readonly provenance: RecordProvenance;
  /**
   * Чем привязывать токены ко времени (`V-05`, ADR-0010 §5). Умолчание — дефолтный биндер v1
   * `provider-timestamps@1`.
   *
   * ВНЕДРЯЕТСЯ, А НЕ ВЫБИРАЕТСЯ ПО ИМЕНИ. Переход на forced alignment — это подстановка
   * другого значения в это поле, и ни одной строки здесь он не меняет; выбор по `binderId`
   * запрещён (**V16**) и охраняется тем же двойным охранником, что и выбор провайдера.
   */
  readonly binder?: Binder;
  /**
   * Токены исходника с их якорями — второй вход стадии `bind` (ADR-0010 §5).
   *
   * ВХОД, А НЕ ВЫЧИСЛЕНИЕ, И ПРИЧИНА НЕ В УДОБСТВЕ: якоря минтит `C-04` (`syncLedger`), а
   * укладка дубля ledger'а не видит и видеть не должна — минт есть акт авторства и живёт в
   * `core-model`. Готовую раздачу строит `tokensOfPlan` (`bind/tokens.ts`).
   *
   * Поле НЕОБЯЗАТЕЛЬНО: дубль без стадии `bind` законен и записывается с пустыми
   * `bindings[]` и `bind: null` (решение владельца, `V-05` вопрос 5). Но если раздача
   * ПРИШЛА и оказалась пустой для чанка, в котором есть произносимые слова, — это отказ, а
   * не пустой список: молча записанный пустой `bindings[]` неотличим от «стадия не
   * работала», а стоил бы AC6 для аудио.
   */
  readonly tokens?: (chunk: PlannedChunk) => readonly SourceTokenRef[];
  /**
   * Межсборочный кэш стадии `voice` (`M-05`, ADR-0006 §1). Не передан — работает прежний
   * внутрипрогонный индекс, и только он.
   *
   * ВНЕДРЯЕТСЯ, А НЕ СОЗДАЁТСЯ ЗДЕСЬ, ровно как `store` и `binder`: путь до `.cache` — знание
   * вызывающего, и тестовый контур подставляет сюда счётчик обращений вместо диска.
   *
   * ЧТО ИМЕННО МЕНЯЕТСЯ ОТ ЕГО ПОЯВЛЕНИЯ. Ничего в укладке: попадание кэша и попадание
   * внутрипрогонного индекса дают ОДНУ И ТУ ЖЕ структуру `Recorded`, поэтому take-файл,
   * привязки и запись `store.lock` собираются теми же строками. Меняется одно —
   * `sourceCalls`: на прогретом кэше источник не зовётся ни разу, и это ровно то число,
   * которое означает «сколько оплачено» (**K3** на стадии `voice`).
   */
  readonly cache?: VoiceCache;
}

/** Что уложено по одному чанку плана. */
export interface RecordedTake {
  readonly chunkKey: string;
  readonly voiceKey: string;
  /** Путь take-файла ОТНОСИТЕЛЬНО корня проекта (ADR-0005 §1). */
  readonly takeFile: string;
  readonly sha256: string;
  /** `false` — байты пришли из уже уложенного дубля с тем же `voiceKey` (**V4**). */
  readonly synthesized: boolean;
  /**
   * Откуда взялись байты (`M-05`). Три значения, и они РАЗНЫЕ по цене:
   * `source` — заплачено сейчас; `run` — попадание внутрипрогонного индекса (рефрен, **V4**);
   * `cache` — попадание МЕЖСБОРОЧНОГО кэша, то есть заплачено в прошлой сборке (долг №89).
   * Различать их нужно отчёту сборки (ADR-0006 §12): «почему пересобралась глава 3» — это
   * вопрос о том, чего именно не хватило в кэше.
   */
  readonly origin: 'source' | 'run' | 'cache';
  readonly take: Take;
}

export interface RecordSpeechResult {
  readonly takes: readonly RecordedTake[];
  /** Новое значение `store.lock`; записать его на диск — дело вызывающего (ADR-0005 §9). */
  readonly lock: StoreLockValue;
  /** Сколько раз позван источник дубля. Ровно это число и есть «сколько оплачено». */
  readonly sourceCalls: number;
  /** Сколько чанков взяли байты из МЕЖСБОРОЧНОГО кэша. На холодном прогоне — ноль. */
  readonly cacheHits: number;
  /**
   * WARN о дрейфе акустического лид-ина по серии (`V-04`, риск roadmap §4.5).
   *
   * ЗДЕСЬ, А НЕ В TAKE-ФАЙЛЕ (решение владельца, `V-04` вопрос 4б): «систематически выходит за
   * диапазон» — свойство СЕРИИ, и полем одного дубля оно не выражается. Отказом тоже не
   * является: одиночный дубль за диапазоном законен. Читает это поле вызывающий — тот же, кто
   * печатает отчёт сборки; молча его проглотить можно, но тогда и находки не будет.
   */
  readonly edgeDrift: EdgeDrift;
}

/** Байты, уже уложенные в этом прогоне: ключ — `voiceKey`, значение — всё, что от них зависит. */
interface Recorded {
  readonly sha256: string;
  readonly numSamples: number;
  readonly sampleRate: number;
  readonly health: TakeHealth;
  /**
   * Измеренные края (`V-04`). Лежат РЯДОМ С БАЙТАМИ, а не считаются на каждый чанк: края —
   * функция байтов, а байты у одного `voiceKey` одни (на этом стоит **V4**). Повторный прогон
   * детектора для рефрена дал бы тот же ответ (идемпотентность покрыта тестом) и стоил бы
   * лишнего прохода по дорожке.
   *
   * ПОПАДАНИЕ МЕЖСБОРОЧНОГО КЭША ЗАПОЛНЯЕТ ЭТО ПОЛЕ ТЕМ ЖЕ ИЗМЕРЕНИЕМ (`M-05`), а не значением
   * из кэша: `fromCache` зовёт `speechEdges` по байтам, прочитанным из CAS. Первая редакция
   * клала края в запись кэша — и линт `V-04` (долг №85) покраснел, справедливо: величина,
   * пришедшая в укладку готовой, есть возможность записать в коммитимый артефакт измерение,
   * которого не было.
   */
  readonly edges: SpeechEdgeMeasurement;
  /**
   * Байты дорожки и ответ провайдера — входы стадии `bind` (`V-05`).
   *
   * ЛЕЖАТ ЗДЕСЬ ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО И КРАЯ, И ЭТО НЕ КЭШ РАДИ СКОРОСТИ. Рефрен (**V4**)
   * — один оплаченный дубль на ДВА чанка с разными `chunkKey`, разными местами и разными
   * якорями; привязки у них поэтому РАЗНЫЕ, а звук и таймкоды — одни. Не сохрани мы их на
   * попадании ключа, второй чанк остался бы без привязок вовсе — молча.
   */
  readonly pcm: Uint8Array;
  readonly alignment: ProviderAlignment | null;
}

/**
 * `billedUnits` — «сколько единиц ОТПРАВЛЕНО провайдеру» (ADR-0010 §2).
 *
 * `FACT` (SP-2): единица тарификации — **code points** отправленного текста, а не UTF-16 units
 * и не графемы. Величина вычислима офлайн и проверяема тестом; «сколько это стоило» — другая
 * величина, она считается из `planTierAtGeneration` и в это поле не складывается.
 */
function billedUnits(spokenText: string): number {
  return [...spokenText].length;
}

/**
 * Запись `store.lock` о блобе речи.
 *
 * `kind: 'voice'` — не косметика: на это ЗНАЧЕНИЕ повешено правило **P7** («реплик ≥ 2» для
 * невосстановимых байтов), и опечатка вывела бы оплаченный дубль из-под него молча.
 * `replicas: []` законен и правилу не противоречит: список наполняет `vpe store push` (`G-03`),
 * а схема, требующая двух реплик, сделала бы невозможной саму запись о свежем дубле (`M-01`).
 * `origin` — «как байты попали в проект», то есть `providerId` (прецедент строки **P12**:
 * перечня допустимых значений у него нет намеренно).
 */
function lockEntry(sha256: string, size: number, providerId: string): StoreLockEntry {
  return { sha256, size, kind: 'voice', origin: providerId, replicas: [] };
}

/** Что стадия `bind` положила в take-файл: потребляемый выход и входы пересчёта. */
interface BoundChunk {
  readonly bindings: readonly TokenBinding[];
  readonly bind: TakeBind | null;
}

/**
 * Стадия `bind` над одним чанком (`V-05`, ADR-0010 §5).
 *
 * Зовётся НА КАЖДЫЙ чанк, а не на каждый оплаченный дубль: у рефрена звук один, а места и
 * якоря — разные (**V4**), значит и привязки разные.
 *
 * @throws {VoiceError} `ADR-0010 §5` — раздача токенов пришла, но для чанка с произносимыми
 *   словами оказалась пустой. Пустой `bindings[]` в артефакте означает «стадия не работала», и
 *   записать его вместо потерянных токенов значило бы соврать в коммитимом файле.
 */
async function bindChunk(
  input: RecordSpeechInput,
  chunk: PlannedChunk,
  recorded: Recorded,
): Promise<BoundChunk> {
  if (input.tokens === undefined) return { bindings: [], bind: null };

  const tokens = input.tokens(chunk);
  if (tokens.length === 0) {
    const spoken = wordsOf([...chunk.spokenChunkText]).filter((word) => isPronounceable(word.text));
    if (spoken.length > 0) {
      throw new VoiceError(
        'ADR-0010 §5',
        `чанк ${chunk.chunkKey}: раздача токенов вернула пустой список, а в отправленном ` +
          `тексте ${String(spoken.length)} произносимы(х) слов(а). Пустые привязки в ` +
          'take-файле читаются как «стадия `bind` не работала», то есть потерянные токены ' +
          'стали бы неотличимы от их отсутствия. Вероятная причина: раздача построена по ' +
          'другому плану либо по другому разбору исходника.',
      );
    }
    return { bindings: [], bind: null };
  }

  const binder = input.binder ?? providerTimestampsBinder;
  const bindings = await binder.bind(
    recorded.pcm,
    recorded.sampleRate,
    chunk.spokenChunkText,
    tokens,
    recorded.alignment ?? undefined,
  );
  return {
    bindings,
    bind: { binderId: binder.binderId, tokens, providerAlignment: recorded.alignment },
  };
}

/**
 * Восстановление `Recorded` из записи межсборочного кэша (`M-05`).
 *
 * ПОПАДАНИЕ НИЧЕГО НЕ ПРИНИМАЕТ НА ВЕРУ, КРОМЕ НЕВОСПРОИЗВОДИМОГО. Из кэша берутся ровно
 * четыре величины: адрес байтов, длина, частота и ответ провайдера — то, чего нельзя
 * пересчитать (ответ стоил денег и пришёл из сети). ВСЁ ОСТАЛЬНОЕ СЧИТАЕТСЯ ЗДЕСЬ, теми же
 * функциями, что и на промахе: края — `speechEdges` (`V-04`), вердикт — `assessTake` (`V-02`).
 *
 * Так «попадание == промах» (**K3**, ADR-0006 §10) перестаёт быть свойством ХРАНЕНИЯ и
 * становится свойством ПОСТРОЕНИЯ: подменить пересчитанное значение правкой файла в `.cache`
 * невозможно, потому что оттуда оно не читается. Это не теория — линт `V-04` (долг №85)
 * покраснел ровно на первой редакции, где края лежали в записи кэша.
 *
 * @throws {VoiceError} `ADR-0006 §8` — длина байтов разошлась с записью (кэш указывает на
 *   чужой блоб), либо оплаченный дубль больше не проходит приёмку с ТЕКУЩИМИ порогами.
 *   Второе — не ошибка кэша и не повод молча заплатить снова: пороги правил человек, и он
 *   обязан это увидеть.
 */
async function fromCache(
  input: RecordSpeechInput,
  chunk: PlannedChunk,
  hit: VoiceCacheRecord,
): Promise<Recorded> {
  const bytes = await readTakeBytes(input.store, hit);
  const pcm = pcmFromBytes(hit.sampleRate, bytes);
  if (pcm.samples.length !== hit.numSamples) {
    throw new VoiceError(
      'ADR-0006 §8',
      `чанк ${chunk.chunkKey}: запись кэша обещает ${String(hit.numSamples)} сэмплов, а по ` +
        `адресу \`${hit.sha256}\` лежит ${String(pcm.samples.length)}. Кэш указывает на чужие ` +
        'байты — принять их значило бы записать в take-файл длину, которой у дорожки нет',
    );
  }

  const health = assessTake({
    spokenText: chunk.spokenChunkText,
    alignment: hit.alignment,
    numSamples: pcm.samples.length,
    sampleRate: hit.sampleRate,
    acceptance: input.acceptance,
  });
  if (health.verdict !== 'accepted') {
    throw new VoiceError(
      'ADR-0006 §8',
      `чанк ${chunk.chunkKey}: оплаченный дубль \`${hit.sha256}\` не проходит приёмку с ` +
        `текущими порогами: ${String(health.rejectReason)}; ` +
        `${explainRejection({ spokenText: chunk.spokenChunkText, alignment: hit.alignment }, health)?.message ?? ''} ` +
        'Молча позвать источник значило бы заплатить второй раз за то, что уже оплачено, а ' +
        'молча принять — записать в коммитимый артефакт вердикт, которого приёмка не давала. ' +
        'Пороги `takeAcceptance` правил человек — решать ему',
    );
  }

  return {
    sha256: hit.sha256,
    numSamples: pcm.samples.length,
    sampleRate: hit.sampleRate,
    health,
    edges: speechEdges(pcm, input.speechEdges),
    pcm: bytes,
    alignment: hit.alignment,
  };
}

/**
 * Укладывает весь план: для каждого чанка — дубль, блоб, take-файл и запись в `store.lock`.
 *
 * @throws {VoiceError} `ADR-0010 §1 (M12)` — лестница приёмки исчерпана на каком-то чанке.
 *   Деления чанка при этом не происходит ни при каком исходе.
 */
export async function recordSpeechPlan(input: RecordSpeechInput): Promise<RecordSpeechResult> {
  const byVoiceKey = new Map<string, Recorded>();
  const takes: RecordedTake[] = [];
  // Серия для оценки дрейфа: по одному входу на РАЗЛИЧНЫЙ дубль. Рефрен, уложенный дважды,
  // добавил бы один и тот же лид-ин вторым голосом и сдвинул бы медиану — а он один дубль.
  const drift: EdgeDriftEntry[] = [];
  let lock = input.lock;
  let sourceCalls = 0;
  let cacheHits = 0;

  for (const chunk of input.plan.chunks) {
    let known = byVoiceKey.get(chunk.voiceKey);
    let origin: RecordedTake['origin'] = known === undefined ? 'source' : 'run';

    // МЕЖСБОРОЧНЫЙ КЭШ — ВТОРОЙ ВОПРОС, А НЕ ПЕРВЫЙ (`M-05`). Сначала спрашивается индекс
    // этого прогона: он уже держит байты в памяти, а кэш держит только адрес, по которому за
    // ними придётся сходить в CAS. Порядок наблюдаем в числах — `sourceCalls` и `cacheHits`
    // на рефрене дают 1 и 0, а не 1 и 1.
    if (known === undefined && input.cache !== undefined) {
      const hit = await input.cache.get(chunk.voiceKey);
      if (hit !== undefined) {
        known = await fromCache(input, chunk, hit);
        byVoiceKey.set(chunk.voiceKey, known);
        cacheHits += 1;
        origin = 'cache';
        // В серию дрейфа краёв (`V-04`) попадание НЕ добавляется: серия оценивает поведение
        // ПРОВАЙДЕРА в этой сборке, а здесь провайдер не работал. Иначе прогретый прогон
        // «подтверждал» бы дрейф числами прошлой сборки.
      }
    }

    const synthesized = known === undefined;
    let recorded: Recorded;

    if (known === undefined) {
      // Промах ключа `voice` — единственное место, где зовётся источник дубля.
      let last: VoiceSynthesis | undefined;
      const accepted = await acceptTakeWithRetries({
        chunkKey: chunk.chunkKey,
        spokenText: chunk.spokenChunkText,
        acceptance: input.acceptance,
        source: async (request) => {
          sourceCalls += 1;
          const synthesis = await input.source(request);
          last = synthesis;
          return {
            alignment: synthesis.alignment,
            numSamples: synthesis.pcm.samples.length,
            sampleRate: synthesis.pcm.sampleRate,
          };
        },
      });
      if (last === undefined) {
        throw new TypeError(
          `чанк ${chunk.chunkKey}: приёмка вернула принятый дубль, но источник не отдал ни ` +
            'одной дорожки — это дефект источника, а не входа',
        );
      }
      const bytes = bytesFromPcm(last.pcm);
      const sha = String(await input.store.put(bytes, 'voice'));
      // Края измеряются ЗДЕСЬ — после приёмки и до записи take-файла. Байты при этом не
      // трогаются ни одним сэмплом: в CAS уходит сырой s16le дубля, а `V-04` его ИЗМЕРЯЕТ.
      // Резать интервал речи и класть краевой фейд будет тот, кто строит дорожку
      // (`CP-01`/`CP-05`); фейд ещё и здесь был бы первым из двух, а двойной фейд ADR-0003 T7
      // запрещает («внутри уже отведённого интервала»).
      recorded = {
        sha256: sha,
        numSamples: accepted.attempt.numSamples,
        sampleRate: accepted.attempt.sampleRate,
        health: accepted.health,
        edges: speechEdges(last.pcm, input.speechEdges),
        pcm: bytes,
        alignment: accepted.attempt.alignment,
      };
      byVoiceKey.set(chunk.voiceKey, recorded);
      drift.push({ leadInSamples: recorded.edges.leadInSamples, sampleRate: recorded.sampleRate });
      lock = upsertEntry(lock, lockEntry(sha, bytes.length, chunk.voice.providerId));
      // Запись в кэш — ПОСЛЕ `store.put`, и порядок значим: сначала байты в CAS, потом адрес
      // в кэше. Обрыв между шагами оставит оплаченные байты без записи о них (следующая
      // сборка заплатит снова — плохо, но честно); обратный порядок оставил бы в кэше адрес,
      // по которому байтов нет, то есть попадание, ведущее в пустоту.
      if (input.cache !== undefined) {
        await input.cache.put(chunk.voiceKey, {
          sha256: recorded.sha256,
          numSamples: recorded.numSamples,
          sampleRate: recorded.sampleRate,
          alignment: recorded.alignment,
        });
      }
    } else {
      recorded = known;
    }

    const bound = await bindChunk(input, chunk, recorded);


    const take: Take = {
      chunkKey: chunk.chunkKey,
      // `voiceKey` в КОММИТИМОМ артефакте (`M-05`, решение владельца, вопрос 3): без него
      // индекс `voiceKey → sha256` жил бы только в игнорируемом git каталоге `.cache`, и его
      // потеря стоила бы денег. Здесь он настоящий — план его посчитал.
      voiceKey: chunk.voiceKey,
      spokenText: chunk.spokenChunkText,
      normalizerVersion: NORMALIZER_VERSION,
      sourceHash: chunk.sourceHash,
      pcm: {
        sha256: recorded.sha256,
        numSamples: asSamples(recorded.numSamples),
        sampleRate: recorded.sampleRate,
      },
      leadInSamples: recorded.edges.leadInSamples,
      tailSamples: recorded.edges.tailSamples,
      health: recorded.health,
      provenance: {
        providerId: chunk.voice.providerId,
        modelId: chunk.voice.modelId,
        voiceId: chunk.voice.voiceId,
        voiceCategory: input.provenance.voiceCategory,
        seed: chunk.voice.seed,
        requestId: input.provenance.requestId ?? null,
        billedUnits: billedUnits(chunk.spokenChunkText),
        planTierAtGeneration: input.provenance.planTierAtGeneration,
        generatedAt: input.provenance.generatedAt ?? null,
        conditionedOn: chunk.conditionedOn,
      },
      bindings: bound.bindings,
      bind: bound.bind,
    };

    const takeFile = takeFilePath(chunk.chunkKey);
    await writeTakeFile(path.join(input.projectRoot, takeFile), take);
    takes.push({
      chunkKey: chunk.chunkKey,
      voiceKey: chunk.voiceKey,
      takeFile,
      sha256: recorded.sha256,
      synthesized,
      origin,
      take,
    });
  }

  return { takes, lock, sourceCalls, cacheHits, edgeDrift: assessEdgeDrift(drift) };
}
