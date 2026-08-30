// **СТАДИИ СБОРКИ ДО РЕНДЕРА** — `parse → anchors → plan → voice → bind → compose → compileIr
// → compileAudio` (`core.md` §1, порядок дословно). Браузера здесь нет ни на одной строке:
// всё, что ниже, считается на числах и байтах, и потому проверяется юнит-тестом.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ни одного правила предметной области: чанки режет `@vpe/voice`, дубль
// приёмывает он же, клипы кладёт `compose`, кадры считает `compileIr`, тишину — `compileAudio`.
// Здесь порядок вызовов, подстановка входов и ДВА охранника, которые принадлежат команде:
// **K8** (промах `voice` без `--allow-tts`) и выбор источника дубля (**V9**: живого провайдера
// в v1 нет, `tts:mock@1` — единственный).
//
// ПОЧЕМУ ИСТОЧНИК ДУБЛЯ — ПОЛЕ, А НЕ ВЫБОР ПО `providerId`. Выбор реализации по строке
// запрещён (**V16**, ADR-0010 §7): он превращает провайдера в ветку внутри движка. Строка
// `project.yaml → voice.providerId` здесь только СВЕРЯЕТСЯ с тем, что подано; подстановку
// делает вызывающий (команда — мок, тест — свой источник).

import { createHash } from 'node:crypto';

import {
  compileAudio,
  compileIr,
  compose,
  readTakes,
  renderAudioTrack,
  audioTrackRef,
  withAudioTrack,
  type AudioPlan,
  type BuildIrResult,
  type Timeline,
} from '@vpe/compile';
import {
  EMPTY_LEDGER,
  expandImg,
  parseSource,
  readDirection,
  sourceText,
  syncLedger,
  type RandomBytes,
  type SourceDocument,
} from '@vpe/core-model';
import { LocalStore, asBlobSha, pcmFromBytes, readStoreLock, type PcmS16 } from '@vpe/media';
import type { AssemblyManifest } from '@vpe/core-model';
import type { TemplateRegistry } from '@vpe/templates-spec';
import {
  MOCK_PROFILE,
  assessEdgeDrift,
  capabilities,
  recordSpeechPlan,
  speechPlan,
  synthesize,
  takeFilePath,
  tokensOfPlan,
  type RecordSpeechResult,
  type SpeechPlan,
  type SpeechSource,
  type Take,
  type TtsCapabilities,
} from '@vpe/voice';

import { CliError, EXIT } from '../errors.js';

import type { LedgerEntry, ProjectInputs } from './inputs.js';

/** Вход половины сборки, считающейся без браузера. */
export interface PipelineInput {
  readonly project: ProjectInputs;
  /** Реестр СПЕКОВ шаблонов (с записями гейта) — вход `compose` и `assertBuildMayStart`. */
  readonly registry: TemplateRegistry;
  /**
   * `store.lock` проекта до укладки дублей. Тип берётся у ЧИТАТЕЛЯ файла, а не объявляется
   * заново: второе объявление той же формы разошлось бы со схемой в первую же её правку.
   */
  readonly lock: ReturnType<typeof readStoreLock>;
  /** Момент сборки, ПОДАННЫЙ СНАРУЖИ (**D9**): провенанс дубля обязан его записать. */
  readonly now: string;
  /** Источник байтов минта `w:` — **D4** и `C-04`: случайность приезжает параметром. */
  readonly randomBytes: RandomBytes;
  /** Разрешён ли промах `voice` (**K8**). Без него промах — падение, а не поход к провайдеру. */
  readonly allowTts: boolean;
  /**
   * Источник дубля. Умолчание команды — `tts:mock@1` (**V9**); тест подставляет свой.
   *
   * `undefined` вместе с `allowTts: false` — законная пара: источник тогда не зовётся ни разу.
   */
  readonly speech?: SpeechSource;
  /**
   * Возможности внедрённого источника (ADR-0010 §8). Умолчание — возможности `tts:mock@1`.
   *
   * Подаются РЯДОМ с источником, потому что `SpeechSource` — функция и своих возможностей не
   * несёт; спрашивать их у имени провайдера правило запрещает.
   */
  readonly capabilities?: TtsCapabilities;
}

/** Что посчитала половина до рендера. Всё — значения; на диск их кладёт `persist`. */
export interface PipelineResult {
  readonly document: SourceDocument;
  readonly ledgerRecords: readonly LedgerEntry[];
  /** Канонический текст ledger'а после синхронизации — его и кладёт команда на диск (**A8**). */
  readonly ledgerText: string;
  readonly plan: SpeechPlan;
  readonly recorded: RecordSpeechResult;
  readonly takes: ReadonlyMap<string, Take>;
  readonly timeline: Timeline;
  readonly ir: BuildIrResult;
  readonly audio: AudioPlan;
  readonly track: PcmS16;
  /** Манифест сборки С ДОРОЖКОЙ (`withAudioTrack`) — тот, что уезжает в отчёт. */
  readonly manifest: AssemblyManifest;
}

