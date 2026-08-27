// `compose(input) → Timeline` (`CP-01`, roadmap §4.7) — ЧИСТАЯ ФУНКЦИЯ СВОИХ ВХОДОВ.
//
// НИ ОДНОГО ОБРАЩЕНИЯ К МИРУ. Ни `fs`, ни сети, ни часов, ни `random`, ни `crypto` — всё
// приходит значениями (**M3**-по-духу, ADR-0007 §4). Чтение диска живёт отдельно (`load.ts`,
// поправка владельца П4), и это не стилистика: `compose` — то, чем доказывается «перестановка
// файлов в каталоге не меняет Timeline», а функция, которая сама ходит в каталог, доказывала
// бы это про свой собственный обход.
//
// ПОРЯДОК СТАДИЙ СУЩЕСТВЕНЕН И ОБЪЯСНИМ:
//   0. контракт вызовов шаблонов (`CP-07`) — ПЕРВЫМ ШАГОМ, до всякого времени. Он ничего не
//      знает о сэмплах и знать не должен: его вопрос — «объявлен ли этот вызов и что он
//      просит». Первым он стоит по двум причинам. Во-первых, отказ обязан быть ОДНИМ списком
//      на все записи (решение владельца `CP-07`, вопрос 1), а не падением на первой; во-вторых,
//      объявленная длительность (`declareDuration`) нужна укладке на шаге 3, то есть контракт
//      обязан быть готов раньше. Ошибка версии реестра (**K6**) — раньше даже этого списка.
//   1. дорожка речи — она задаёт `L`, области сцен и глав и все абсолютные позиции;
//   2. якоря — им нужны и клипы речи (для `w:`), и области (для `sc:`/`ch:`);
//   3. режиссура — ей нужны разрешённые якоря;
//   4. субтитры (`CP-02`) — им нужны и якоря (время токенов), и клипы речи (границы групп);
//   5. сегментация (`CP-03`) — ей нужны УЛОЖЕННЫЕ клипы режиссуры: «пересекает ли что-нибудь
//      границу» есть вопрос об абсолютных интервалах, а они появляются на шаге 3. Группы
//      субтитров нужны ей же, но только под ассерт.
// Обратный порядок невозможен ни в одной паре: время рождается снизу вверх.

import { TRACK_KINDS, type AnchorBinding, type GeneratedDirectionRecord, type PlacedRecord, type SourceDocument } from '@vpe/core-model';
import type { AssetCatalog } from '@vpe/media';
import type { TemplateRegistry } from '@vpe/templates-spec';
import type { SpeechPlan, Take } from '@vpe/voice';

import { anchorTimes } from './anchors.js';
import { captionGroups } from './captions.js';
import { templateContracts } from './contract.js';
import { recordTracks } from './records.js';
import { segments } from './segments.js';
import { speechTrack } from './speech-track.js';
import type { CompileProfileInput, Timeline, TimelineTrack } from './types.js';

