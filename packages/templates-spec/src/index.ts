// Публичная поверхность `@vpe/templates-spec`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).
//
// ЧТО ЭТОТ ПАКЕТ ЭКСПОРТИРУЕТ: контракт шаблона (схема `params`, две декларации ресурсов,
// манифест), реестр и два ВХОДА инвариантов — `requestFiles` (**R3**) и `assertBuildMayStart`
// (**R12**). Вызывающих у обоих пока нет: список файлов запроса собирает адаптер (`H-01`),
// сборку запускает `vpe build` (`L-01`). Поэтому обе строки реестра инвариантов получают
// ПОМЕТКУ, а не переход в `guarded`.
//
// ЧЕГО ЗДЕСЬ НЕТ: реестра easing (`TS-02`), кода шаблонов (`E-*`, `renderer-hyperframes`),
// команды `vpe template gate` (`E-00`) и любого чтения диска.

// Ошибки контракта.
export { TemplateSpecError, type TemplateErrorPlace, type TemplateRule } from './errors.js';

// Грамматика имени вызова — единственная в репозитории (долг №37).
export {
  formatTemplateName,
  parseTemplateName,
  type TemplateName,
  type TemplateNamespace,
} from './name.js';

// Ссылки, которые объявляет шаблон.
export type { AssetRef, FontRef } from './refs.js';

// Общие формы полей `params`; `gridPoint` невыразим (долг №35).
export {
  aliasRef,
  decibels,
  geometry,
  AnchorPointParamSchema,
  MediaTimePointParamSchema,
  TimePointParamSchema,
} from './params.js';

// Манифест — данные пакета (решение владельца, вопрос 1), плюс производный класс.
export {
  determinismClassOf,
  ForkSourceSchema,
  GateRecordSchema,
  GATE_CLASSES,
  GATE_PROFILES,
  GATE_RUNS,
  TemplateManifestSchema,
  type DeterminismClass,
  type ForkSource,
  type GateClass,
  type GateProfileId,
  type GateRecord,
  type TemplateManifest,
} from './manifest.js';

// Контракт одного шаблона и вход **R3**.
export {
  declaredDurationOf,
  requestFiles,
  type AnyTemplateSpec,
  type RequestedFiles,
  type TemplateSpec,
} from './spec.js';

// Реестр и версия, которую сверяет `compileProfile` (**K6**, ADR-0006 §5).
export {
  createRegistry,
  TEMPLATE_REGISTRY_VERSION,
  type TemplateAddress,
  type TemplateRegistry,
} from './registry.js';

// Вход **R12** — сборка не стартует без записи гейта для пары.
export { assertBuildMayStart, type BuildPair, type GateRejection } from './gate.js';

// Пять спеков фикстуры.
export {
  FIXTURE_TEMPLATES,
  bed1,
  captionEmphasis1,
  flash1,
  kenburns1,
  still1,
  type BedParams,
  type CaptionEmphasisParams,
  type FlashParams,
  type KenburnsParams,
  type StillParams,
} from './templates/index.js';