/**
 * **Источник дубля `tts:mock@1`** — единственный провайдер v1 (**V9**, ADR-0010 §7).
 *
 * Один вызов `synthesize`, а не пара `synthesize` + `synthPcm`: обе величины отдаёт он сам, и
 * второй вызов был бы вторым вычислением того же — то есть местом, где они могут разойтись.
 */
export function mockSpeechSource(seed: number): SpeechSource {
  return (request) => {
    const result = synthesize({ text: request.spokenText, seed, profile: MOCK_PROFILE });
    return { alignment: result.alignment, pcm: result.__mock.pcm };
  };
}

/**
 * **K8** — промах `voice` без `--allow-tts` есть ПАДЕНИЕ С ИНСТРУКЦИЕЙ, а не поход в сеть.
 *
 * Охранник двойной, и это не перестраховка. (1) Здесь — ПРОВЕРКА СПИСКОМ: автор узнаёт про
 * все недостающие дубли сразу, а не про первый; (2) в `guardedSource` — ПОВЕДЕНИЕ ФУНКЦИИ:
 * источник, позванный без разрешения, бросает. Первое — удобство отчёта, второе — правило:
 * «сеть не зовётся» обязано держаться на том, что звать нечем, а не на том, что мы посчитали
 * заранее и не ошиблись.
 */
function assertTakesPresent(input: PipelineInput, plan: SpeechPlan, present: ReadonlyMap<string, Take>): void {
  const missing = plan.chunks.filter((chunk) => !present.has(chunk.chunkKey));
  if (missing.length === 0 || input.allowTts) return;

  const list = missing
    .slice(0, 10)
    .map((chunk) => `  • ${chunk.chunkKey} — ${takeFilePath(chunk.chunkKey)}`)
    .join('\n');
  throw new CliError(
    'K8',
    `дублей нет у ${String(missing.length)} чанк(ов) из ${String(plan.chunks.length)}, ` +
      'а `--allow-tts` не задан — синтез НЕ запускался:\n' +
      list +
      (missing.length > 10 ? `\n  … и ещё ${String(missing.length - 10)}` : '') +
      '\nСинтез стоит денег и недетерминирован (ADR-0010): решение «платить» принимает автор, ' +
      'а не сборка. Повторите с `--allow-tts` — либо принесите уже оплаченные дубли ' +
      '(`vpe store fetch`, `L-02`)',
  );
}

/** Источник, который без разрешения не работает: правило держится ПОВЕДЕНИЕМ (см. выше). */
function guardedSource(input: PipelineInput): SpeechSource {
  const inner = input.speech ?? mockSpeechSource(input.project.project.voice.seed);
  return (request) => {
    if (!input.allowTts) {
      throw new CliError(
        'K8',
        'источник дубля позван без `--allow-tts`. Это не должно было случиться: промах ' +
          'перечисляется до синтеза — значит разошлись перечень промахов и укладка',
      );
    }
    return inner(request);
  };
}

