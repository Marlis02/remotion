// **СТАДИИ СБОРКИ ДО РЕНДЕРА** — `parse → anchors → plan → voice → bind → compose → compileIr
// → compileAudio` (`core.md` §1, порядок дословно). Браузера здесь нет ни на одной строке:
// всё, что ниже, считается на числах и байтах, и потому проверяется юнит-тестом.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ни одного правила предметной области: чанки режет `@vpe/voice`, дубль
// приёмывает он же, клипы кладёт `compose`, кадры считает `compileIr`, тишину — `compileAudio`.
// Здесь порядок вызовов, подстановка входов и ДВА охранника, которые принадлежат команде:
// **K8** (промах `voice` без `--allow-tts`) и выбор источника дубля.
//
// ═══ ПРОВАЙДЕР ВЫБИРАЕТСЯ ПО ИМЕНИ, НАЗВАННОМУ ПРОЕКТОМ (`V-06`, долг №197) ═══
// До этой задачи команда ВНЕДРЯЛА `tts:mock@1` и не сверяла его с `project.yaml →
// voice.providerId`: проект, назвавший живого провайдера, собирался моком, а провенанс дубля и
// `voiceKey` записывали имя ИЗ ПРОЕКТА — то есть в коммитимый артефакт уезжало утверждение о
// провайдере, который не работал. Теперь имя разрешается РЕЕСТРОМ реализаций
// (`providerFor`, `@vpe/voice`), и это не то ветвление, которое запрещает ADR-0010 §8: §8
// запрещает спрашивать у имени ПОВЕДЕНИЕ («умеет ли он X»), а здесь спрашивается
// ИДЕНТИЧНОСТЬ («какая из реализаций названа»). Ни одной ветки поведения по имени тут нет —
// дальше работают capabilities; литерала имени провайдера нет ни в одном файле `cli`.
//
// ИСТОЧНИК ДУБЛЯ ОСТАЁТСЯ ПОЛЕМ — но уже не потому, что реестра нет, а ради теста: подделка
// источника даёт больной ответ, которого живой провайдер по заказу не даст (**V2**).

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
  assessEdgeDrift,
  providerCapabilities,
  providerFor,
  providerSpeechSource,
  recordSpeechPlan,
  speechPlan,
  takeFilePath,
  tokensOfPlan,
  type AccountSnapshot,
  type ProviderRuntime,
  type RecordSpeechResult,
  type SpeechPlan,
  type SpeechSource,
  type Take,
  type TakeProvenance,
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
   * Источник дубля. Умолчание — реализация, названная проектом (`V-06`); тест подставляет свою.
   *
   * `undefined` вместе с `allowTts: false` — законная пара: источник тогда не зовётся ни разу.
   */
  readonly speech?: SpeechSource;
  /**
   * Возможности внедрённого источника (ADR-0010 §8). Умолчание — возможности провайдера,
   * названного проектом.
   *
   * Подаются РЯДОМ с источником, потому что `SpeechSource` — функция и своих возможностей не
   * несёт; спрашивать их у имени провайдера правило запрещает.
   */
  readonly capabilities?: TtsCapabilities;
  /**
   * Что реализация может попросить у процесса: ключ и сеть (`V-06`).
   *
   * ПУСТОЙ ОБЪЕКТ — ЗАКОННОЕ И ОБЫЧНОЕ ЗНАЧЕНИЕ: герметичному провайдеру не нужно ни того, ни
   * другого, и весь тестовый контур живёт именно так (**V9**). Транспорт подаёт граница
   * процесса (`bin/vpe.ts`) и только при `ELEVENLABS_LIVE=1`, поэтому «живой вызов без флага»
   * — не забытая проверка, а невыразимое состояние: звать нечем.
   */
  readonly runtime?: ProviderRuntime;
  /**
   * Имя переменной окружения → её значение (`voice.voiceId` держит ИМЯ, а не значение).
   *
   * ВХОД, а не `process.env`: окружение читает граница процесса — тем же приёмом, что часы
   * (**D9**) и случайность (**D4**). Умолчание — «переменных нет»: герметичный провайдер их и
   * не спрашивает.
   */
  readonly secrets?: (envName: string) => string | undefined;
  /**
   * Снимок аккаунта провайдера: тариф, класс голоса и ставка (`V-06`, ADR-0010 §2).
   *
   * ФУНКЦИЯ, А НЕ ЗНАЧЕНИЕ, и это не стиль: снимок стоит двух сетевых вызовов (бесплатных, но
   * сетевых), а нужен он ровно тогда, когда что-то ДЕЙСТВИТЕЛЬНО синтезируется. Сборка с
   * полным набором оплаченных дублей не обязана уметь ходить в сеть.
   *
   * `undefined` при сетевом провайдере — ОТКАЗ, а не умолчание: провенанс без класса голоса и
   * тарифа («как сделано») — не пустое место, а ложь в коммитимом артефакте (`FACT` r3 §3.2:
   * тариф на дату генерации ретроспективно не восстановить).
   */
  readonly account?: () => Promise<AccountSnapshot>;
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
  /**
   * Дубли, которые лежали на диске, но описывают ДРУГОЕ содержимое (`voiceKey` не тот).
   *
   * Печатается отчётом сборки, а не проглатывается: «почему пересобралась глава 3» — вопрос
   * о том, чего именно не хватило (ADR-0006 §12), и «дубль был, но он от другого голоса» —
   * самый дорогой из ответов.
   */
  readonly staleTakes: readonly string[];
  /**
   * Чанки, дубль которых УЖЕ ЛЕЖАЛ на диске к началу стадии `voice`, — то есть за что эта
   * сборка не платила (`F-01`).
   *
   * ЗАЧЕМ ОТДЕЛЬНОЕ ПОЛЕ, ЕСЛИ ЕСТЬ `recorded.cacheHits`. Это РАЗНЫЕ числа, и разница
   * найдена владельцем на первой живой сборке `examples/ai-test-1`: `cacheHits` считает
   * попадания МЕЖСБОРОЧНОГО кэша (`M-05`), которого сборка пока не подключает вовсе, а
   * `sourceCalls` — обращения к провайдеру. Сборка, взявшая все четыре дубля из
   * `voice/takes/`, печатала поэтому «обращений 0, попаданий кэша 0» — то есть отчёт, из
   * которого нельзя понять, случилось ли хоть что-нибудь. Попадание в take-файлы — третий
   * случай, и до этого поля его не считал никто.
   */
  readonly reusedTakes: readonly string[];
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
function assertTakesPresent(
  input: PipelineInput,
  plan: SpeechPlan,
  present: ReadonlyMap<string, Take>,
  stale: ReadonlySet<string>,
): void {
  const missing = plan.chunks.filter((chunk) => !present.has(chunk.chunkKey));
  if (missing.length === 0 || input.allowTts) return;

  const list = missing
    .slice(0, 10)
    .map(
      (chunk) =>
        `  • ${chunk.chunkKey} — ${takeFilePath(chunk.chunkKey)}` +
        (stale.has(chunk.chunkKey) ? ' (файл ЕСТЬ, но он от другого содержимого: `voiceKey` не тот)' : ''),
    )
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

/**
 * Источник, который без разрешения не работает: правило держится ПОВЕДЕНИЕМ (см. выше).
 *
 * ПРОВАЙДЕР СОЗДАЁТСЯ ЛЕНИВО, И ЭТО НЕ ОПТИМИЗАЦИЯ. Проект с живым провайдером и полным
 * набором оплаченных дублей обязан собираться БЕЗ ключа и без сети: платить не за что, а
 * значит и спрашивать нечего. Создай мы провайдера заранее — сборка отказывалась бы стартовать
 * там, где ей нечего делать, и «ключ нужен» стало бы условием чтения, а не условием оплаты.
 */
function guardedSource(input: PipelineInput): SpeechSource {
  let inner = input.speech;
  return (request) => {
    if (!input.allowTts) {
      throw new CliError(
        'K8',
        'источник дубля позван без `--allow-tts`. Это не должно было случиться: промах ' +
          'перечисляется до синтеза — значит разошлись перечень промахов и укладка',
      );
    }
    inner ??= providerSpeechSource({
      provider: providerFor(input.project.project.voice.providerId, input.runtime ?? {}),
      sampleRate: input.project.compileProfile.projectSampleRate,
      secrets: input.secrets ?? ((): undefined => undefined),
    });
    return inner(request);
  };
}

/**
 * Провенанс прогона: класс голоса, тариф и ставка (`V-06`, ADR-0010 §2).
 *
 * ВЕТВЛЕНИЕ ПО ВОЗМОЖНОСТИ, А НЕ ПО ИМЕНИ: снимок обязателен ровно тому провайдеру, которому
 * нужна сеть, — у остальных его негде взять и нечего в нём хранить.
 *
 * @throws {CliError} сетевой провайдер без снимка аккаунта.
 */
async function provenanceOf(
  input: PipelineInput,
  caps: TtsCapabilities,
): Promise<{ voiceCategory: TakeProvenance['voiceCategory']; planTierAtGeneration: string; planRateAtGeneration: number | null }> {
  if (input.account === undefined) {
    if (caps.requiresNetwork) {
      throw new CliError(
        'build вход',
        'сетевому провайдеру нужен снимок аккаунта (тариф и класс голоса), а его не подали. ' +
          'Провенанс дубля обязан записать, ЧЕМ он сделан: `FACT` (r3 §3.2) коммерческие ' +
          'права на аудио даёт только платный план, и тариф на дату генерации ретроспективно ' +
          'не восстановить, а `FACT` (SP-2) класс голоса определяет его доступность на тарифе',
        EXIT.input,
      );
    }
    // Герметичный провайдер: голоса нет вовсе (`none` — значение перечня, а не пустое место),
    // тарифа нет, ставка не объявлена (`null` ≠ `0`: «дубль бесплатен» — утверждение о
    // деньгах, которого никто не делал).
    return { voiceCategory: 'none', planTierAtGeneration: 'none', planRateAtGeneration: null };
  }
  const snapshot = await input.account();
  return {
    voiceCategory: snapshot.voiceCategory,
    planTierAtGeneration: snapshot.planTier,
    planRateAtGeneration: snapshot.ratePerCodePoint,
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
  // Возможности спрашиваются у ИМЕНИ, названного проектом, а не у внедрённой реализации:
  // до этой задачи их подавали рядом с источником, потому что реестра не было (долг №197).
  const caps = input.capabilities ?? providerCapabilities(project.project.voice.providerId);

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
  const onDisk = readTakes(project.layout.takesRoot, plan);
  // ═══ ДУБЛЬ С ЧУЖИМ `voiceKey` — ЭТО ПРОМАХ, А НЕ ПОПАДАНИЕ (`V-06`, вторая половина
  // долга №197) ═══
  // Имя take-файла — `chunkKey`, то есть ИДЕНТИЧНОСТЬ МЕСТА (ADR-0010 §3a); содержимое дубля
  // описывает `voiceKey` — провайдер, модель, голос, seed, `providerOpts`, `roleDigest` и
  // текст. Смена `voice.providerId` в `project.yaml` не меняет ни одного имени файла, поэтому
  // без этой проверки проект, переведённый на живого провайдера, СОБРАЛСЯ БЫ НА СТАРЫХ ДУБЛЯХ
  // мока — молча, с готовым `final.mp4` и с провенансом, утверждающим про мок. Ровно то, ради
  // чего заведён долг №197, только с другой стороны: там имя провайдера уезжало в артефакт без
  // работы, здесь работа осталась бы чужой.
  //
  // Расхождение — ПРОМАХ, а не отказ: промах перечисляет **K8**, и решение «платить» остаётся
  // за автором. `voiceKey: null` считается расхождением по тому же правилу (`M-05`): дубль,
  // собранный не укладкой плана, пересчитать из содержимого нечем.
  const stale = new Set(
    plan.chunks
      .filter((chunk) => {
        const take = onDisk.get(chunk.chunkKey);
        return take !== undefined && take.voiceKey !== chunk.voiceKey;
      })
      .map((chunk) => chunk.chunkKey),
  );
  const existing = new Map([...onDisk].filter(([chunkKey]) => !stale.has(chunkKey)));
  assertTakesPresent(input, plan, existing, stale);

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

  // ═══ ВОПРОС К ВОЗМОЖНОСТИ, А НЕ К ИМЕНИ (ADR-0010 §8, **V16**) ═══
  // Спрашивается СВОЙСТВО: нужна ли реализации сеть, — и спрашивается ровно там, где ответ
  // меняет исход: при непустом промахе. Провайдер, которому сеть нужна, а транспорта нет,
  // обязан быть отвергнут ДО первой оплаты и С ИНСТРУКЦИЕЙ, а не упасть где-то внутри
  // укладки (нарушение Н4 протокола `V-06`: `fetch` к API без флага обязан быть красным).
  //
  // ЧЕГО ЭТА ПРОВЕРКА БОЛЬШЕ НЕ ДЕЛАЕТ: она не отвергает живого провайдера как такового.
  // До `V-06` живой провайдер отвергался ВСЕГДА (**V9**: в v1-контуре его не было вовсе), и
  // это же место было адресом долга №197.
  if (missing.length > 0 && caps.requiresNetwork && (input.runtime?.transport === undefined)) {
    throw new CliError(
      'build вход',
      `провайдеру \`${project.project.voice.providerId}\` нужна СЕТЬ ` +
        '(`capabilities.requiresNetwork`), а транспорта нет: он подаётся границей процесса и ' +
        'только при `ELEVENLABS_LIVE=1`. Промах дублей: ' +
        `${String(missing.length)} из ${String(plan.chunks.length)}. Живой синтез стоит денег ` +
        '— флаг ставится руками, а не по умолчанию: повторите с ' +
        '`ELEVENLABS_LIVE=1 vpe build … --allow-tts` либо принесите уже оплаченные дубли ' +
        '(`vpe store fetch`)',
      EXIT.input,
    );
  }

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
          // «Как сделано» — из СНИМКА АККАУНТА, а не из констант (`V-06`). У герметичного
          // провайдера снимка нет и быть не может, и тогда здесь стоят честные `none`/`null`:
          // голоса у него нет вовсе, тарифа тоже, а ставка не объявлена (ADR-0010 §2).
          provenance: {
            ...(await provenanceOf(input, caps)),
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
    staleTakes: [...stale].sort(),
    reusedTakes: [...existing.keys()].sort(),
  };
}

/** sha256 текста — тот же адрес, каким считает входы `inputs.ts`. */
export const textSha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
