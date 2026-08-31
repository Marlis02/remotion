// Публичная поверхность `@vpe/templates-spec`. Импорты внутри пакета — с расширением `.js`
// (`moduleResolution: NodeNext`, tsconfig.base.json).
//
// ЧТО ЭТОТ ПАКЕТ ЭКСПОРТИРУЕТ: контракт шаблона (схема `params`, две декларации ресурсов,
// манифест), реестр и два ВХОДА инвариантов — `requestFiles` (**R3**) и `assertBuildMayStart`
// (**R12**). Вызывающих у обоих пока нет: список файлов запроса собирает адаптер (`H-01`),
// сборку запускает `vpe build` (`L-01`). Поэтому обе строки реестра инвариантов получают
// ПОМЕТКУ, а не переход в `guarded`.
//
// ЧЕГО ЗДЕСЬ НЕТ: кода шаблонов (`E-*`, `renderer-hyperframes`), команды `vpe template gate`
// (`E-00`: она живёт в `@vpe/cli` и зовёт отсюда `attachGates`/`makeGateFile`) и любого чтения
// диска — записи гейта приезжают сюда ТЕКСТОМ, а `readdir`/`readFile` делает рендерер. ~~Реестра easing (`TS-02`).~~ *(изменено: `TS-02`,
// 2026-08-28)* — реестр easing здесь, и он ДАННЫЕ: шесть имён кривых и порядок трансформаций,
// которые потребляют схема манифеста (членство), схемы `params` шаблонов и рендерер
// (`H-06`, `gsap.parseEase`) — по стрелке `renderer-hyperframes → templates-spec` карты
// ADR-0009. Обратной стрелки нет: `gsap` этот пакет не видит (**M6**).

// Ошибки контракта.
export { TemplateSpecError, type TemplateErrorPlace, type TemplateRule } from './errors.js';

// Закрытый реестр easing — данные **D5** (`TS-02`): шесть кривых и порядок трансформаций.
export {
  assertEasingId,
  easingRejection,
  isEasingId,
  EasingIdSchema,
  EASING_REGISTRY,
  TRANSFORM_ORDER,
  type EasingId,
  type TransformComponent,
} from './easing.js';

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

// Вход **R12** — сборка не стартует без записи гейта для пары; правило «запись годится или
// устарела» — одной функцией `gateStaleness` (`E-00`).
export {
  assertBuildMayStart,
  gateStaleness,
  type BuildPair,
  type GateActual,
  type GateCandidate,
  type GateRejection,
} from './gate.js';

// Дом записей гейта: файл `<id>@<N>.gates.json` рядом со спеком (`E-00`, долг №170).
// Диска здесь нет — содержимое файлов приезжает значением (граница пакета, R3).
export {
  attachGates,
  gatesFileName,
  loadedSpecs,
  makeGateFile,
  parseGatesFileName,
  replaceEntry,
  GateFileSchema,
  GATES_FILE_SCHEMA,
  GATES_FILE_SUFFIX,
  type GateFile,
  type GateFileEntry,
  type GateFileSource,
  type LoadedTemplate,
} from './gates-file.js';

// Прод-библиотека: ~~пять~~ СЕМЬ версионированных единиц каталога (`E-00`; прежнее имя
// `FIXTURE_TEMPLATES`). *(дополнено: `E-02`, 2026-08-31.)*
//
// **ТРИ ИМЕНИ `parallax25@1` ВЫВЕДЕНЫ НАРУЖУ, И КАЖДОЕ — ПО АДРЕСУ.** `LAYER_ROLE_PREFIX` и
// `layerRole` читает реализация рендерера (она собирает имя роли внутри текста `mountSource`)
// и билдер запросов гейта; `MAX_PARALLAX_LAYERS` — тест протокола нарушений Н1, которому
// нужен ПЯТЫЙ слой, а не литерал `5`. Спеки остальных шести наружу ничего, кроме себя и
// своего типа `params`, не выводят — им нечего.
export {
  TEMPLATE_LIBRARY,
  bed1,
  captionEmphasis1,
  flash1,
  kenburns1,
  parallax251,
  still1,
  layerRole,
  LAYER_ROLE_PREFIX,
  MAX_PARALLAX_LAYERS,
  type BedParams,
  type CaptionEmphasisParams,
  type FlashParams,
  type KenburnsParams,
  type Parallax25Params,
  type StillParams,
} from './templates/index.js';