/**
 * Считает всё, что можно посчитать без браузера.
 *
 * @throws {CliError} `K8` — промах `voice` без разрешения; `build вход` — чужой провайдер.
 * @throws ошибки стадий как есть: правило называет тот пакет, которому оно принадлежит.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { project } = input;
  const profile = project.compileProfile;
  const caps = input.capabilities ?? capabilities;

  // ═══ ВОПРОС К ВОЗМОЖНОСТИ, А НЕ К ИМЕНИ (ADR-0010 §8, **V-01**/**V16**) ═══
  // Сравнить `voice.providerId` проекта с именем внедрённой реализации было бы ветвлением по
  // ИМЕНИ провайдера — ровно то, что запрещает правило и ловит линт (`no-restricted-syntax`).
  // Спрашивается СВОЙСТВО: нужна ли реализации сеть. Сборка идёт под сетевой изоляцией
  // (**R1**) и в v1 зовёт только `tts:mock@1` (**V9**), поэтому провайдер, которому сеть
  // нужна, обязан быть отвергнут ДО первой оплаты, а не упасть внутри изоляции.
  //
  // ЧЕГО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ, И ЭТО НАЗВАНО ВСЛУХ: она не сверяет внедрённую реализацию с
  // тем, что объявил проект. Реестра реализаций в v1 нет (живой провайдер — `V-06`), а сверка
  // по строке запрещена; значит проект, назвавший живого провайдера, соберётся моком, и
  // провенанс дубля запишет имя из проекта. Долг заведён `L-01`.
  if (caps.requiresNetwork) {
    throw new CliError(
      'build вход',
      'внедрённый источник дубля требует СЕТИ (`capabilities.requiresNetwork`), а сборка v1 ' +
        'идёт под сетевой изоляцией и работает только с провайдером, которому сеть не нужна ' +
        '(**V9**, **R1**). Живой провайдер — задача `V-06`',
      EXIT.input,
    );
  }

  // ── 1. parse ────────────────────────────────────────────────────────────────
  const document = parseSource(project.source.text, {
    file: project.source.file,
    sampleRate: profile.projectSampleRate,
  });

  // ── 2. anchors: ledger проекта + минт нового (**A8**: только добавление) ────
  const sync = syncLedger(document, project.ledger.length === 0 ? EMPTY_LEDGER : project.ledger, {
    random: input.randomBytes,
  });

  // ── 3. plan ─────────────────────────────────────────────────────────────────
  const plan = speechPlan({
    document,
    source: sourceText(project.source.file, project.source.text),
    maxChunkChars: project.audioProfile.maxChunkChars,
    voice: project.project.voice,
  });
  const tokens = tokensOfPlan({
    plan,
    document,
    maxChunkChars: project.audioProfile.maxChunkChars,
    anchors: sync.bindings,
  });

  // ── 4. voice: K8 до единого вызова источника ───────────────────────────────
  const existing = readTakes(project.layout.takesRoot, plan);
  assertTakesPresent(input, plan, existing);

  // ═══ СТАДИЯ `voice` НЕ ЗАПУСКАЕТСЯ, ЕСЛИ ЗАПУСКАТЬ ЕЁ НЕ НА ЧЕМ ═══
  // ИЗМЕРЕНО (`L-01`): `recordSpeechPlan` спрашивает индекс ПРОГОНА и межсборочный кэш
  // (`M-05`), но НЕ читает take-файлы с диска, — то есть вторая сборка того же проекта без
  // кэша заплатила бы за уже оплаченное. Кэш стадии `voice` эта задача не подключает (он
  // остаётся долгом), поэтому здесь стоит честный вопрос: промахов нет — стадии нет.
  //
  // ЧЕГО ЭТО НЕ ЛЕЧИТ, И ЭТО НАЗВАНО: при ЧАСТИЧНОМ промахе (один чанк из десяти) стадия
  // зовётся на ВЕСЬ план и переплачивает за девять. На `tts:mock@1` это бесплатно, на живом
  // провайдере — деньги; закрывается это кэшем `M-05`, а не веткой здесь.
  const missing = plan.chunks.filter((chunk) => !existing.has(chunk.chunkKey));
  const recorded: RecordSpeechResult =
    missing.length === 0
      ? {
          takes: [],
          lock: input.lock,
          sourceCalls: 0,
          cacheHits: 0,
          // Серия пуста — дрейф краёв мерить не на чем, и это ЗНАЧЕНИЕ, а не заглушка:
          // `assessEdgeDrift([])` возвращает отчёт, у которого `measured = 0`.
          edgeDrift: assessEdgeDrift([]),
        }
      : await recordSpeechPlan({
          plan,
          acceptance: project.audioProfile.takeAcceptance,
          source: guardedSource(input),
          store: new LocalStore(project.layout.storeDir),
          lock: input.lock,
          projectRoot: project.layout.takesRoot,
          speechEdges: project.audioProfile.speechEdges,
          provenance: {
            // `none` — у мока нет тарифицируемого голоса: писать сюда выдуманный класс
            // значило бы записать в коммитимый артефакт то, чего не было (ADR-0010 §2).
            voiceCategory: 'none',
            planTierAtGeneration: 'none',
            // ЧАСЫ — ВХОД (**D9**): дата генерации дубля есть свойство прогона, и сборка её
            // ЗНАЕТ, а не читает.
            generatedAt: input.now,
          },
          tokens: (chunk) => tokens.get(chunk.chunkKey) ?? [],
        });

  // ── 5. bind уже сделан укладкой; дубли читаются с диска тем же читателем, что и компилятор ──
  const takes = readTakes(project.layout.takesRoot, plan);

  // ── 6. compose ──────────────────────────────────────────────────────────────
  const timeline = compose({
    document,
    anchors: sync.bindings,
    plan,
    takes,
    records: readDirection(
      project.direction.map((item) => ({ filePath: item.filePath, text: item.text })),
      { ledger: sync.records, document },
    ),
    generated: expandImg(document),
    catalog: project.catalog,
    registry: input.registry,
    profile,
  });

  // ── 7a. compileIr ───────────────────────────────────────────────────────────
  const ir = compileIr({ timeline, profile, seedRoot: project.project.seedRoot });

  // ── 7b. compileAudio + дорожка ──────────────────────────────────────────────
  const audio = compileAudio({
    timeline,
    manifest: ir.manifest,
    profile: {
      projectSampleRate: profile.projectSampleRate,
      fps: profile.fps,
      maxDurationFrames: project.maxDurationFrames,
    },
  });

  const store = new LocalStore(project.layout.storeDir);
  const pcm = new Map<string, PcmS16>();
  for (const take of takes.values()) {
    if (take.pcm.sha256 === null) continue;
    pcm.set(take.pcm.sha256, pcmFromBytes(take.pcm.sampleRate, await store.read(asBlobSha(take.pcm.sha256))));
  }
  const track = renderAudioTrack(audio, pcm);

  return {
    document,
    ledgerRecords: sync.records,
    ledgerText: sync.text,
    plan,
    recorded,
    takes,
    timeline,
    ir,
    audio,
    track,
    manifest: withAudioTrack(ir.manifest, audioTrackRef(track)),
  };
}

/** sha256 текста — тот же адрес, каким считает входы `inputs.ts`. */
export const textSha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
