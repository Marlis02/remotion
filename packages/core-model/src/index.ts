// Публичная поверхность `@vpe/core-model`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).

// Реэкспорт бренда `Samples` — РОВНО ОДНА СТРОКА, и она адресная (решение владельца, `V-01`
// вопрос 2; прецедент `BlobKind`, `M-02`). Кому: пакету `@vpe/voice`. Зачем: по карте ADR-0009
// он зависит только от `core-model` и `media` и `@vpe/schema` не резолвит вовсе
// (`packages/voice/node_modules/@vpe/` содержит два симлинка), а `number` на границе дубля —
// ровно та потеря бренда, ради которой бренды заведены (`S-01` долг №3). Сам `@vpe/schema`
// этой строкой не изменяется ни символом.
export { asSamples, type Samples } from '@vpe/schema';

// ВТОРОЙ АДРЕСНЫЙ БЛОК РЕЭКСПОРТА — решение владельца 2026-08-24 (`V-03`, вопрос 7), закрывает
// долг №69. Кому: пакету `@vpe/voice`. Зачем: `chunkKey` и `voiceKey` (ADR-0010 §3a, ADR-0006 §2)
// стоят на `blake3`, `base32` и канонической форме, а `voice` по карте ADR-0009 зависит только
// от `core-model` и `media` — `@vpe/schema` из него не резолвится вовсе (два симлинка в
// `packages/voice/node_modules/@vpe/`), и добавить стрелку нельзя: её ловит
// `tests/boundaries/adr0009-graph.test.ts`. Своя реализация была бы второй копией хэша, на
// котором стоят ВСЕ ключи кэша, а своя сериализация — невозможна: `JSON.stringify` запрещён
// линтом везде, кроме `packages/schema/src/canonical/json.ts`.
//
// ДВА ИМЕНИ СВЕРХ ПЕРЕЧИСЛЕННЫХ ВЛАДЕЛЬЦЕМ, И ОБА — ИСПОЛНИМАЯ ФОРМА ТОГО ЖЕ СПИСКА.
// Разрешение названо как «`blake3`, `base32`, `canonicalJson` и бренд `Blake3Hex`».
// (1) `blake3Bytes` — потому что `base32` принимает БАЙТЫ, а `blake3` отдаёт hex: без него
//     формула `base32(blake3(…))` из ADR-0010 §3a не записывается вовсе, а обходной путь
//     «hex → байты» был бы вторым декодером ради обхода перечня.
// (2) имени `Blake3Hex` в репозитории нет: бренд называется `Blake3`
//     (`packages/schema/src/types/brands.ts`), а `blake3Hex` — фабрика zod-схемы в
//     `families/common.ts`, и она здесь не нужна. Экспортируется бренд.
// Ни `asBlake3`, ни что-либо ещё из `@vpe/schema` этим блоком не добавляется; сам `@vpe/schema`
// не изменяется ни символом.
export { base32, blake3, blake3Bytes, canonicalJson, type Blake3 } from '@vpe/schema';

// ТРЕТИЙ АДРЕСНЫЙ БЛОК РЕЭКСПОРТА — решение владельца 2026-08-26 (`CP-01`, вопрос 5), закрывает
// долг №100. Кому: пакетам `@vpe/voice` и `@vpe/compile`. Зачем: `anchorId` в `SourceTokenRef`
// и `TokenBinding` был `string`, то есть подделка адреса якоря не краснела у компилятора
// (`V-05` §7 п. 1). `CP-01` — первый посторонний читатель take-файла, и на его границе `string`
// из JSON обязан стать якорем через ЕДИНСТВЕННЫЙ конструктор-валидатор, а не через регулярку
// в читателе. Ни `voice`, ни `compile` `@vpe/schema` не резолвят вовсе (в их
// `node_modules/@vpe/` два и четыре симлинка соответственно), и добавить стрелку нельзя —
// её ловит `tests/boundaries/adr0009-graph.test.ts`.
//
// ФОРМА — РОВНО КАК У `Samples`: конструктор плюс тип, одной строкой. `asAnchorId` без
// `AnchorId` не даёт ничего (некуда положить результат), `AnchorId` без `asAnchorId` —
// невыразимое значение: каст в бренд запрещён линтом везде, кроме `types/brands.ts` (`S-01`).
// `asPublicAnchorId`/`PublicAnchorId` этим блоком НЕ добавляются: они уже приезжают через
// `AnchorRef` и `expandImg`, а `w:` публичным якорем не является по построению.
// Сам `@vpe/schema` этой строкой не изменяется ни символом.
export { asAnchorId, type AnchorId } from '@vpe/schema';

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
// `isSentenceEnd` — часть того же адресного блока (решение владельца 2026-08-24, `V-03`
// вопрос 2): правило границы предложения в репозитории ОДНО, и деление длинного абзаца
// (ADR-0010 §3) обязано вызывать его, а не копировать.
export { isSentenceEnd, parseSource, type ParseOptions } from './source/parse.js';
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
