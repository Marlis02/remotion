// Публичная поверхность `@vpe/compile` (карта ADR-0009: Timeline, сегментация, RenderIR).
//
// `CP-03` — сегментация (`src/timeline/segments.ts`): сегмент как максимальный пробег подряд
// идущих сцен (ADR-0008), разрез только на чистой границе сцены, граница главы — разрез
// безусловно (**V4**, пересечение — ошибка **R6**), порог `minSegmentDurationFrames` обеим
// частям (**R7**), таблица кандидатов с причиной у каждого отклонённого.
//
// `CP-02` — субтитры (`src/timeline/captions.ts`): `CaptionGroup` из 1–3 слов одной строкой,
// потолок группы по числу символов, минимум длительности как порог записи в отчёт, подсветка
// слова атрибутом внутри группы.
//
// `CP-01` — `compose` → Timeline (`src/timeline/`): треки, речевые клипы по измеренным краям
// дубля, клипы `Silence` трёх видов (`author`/`gap`/`boundary-correction` — третий существует
// в типе `core-model` и экземпляров в `CP-01` не порождает), дефолтные gap'ы T8, разрешение
// якорей в сэмплы, укладка режиссуры и порождённых `[img:]`-записей, кандидаты на разрез (T6)
// и канонический дамп. Слой `render-ir/` пуст: он приезжает с `CP-04`.

export {
  CompileError,
  type CompileProblem,
  type CompileRule,
} from './timeline/errors.js';

export {
  type AnchorSpace,
  type AnchorTime,
  type AssetSha,
  type BoundaryKind,
  type CaptionGroup,
  type CaptionGroupToken,
  type CaptionReport,
  type CaptionShortGroup,
  type CaptionsProfileInput,
  type ClipFill,
  type CompileProfileInput,
  type CrossingClip,
  type CutCandidate,
  type CutReason,
  type CutRow,
  type CutTable,
  type PlacedClip,
  type PlacedSilence,
  type PlacedSpeech,
  type RejectReason,
  type Segment,
  type Timeline,
  type TimelineItem,
  type TimelineTrack,
} from './timeline/types.js';

export {
  assertSpeechSum,
  assertTotalPartition,
  speechTrack,
  type Area,
  type SpeechTrackInput,
  type SpeechTrackResult,
} from './timeline/speech-track.js';

export {
  anchorTimes,
  atLabel,
  resolvePoint,
  spaceOf,
  type AnchorTimes,
  type AnchorTimesInput,
  type PointResolution,
} from './timeline/anchors.js';

export { recordTracks, type RecordTracksInput } from './timeline/records.js';

export {
  assertTotalSegments,
  segments,
  CHAPTER_PARALLELISM,
  CROSSING_TRACKS,
  NON_CROSSING_TRACKS,
  type SegmentsInput,
  type SegmentsResult,
} from './timeline/segments.js';

export { captionGroups, type CaptionsInput, type CaptionsResult } from './timeline/captions.js';

export { compose, type ComposeInput } from './timeline/compose.js';

export { dumpTimeline } from './timeline/dump.js';

export { TAKES_DIR, readDirectionSources, readTakes } from './timeline/load.js';
