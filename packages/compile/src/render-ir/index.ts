// Поверхность зоны `render-ir/` (**M5**, ADR-0009: «IR не знает Timeline»).
//
// Барьер один и на всю зону: снаружи её видно через этот файл, а внутрь `timeline/**` не
// приходит ни одной строкой. Единственный законный читатель обеих зон — `../compile-ir.ts`,
// стадия, лежащая ВНЕ обеих.

export { RenderIrError, type RenderIrRule } from './errors.js';
export {
  assemblyManifest,
  segmentDurationInFrames,
  type AssemblyInput,
} from './metrics.js';
export {
  localFrame,
  place,
  type ForcedPlacement,
  type Placement,
  type SegmentFrame,
} from './quantize.js';
export { sortIrRecords, type IrBuildRecord, type IrRecordRule } from './records.js';
export { materializeSeeds, toSeedHex } from './seeds.js';
export { segmentIrHash } from './hash.js';
export { buildIr, type BuildIrInput, type BuildIrResult, type SegmentBudget } from './build.js';
export { dumpIr } from './dump.js';
export type {
  IrCaptionGroupSource,
  IrCaptionTokenSource,
  IrClipSource,
  IrSegmentSource,
  SeedScope,
} from './types.js';