/** Вход компиляции Timeline. Всё — значения; читатель диска подаёт их снаружи (`load.ts`). */
export interface ComposeInput {
  /** Разобранный исходник (`parseSource`, `C-02`). */
  readonly document: SourceDocument;
  /**
   * `SyncResult.bindings` (`syncLedger`, `C-04`) — кто какой якорь получил.
   *
   * ЖИВОЙ LEDGER ПРИХОДИТ ИМЕННО В ЭТОЙ ФОРМЕ, а не списком записей `anchors.lock.jsonl`, и
   * это не подмена входа. Компилятору нужна СВЯЗКА «позиция в прозе ↔ id»; из ledger'а она
   * получается соединением `liveAnchors` с `anchorSlots` по `(sceneId, ordinal)` — то есть
   * второй копией того соединения, которое уже написано в `C-04` и которым пользуется `voice`
   * (`tokensOfPlan`). Второй реализации одного соединения в репозитории быть не должно.
   */
  readonly anchors: readonly AnchorBinding[];
  /** План речи (`speechPlan`, `V-03`) — он задаёт порядок чанков. */
  readonly plan: SpeechPlan;
  /** `chunkKey` → дубль, прочитанный строгим читателем (`parseTakeFile`). */
  readonly takes: ReadonlyMap<string, Take>;
  /** Записи режиссуры с разрешённым scope (`readDirection`, `C-05`). */
  readonly records: readonly PlacedRecord[];
  /** Порождённые `[img:]`-записи (`expandImg`, `C-04`). */
  readonly generated: readonly GeneratedDirectionRecord[];
  /**
   * Каталог ассетов (`buildAssetCatalog`, `M-02`) — alias'ы объявленных ассетов и записи
   * шрифтов (`kind: 'font'`, ADR-0005 §1: один реестр по sha256 на два каталога).
   */
  readonly catalog: AssetCatalog;
  /**
   * Реестр шаблонов (`createRegistry`, `TS-01`) — **ВХОД СТАДИИ, А НЕ ГЛОБАЛ** (`CP-07`).
   *
   * Импорта «реестра по умолчанию» внутри `compile/src/**` нет ни одного, и это не стиль:
   * реестр, взятый стадией молча, невозможно сверить с `templateRegistryVersion` профиля —
   * сверять было бы не с чем, и строка **K6** осталась бы именем без содержимого. Реестр
   * подаёт CLI (`L-01`), тесты строят свой (`createRegistry(FIXTURE_TEMPLATES)` либо реестр с
   * синтетическим спеком).
   */
  readonly registry: TemplateRegistry;
  readonly profile: CompileProfileInput;
}

/**
 * Строит Timeline: треки, клипы, три вида `Silence`, кандидаты на разрез, якоря во времени,
 * сегменты и таблицу разрезов.
 *
 * @throws {CompileError} со СПИСКОМ — вызов шаблона не проходит контракт (`CP-07`: реестр,
 *   схема `params`, alias без записи, шрифт роли, `until` при объявленной длительности),
 *   нет дубля, весь-тихий дубль, `absent` под ссылкой,
 *   нулевая авторская пауза на структурной границе, разбиение не тотально,
 *   `absent` под произносимым словом субтитра (`CP-02`), клип поперёк границы главы
 *   (**R6**, `CP-03`).
 */
export function compose(input: ComposeInput): Timeline {
  const contracts = templateContracts({
    records: input.records,
    generated: input.generated,
    catalog: input.catalog,
    registry: input.registry,
    templateRegistryVersion: input.profile.templateRegistryVersion,
  });

  const track = speechTrack({
    document: input.document,
    plan: input.plan,
    takes: input.takes,
    profile: input.profile,
  });

  const times = anchorTimes({
    document: input.document,
    anchors: input.anchors,
    plan: input.plan,
    takes: input.takes,
    track,
  });

  const byTrack = recordTracks({
    records: input.records,
    generated: input.generated,
    contracts,
    times,
    track,
  });

  const captions = captionGroups({
    document: input.document,
    anchors: input.anchors,
    times,
    track,
    profile: input.profile,
  });

  const cut = segments({
    track,
    byTrack,
    captionGroups: captions.groups,
    profile: input.profile,
  });

  const tracks: TimelineTrack[] = TRACK_KINDS.map((kind) => {
    if (kind === 'speech') return { kind, items: track.items };
    // `voice` — директивная дорожка: клипов на ней не бывает, и `recordTracks` их туда не
    // кладёт (записи `track: voice` пропускаются там же, где объявлено почему).
    return { kind, items: byTrack.get(kind) ?? [] };
  });

  return {
    projectSampleRate: input.profile.projectSampleRate,
    durationSamples: track.durationSamples,
    tracks,
    cutCandidates: track.cutCandidates,
    segments: cut.segments,
    cutTable: cut.table,
    anchors: times.list,
    captionGroups: captions.groups,
    captionReport: captions.report,
  };
}
