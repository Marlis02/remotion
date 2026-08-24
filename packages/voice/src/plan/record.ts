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
// СЕТИ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: источник дубля ВНЕДРЯЕТСЯ (тот же приём, что у лестницы
// `V-02`), поэтому весь путь исполним в тестовом контуре без ключа и без сети (**V9**).
// Гейт ADR-0006 §9 («промах ключа не зовёт сеть молча, сборка падает без `--allow-tts`») стоит
// у ВЫЗЫВАЮЩЕГО — он и решает, какой источник подставить; здесь его нет намеренно, иначе
// решение «ходить ли в сеть» оказалось бы в двух местах сразу.

import path from 'node:path';

import { asSamples, type Samples } from '@vpe/core-model';
import { bytesFromPcm, upsertEntry, type PcmS16, type Store, type StoreLockEntry } from '@vpe/media';

import type { TakeAcceptance } from '../acceptance/health.js';
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

/**
 * Границы речи в дорожке (ADR-0003 T7).
 *
 * ВХОД, А НЕ ВЫЧИСЛЕНИЕ, и это граница задачи: акустический детектор — `V-04`. Подставить
 * здесь нули значило бы записать в коммитимый артефакт измерение, которого не было
 * (`FACT` SP-2 U4.3: по таймкодам провайдера лид-ин тождественно нулевой при реальных
 * 95–100 мс, то есть ноль — ровно та ложь, которую `V-04` и приходит исправлять).
 */
export interface SpeechEdges {
  readonly leadInSamples: Samples;
  readonly tailSamples: Samples;
}

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
  readonly edges: SpeechEdges;
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
}

/** Байты, уже уложенные в этом прогоне: ключ — `voiceKey`, значение — всё, что от них зависит. */
interface Recorded {
  readonly sha256: string;
  readonly numSamples: number;
  readonly sampleRate: number;
  readonly health: TakeHealth;
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
      recorded = {
        sha256: sha,
        numSamples: accepted.attempt.numSamples,
        sampleRate: accepted.attempt.sampleRate,
        health: accepted.health,
      };
      byVoiceKey.set(chunk.voiceKey, recorded);
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
      leadInSamples: input.edges.leadInSamples,
      tailSamples: input.edges.tailSamples,
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

  return { takes, lock, sourceCalls };
}
