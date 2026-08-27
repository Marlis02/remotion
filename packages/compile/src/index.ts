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
// `CP-04` — RenderIR (`src/render-ir/` + стадия `src/compile-ir.ts`): квантование T3
// segment-relative, `d_i`/`A_i`/`δ_i` по T6, материализованные seed'ы, `segmentIrHash`.
// Стадия лежит ВНЕ обеих зон намеренно: она читает Timeline и пишет IR, а **M5** запрещает
// зонам видеть друг друга.
//
// `CP-05` — звук (`src/audio/`): `compileAudio` → `AudioPlan` → одна НЕПРЕРЫВНАЯ дорожка
// (речь окном T7 + тишины трёх видов + добивка T5), `AudioTrackRef` в манифест. Третья зона
// пакета: `audio ↛ render-ir` и обратно (решение владельца 6, 2026-08-27) — аудио не знает
// кадров, а манифест лежит в `core-model`, где его видят обе стороны.
//
// `CP-01` — `compose` → Timeline (`src/timeline/`): треки, речевые клипы по измеренным краям
// дубля, клипы `Silence` трёх видов (`author`/`gap`/`boundary-correction` — третий существует
// в типе `core-model` и экземпляров в `CP-01` не порождает), дефолтные gap'ы T8, разрешение
// якорей в сэмплы, укладка режиссуры и порождённых `[img:]`-записей, кандидаты на разрез (T6)
// и канонический дамп.

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

export {
  assemblyManifest,
  buildIr,
  dumpIr,
  localFrame,
  materializeSeeds,
  place,
  RenderIrError,
  segmentDurationInFrames,
  segmentIrHash,
  sortIrRecords,
  toSeedHex,
  type AssemblyInput,
  type BuildIrInput,
  type BuildIrResult,
  type ForcedPlacement,
  type IrBuildRecord,
  type IrCaptionGroupSource,
  type IrCaptionTokenSource,
  type IrClipSource,
  type IrRecordRule,
  type IrSegmentSource,
  type Placement,
  type RenderIrRule,
  type SeedScope,
  type SegmentFrame,
} from './render-ir/index.js';

export { compileIr, type CompileIrInput } from './compile-ir.js';

export {
  audioTrackRef,
  compileAudio,
  CompileAudioError,
  dumpAudioPlan,
  formatBreakdown,
  renderAudioTrack,
  withAudioTrack,
  type AudioBreakdown,
  type AudioCorrectionSilence,
  type AudioElement,
  type AudioMusicClip,
  type AudioPlainSilence,
  type AudioPlan,
  type AudioProfileInput,
  type AudioSilenceElement,
  type AudioSilenceKind,
  type AudioSpeechElement,
  type CompileAudioInput,
  type CompileAudioRule,
  type PcmSource,
} from './audio/index.js';
