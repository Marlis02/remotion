// `compose(input) → Timeline` (`CP-01`, roadmap §4.7) — ЧИСТАЯ ФУНКЦИЯ СВОИХ ВХОДОВ.
//
// НИ ОДНОГО ОБРАЩЕНИЯ К МИРУ. Ни `fs`, ни сети, ни часов, ни `random`, ни `crypto` — всё
// приходит значениями (**M3**-по-духу, ADR-0007 §4). Чтение диска живёт отдельно (`load.ts`,
// поправка владельца П4), и это не стилистика: `compose` — то, чем доказывается «перестановка
// файлов в каталоге не меняет Timeline», а функция, которая сама ходит в каталог, доказывала
// бы это про свой собственный обход.
//
// ПОРЯДОК СТАДИЙ СУЩЕСТВЕНЕН И ОБЪЯСНИМ:
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
import type { SpeechPlan, Take } from '@vpe/voice';

import { anchorTimes } from './anchors.js';
import { captionGroups } from './captions.js';
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
  /** Каталог ассетов (`buildAssetCatalog`, `M-02`) — для alias'а `[img:]`. */
  readonly catalog: AssetCatalog;
  readonly profile: CompileProfileInput;
}

/**
 * Строит Timeline: треки, клипы, три вида `Silence`, кандидаты на разрез, якоря во времени,
 * сегменты и таблицу разрезов.
 *
 * @throws {CompileError} со СПИСКОМ — нет дубля, весь-тихий дубль, `absent` под ссылкой,
 *   неизвестный alias, нулевая авторская пауза на структурной границе, разбиение не тотально,
 *   `absent` под произносимым словом субтитра (`CP-02`), клип поперёк границы главы
 *   (**R6**, `CP-03`).
 */
export function compose(input: ComposeInput): Timeline {
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
    catalog: input.catalog,
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
