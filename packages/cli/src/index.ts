// Публичная поверхность `@vpe/cli` — «парсинг аргументов, оркестрация стадий, вывод»
// (карта ADR-0009). Доменной логики здесь нет: гейт снимает `renderer-hyperframes`, форму
// записи держит `templates-spec`, кодирует `media`.
//
// ЧТО ЕСТЬ СЕГОДНЯ: `vpe build` (`L-01`), `vpe template gate` (Charter V13, R12, `E-00`) и
// `vpe template list`. ЧЕГО НЕТ: `vpe render-segment` (`L-02`), `vpe fmt` (`L-03`).
//
// `vpe build` устроен так же, как гейт: разбор аргументов, оркестрация чужих стадий, вывод.
// Обе половины лежат в `build/` — `pipeline.ts` считается без браузера, `render.ts` требует
// его; разделение не косметическое, на нём стоят юнит-тесты сборки.

export {
  parseArgv,
  USAGE,
  type BuildArgs,
  type CliCommand,
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
  mockSpeechSource,
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
