// Публичная поверхность `@vpe/cli` — «парсинг аргументов, оркестрация стадий, вывод»
// (карта ADR-0009). Доменной логики здесь нет: гейт снимает `renderer-hyperframes`, форму
// записи держит `templates-spec`, кодирует `media`.
//
// ЧТО ЕСТЬ СЕГОДНЯ: `vpe build` (`L-01`), `vpe render-segment` и `vpe store verify|fetch|push`
// (`L-02`), `vpe template gate` (Charter V13, R12, `E-00`), `vpe template list` и
// `vpe spec export` (`SPEC-01` — правила движка одной выгрузкой для ИИ-сценариста). ЧЕГО НЕТ:
// `vpe fmt` (`L-03`). ЧЕГО НЕ БУДЕТ: `vpe store gc` — `.store` не подлежит LRU-GC никогда (K10).
//
// `vpe build` устроен так же, как гейт: разбор аргументов, оркестрация чужих стадий, вывод.
// Обе половины лежат в `build/` — `pipeline.ts` считается без браузера, `render.ts` требует
// его; разделение не косметическое, на нём стоят юнит-тесты сборки.

export {
  parseArgv,
  USAGE,
  type BuildArgs,
  type CliCommand,
  type RenderSegmentArgs,
  type SpecExportArgs,
  type StoreAction,
  type StoreArgs,
  type TemplateGateArgs,
  type TemplateListArgs,
} from './argv.js';
export { build, type BuildDeps } from './build.js';
export {
  readProject,
  readRenderProfile,
  type BuildLayout,
  type InputFile,
  type ProjectInputs,
} from './build-stages/inputs.js';
export {
  runPipeline,
  type PipelineInput,
  type PipelineResult,
} from './build-stages/pipeline.js';
export {
  StageWriter,
  writeBuildRecord,
  writeReport,
  type BuildRecord,
  type SegmentRow,
  type StageOutput,
} from './build-stages/record.js';
export {
  assembleFinal,
  buildRequest,
  compositionIdOf,
  measureFingerprint,
  renderSegments,
  type RenderDeps,
  type RenderFn,
  type SegmentResult,
} from './build-stages/render.js';
export { CliError, EXIT, type CliRule } from './errors.js';
export {
  RENDER_SEGMENT_EXIT,
  renderSegmentCommand,
  type RenderSegmentDeps,
} from './render-segment.js';
export {
  exampleDirectionYaml,
  formatSpecExport,
  specExport,
  specExportJson,
  SPEC_EXPORT_SCHEMA,
  type ChannelFact,
  type GateStatus,
  type SpecCode,
  type SpecExport,
  type SpecExportExample,
  type SpecExportTemplate,
  type SpecSection,
  type SpecTable,
} from './spec-export.js';
export { store, type StoreDeps } from './store.js';
export {
  BUDGET_THRESHOLD_MS,
  formatBudgetReport,
  overlappingBudget,
  type BudgetClip,
  type BudgetReport,
  type BudgetSpan,
} from './budget.js';
export { templateGate, type GateRunner, type TemplateGateDeps } from './template-gate.js';
export { formatTemplateTable, templateRows, type TemplateRow } from './template-list.js';
export { runCli, type CliDeps } from './run.js';
