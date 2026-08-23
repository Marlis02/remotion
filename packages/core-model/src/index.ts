// Публичная поверхность `@vpe/core-model`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).

// `C-01` — модель времени (ADR-0003 T1–T4, ADR-0001 «Типы времени в авторском слое»).
export { TimeModelError, type TimeRule } from './time/errors.js';
export { addExact, assertSafeInteger, ceilDiv, floorDiv, mulExact } from './time/integer.js';
export { rational, type Rational } from './time/rational.js';
export { assertTimeGrid, timeGrid, type Fps, type TimeGrid } from './time/grid.js';
export { msToSamples } from './time/ms.js';
export {
  clipDurationInFrames,
  frameLengthInSamples,
  frameOfSample,
  frameStartSample,
  samplesPerFrame,
} from './time/frames.js';
export {
  assertClipWithinSegment,
  assertT4,
  frameInterval,
  sampleInterval,
  sampleIntervalLength,
  type ClipPlacement,
  type FrameInterval,
  type SampleInterval,
  type SegmentBounds,
  type SegmentPlacement,
} from './time/interval.js';
export {
  assertRealizable,
  type AnchorTimePoint,
  type Duration,
  type GridTimePoint,
  type MediaTimePoint,
  type RealizableTimePoint,
  type TimePoint,
} from './time/timepoint.js';

// `C-02` — лексер диалекта `source/`, span-map, AST (ADR-0002 §1, §2, §5, §8).
export { SourceParseError, type SourceLocation, type SourceRule } from './source/errors.js';
export {
  at,
  isWhitespace,
  locationAt,
  normalizeSource,
  pointLength,
  positionAt,
  sliceSource,
  sourceText,
  spanOf,
  spanText,
  type SourceText,
  type Span,
} from './source/text.js';
export {
  chunksIn,
  chunksOf,
  displaySpanOf,
  spokenSpanOf,
  tokensIn,
  type Chapter,
  type Chunk,
  type ChunkBreak,
  type ChunkNode,
  type Paragraph,
  type Scene,
  type Silence,
  type SourceDocument,
  type SpanRun,
  type TokenNode,
} from './source/ast.js';
export { lexBlocks, lexInline, lexMarker, type Block, type InlineItem, type RawMarker } from './source/lexer.js';
export { parseSource, type ParseOptions } from './source/parse.js';
export { runAtSpoken, sourceToSpoken, spokenToLocation, spokenToSource } from './source/spanmap.js';
export { dumpAst } from './source/dump.js';

// `C-03` — линт прозы (ADR-0002 §3) и трансдьюсер `[say:]` (ADR-0010 §10).
export {
  ABBREVIATIONS,
  assertProse,
  lintProse,
  lintShare,
  PROSE_RULE_CODES,
  type LintShare,
  type ProseFinding,
  type ProseRuleCode,
} from './source/lint.js';
export {
  reconstructDisplay,
  runAtSpokenIndex,
  spokenOrigin,
  transduceChunk,
  transduceDocument,
  TransducerError,
  type ChunkText,
  type SpokenOrigin,
  type TextRun,
  type TextRunKind,
} from './source/transduce.js';

// `C-04` — ledger якорей (ADR-0004 §1/§2a/§4/§6, ADR-0005 §10; инварианты A2, A3, A8).
export { AnchorLedgerError, type AnchorRule } from './anchors/errors.js';
export { csprng, mintAnchorId, MINT_BYTES, MINT_LENGTH, type RandomBytes } from './anchors/mint.js';
export {
  assertAddOnly,
  assertUniqueLive,
  EMPTY_LEDGER,
  latestById,
  LEDGER_FILE,
  liveAnchors,
  nextRev,
  parseLedger,
  renderLedger,
} from './anchors/ledger.js';
export { assertBoundTo, boundTo, boundToOf, type AnchorContext } from './anchors/boundto.js';
export { DIFF_CELL_LIMIT, diffTokens, type TokenMatch } from './anchors/diff.js';
export { anchorSlots, implicitBitId, type AnchorSlot, type SlotKind } from './anchors/slots.js';
export { expandImg, type GeneratedDirectionRecord } from './anchors/img.js';
export {
  syncLedger,
  type AnchorBinding,
  type SyncOptions,
  type SyncResult,
} from './anchors/sync.js';

// `C-05` — сущности ADR-0001 (Score, Timeline), чтение и валидация `direction/1`, seed'ы.
// `Chapter`/`Scene`/`Paragraph` здесь НЕ переэкспортируются вторым именем: они уже вывезены
// выше из `source/ast.ts` (`C-02`). В `model/entities.ts` они реэкспортированы вместе с
// колонкой «НЕ знает» из ADR-0001 — там это связь с таблицей, а не второй тип.
export {
  TRACK_KINDS,
  type AnchorRef,
  type Clip,
  type DirectionRecord,
  type JsonValue,
  type Override,
  type SilenceKind,
  type TemplateCall,
  type TemplateDirectionRecord,
  type TemplateParams,
  type TemplateTrackKind,
  type TimelineSilence,
  type Track,
  type TrackKind,
  type VoiceDirectionRecord,
} from './model/entities.js';
export { ModelError, type ModelErrorPlace, type ModelRule } from './model/errors.js';
export {
  DIRECTION_FAMILY,
  parseDirection,
  readDirection,
  validateDirection,
  type AnchorWorld,
  type DirectionFile,
  type DirectionSource,
  type PlacedRecord,
  type Scope,
} from './model/direction.js';
export { SEED_BYTES, seedOf, type SeedNode } from './model/seed.js';
