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
// СЕТИ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: источник дубля ВНЕДРЯЕТСЯ (тот же приём, что у лестницы
// `V-02`), поэтому весь путь исполним в тестовом контуре без ключа и без сети (**V9**).
// Гейт ADR-0006 §9 («промах ключа не зовёт сеть молча, сборка падает без `--allow-tts`») стоит
// у ВЫЗЫВАЮЩЕГО — он и решает, какой источник подставить; здесь его нет намеренно, иначе
// решение «ходить ли в сеть» оказалось бы в двух местах сразу.

import path from 'node:path';

import { asSamples } from '@vpe/core-model';
import { bytesFromPcm, upsertEntry, type PcmS16, type Store, type StoreLockEntry } from '@vpe/media';

import type { TakeAcceptance } from '../acceptance/health.js';
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
   * Привязки токенов. **Вход, а не вычисление:** стадия `bind` — это `V-05`, и её интерфейс
   * `Binder` там же. Пустой список — законное значение, означающее «привязок ещё нет».
   */
  readonly bindings?: (chunk: PlannedChunk) => readonly TokenBinding[];
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
  readonly take: Take;
}

export interface RecordSpeechResult {
  readonly takes: readonly RecordedTake[];
  /** Новое значение `store.lock`; записать его на диск — дело вызывающего (ADR-0005 §9). */
  readonly lock: StoreLockValue;
  /** Сколько раз позван источник дубля. Ровно это число и есть «сколько оплачено». */
  readonly sourceCalls: number;
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
   */
  readonly edges: SpeechEdgeMeasurement;
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

  for (const chunk of input.plan.chunks) {
    const known = byVoiceKey.get(chunk.voiceKey);
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
      };
      byVoiceKey.set(chunk.voiceKey, recorded);
      drift.push({ leadInSamples: recorded.edges.leadInSamples, sampleRate: recorded.sampleRate });
      lock = upsertEntry(lock, lockEntry(sha, bytes.length, chunk.voice.providerId));
    } else {
      recorded = known;
    }

    const take: Take = {
      chunkKey: chunk.chunkKey,
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
      bindings: input.bindings?.(chunk) ?? [],
    };

    const takeFile = takeFilePath(chunk.chunkKey);
    await writeTakeFile(path.join(input.projectRoot, takeFile), take);
    takes.push({
      chunkKey: chunk.chunkKey,
      voiceKey: chunk.voiceKey,
      takeFile,
      sha256: recorded.sha256,
      synthesized,
      take,
    });
  }

  return { takes, lock, sourceCalls, edgeDrift: assessEdgeDrift(drift) };
}
