// Публичная поверхность `@vpe/cli` — «парсинг аргументов, оркестрация стадий, вывод»
// (карта ADR-0009). Доменной логики здесь нет: гейт снимает `renderer-hyperframes`, форму
// записи держит `templates-spec`, кодирует `media`.
//
// ЧТО ЕСТЬ СЕГОДНЯ (`E-00`): `vpe template gate` (Charter V13, R12) и `vpe template list`.
// ЧЕГО НЕТ: `vpe build` (`L-01`), `vpe render-segment` (`L-02`), `vpe fmt` — их команды придут
// своими задачами и позовут функции, уже написанные здесь (сумма бюджета — `budget.ts`,
// устаревание записи — `gateStaleness` из `templates-spec`).

export { parseArgv, USAGE, type CliCommand, type TemplateGateArgs, type TemplateListArgs } from './argv.js';
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
