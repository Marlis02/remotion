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
  BROWSER_PATH_ENV,
  BROWSER_PATH_ENV_OVERRIDE,
  FIXED_RENDER_ARGS,
  FIXED_RENDER_ENV,
  renderArgs,
  renderEnv,
  type RenderArgsInput,
  type RenderEnvInput,
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
  browserLaunchLineOf,
  browserPath,
  compositionLintReport,
  defaultCliPath,
  engineCompositionHashOf,
  launchCommand,
  pageErrorsOf,
  parseTrace,
  renderSegment,
  resolveOnPath,
  type RenderOptions,
  type TraceRecord,
} from './run.js';

// Гейт детерминизма шаблона (`H-04`, Charter V13, **R12**) и его прибор `where`.
export {
  GATE_SKIP_WHY,
  engineFingerprintProbe,
  formatGateOutcome,
  runGate,
  type GateInput,
  type GateMedia,
  type GateMeasurement,
  type GateMediaInput,
  type GateOutcome,
  type GateRenderFn,
  type GateRun,
} from './gate.js';

// Склейка порта `GateMedia` — ОДНА на репозиторий (`E-00`, долг №169). Зависимости `media`
// приезжают значением: стрелки `renderer-hyperframes → media` в карте ADR-0009 нет.
export {
  createGateMedia,
  type GateArtifact,
  type GateFramemd5,
  type GateMediaDeps,
} from './gate-media.js';

// Каталог шаблонов на диске: спеки из кода + записи `<id>@<N>.gates.json` рядом (`E-00`).
export {
  LIBRARY_SUBDIR,
  gateFileSources,
  loadTemplateLibrary,
  templateLibraryDir,
  templatesSpecDir,
  type LibraryInput,
  type TemplateLibrary,
} from './library.js';

export {
  bboxOfDiff,
  decodeRgb,
  differingFramesOf,
  formatWhereReport,
  pngSize,
  psnrOf,
  whereReport,
  type Bbox,
  type ClipDivergence,
  type FrameProbe,
  type WhereOptions,
  type WhereReport,
  type WhereRun,
} from './where.js';

// Детерминированный выбор браузера (`H-05`, долг №160): правда о том, ЧТО ЗАПУСТИТСЯ.
export {
  BROWSER_CACHE_SEGMENTS,
  FOREIGN_CACHE_SEGMENTS,
  HEADLESS_SHELL_EXECUTABLE,
  cliReportedBrowserPath,
  foreignBrowserRoot,
  hostPlatformKey,
  pinnedBrowserInstalls,
  pinnedBrowserPath,
  pinnedBrowserRoot,
  resolvePinnedBrowser,
  type BrowserInstall,
  type BrowserResolveInput,
} from './browser.js';

// Сетевая изоляция (`H-05`, **R1**).
export {
  DEFAULT_ISOLATION,
  NETNS_SCRIPT,
  UNSHARE_ARGS,
  assertIsolationAvailable,
  netnsCommand,
  type IsolationMode,
  type IsolationTools,
  type NetnsCommand,
  type NetnsCommandInput,
} from './isolation.js';

export {
  rendererTemplates,
  resolveTemplate,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './templates/index.js';
