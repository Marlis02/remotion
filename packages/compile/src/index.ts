// Публичная поверхность `@vpe/compile` (карта ADR-0009: Timeline, сегментация, RenderIR).
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
  type CutCandidate,
  type PlacedClip,
  type PlacedSilence,
  type PlacedSpeech,
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
  resolvePoint,
  spaceOf,
  type AnchorTimes,
  type AnchorTimesInput,
  type PointResolution,
} from './timeline/anchors.js';

export { recordTracks, type RecordTracksInput } from './timeline/records.js';

export { captionGroups, type CaptionsInput, type CaptionsResult } from './timeline/captions.js';

export { compose, type ComposeInput } from './timeline/compose.js';

export { dumpTimeline } from './timeline/dump.js';

export { TAKES_DIR, readDirectionSources, readTakes } from './timeline/load.js';
