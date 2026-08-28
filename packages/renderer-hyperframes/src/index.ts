// Публичная поверхность `@vpe/renderer-hyperframes` (карта ADR-0009: адаптер подпроцесса +
// реализации шаблонов). `H-01` — адаптер; реализации шаблонов — `H-06`, реестр здесь пуст.

// Формы контракта ADR-0008 «Контракт» — без единого изменения поля.
export type {
  CompileProfileInput,
  ExecutionProfileInput,
  FpsFraction,
  PixelProfileInput,
  RenderProblem,
  RenderResponse,
  RenderStats,
  RenderedFrames,
  RequestAsset,
  RequestFont,
  SegmentRenderRequest,
  Sha256,
} from './contract.js';

export { RenderAdapterError, type RenderRule } from './errors.js';

export { assertRequestFiles, isInside, validateRequest, type RequestFile } from './validate.js';

export { extensionOf, KNOWN_MAGIC } from './magic.js';

export {
  compositionHashOf,
  materializeComposition,
  type CompositionListing,
  type MaterializedComposition,
} from './materialize.js';

export {
  FIXED_RENDER_ARGS,
  FIXED_RENDER_ENV,
  renderArgs,
  renderEnv,
  type RenderArgsInput,
} from './argv.js';

// `engineFingerprint` — единственное место измеренного окружения (`H-03`, ADR-0006 §3).
export {
  HOST_CLASS,
  PROBE_TIMEOUT_MS,
  assertEngineMatches,
  assertEngineProbeComplete,
  collectEngineProbe,
  computeEngineFingerprint,
  fingerprintedPackages,
  formatEngineProbe,
  installedVersion,
  rendererPackageDir,
  type EngineFingerprint,
  type EngineProbe,
  type EngineProbeInput,
  type ProbeValue,
} from './fingerprint.js';

export {
  FRAME_PATTERN,
  FRAME_START_NUMBER,
  browserPath,
  engineCompositionHashOf,
  parseTrace,
  renderSegment,
  resolveOnPath,
  type RenderOptions,
  type TraceRecord,
} from './run.js';

export {
  rendererTemplates,
  resolveTemplate,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './templates/index.js';
