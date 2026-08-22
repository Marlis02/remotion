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
  type AnchorId,
  type AnchorTimePoint,
  type Duration,
  type GridTimePoint,
  type MediaTimePoint,
  type RealizableTimePoint,
  type TimePoint,
} from './time/timepoint.js';
