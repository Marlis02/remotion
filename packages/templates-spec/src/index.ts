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
export { DEFAULT_ASSET_KIND, type AssetKind, type AssetRef, type FontRef } from './refs.js';

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

// Интроспекция `paramsSchema` — форма параметров ЧТЕНИЕМ СХЕМЫ (`SPEC-01`). Вызывающий —
// `vpe spec export`: выгрузка правил движка для ИИ-сценариста. Литералов про параметры в ней
// нет ни одного, и это условие её существования — второй источник истины запрещён (№179).
export {
  introspectParams,
  type ParamRefinement,
  type ParamsIntrospection,
} from './params-schema.js';

// Контракт одного шаблона и вход **R3**.
export {
  declaredAudioOf,
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

// Дом записей гейта: файл `<id>@<N>/gates.json` В ПАПКЕ шаблона (`E-00`, долг №170; переезд —
// `TPL-01a`). Диска здесь нет — содержимое файлов приезжает значением (граница пакета, R3),
// а имена папки/файлов/подкаталога запросов — единственный источник адресации для тех, у кого
// диск есть (`renderer-hyperframes/src/library.ts`, `cli/src/template-gate.ts`, билдер запросов).
export {
  attachGates,
  gateRequestFileName,
  loadedSpecs,
  makeGateFile,
  parseTemplateDirName,
  replaceEntry,
  templateDirName,
  GateFileSchema,
  GATES_FILE_SCHEMA,
  GATES_FILE_NAME,
  GATE_REQUESTS_DIR,
  type GateFile,
  type GateFileEntry,
  type GateFileSource,
  type LoadedTemplate,
} from './gates-file.js';

// Дом пресетов: файлы `<id>@<N>/presets/<name>.json` В ПАПКЕ шаблона (`TPL-01b`). Диска здесь
// тоже нет — содержимое приезжает значением; читает его тот же единственный загрузчик, что и
// `gates.json`. Пресет разворачивается КОМПИЛЯТОРОМ до `paramsSchema` и ниже не существует.
export {
  attachPresets,
  parsePresetFileName,
  presetFileName,
  presetNames,
  presetsOf,
  PresetFileSchema,
  PRESETS_DIR,
  PRESET_FILE_EXT,
  type PresetFileSource,
  type TemplatePreset,
} from './presets.js';

// Дом демо: папка `<id>@<N>/demo/` (`TPL-01c`). Здесь — только «есть или нет»: содержимое
// `demo.yaml` разбирает команда `vpe template demo`, которой виден `@vpe/schema` с его
// читателем семейств. Довод разделения — в шапке `demo.ts`.
export {
  attachDemos,
  demoFileOf,
  demoOf,
  DemoFileSchema,
  DEMO_ASSETS_DIR,
  DEMO_DIR,
  DEMO_FILE_NAME,
  type DemoFileSource,
  type TemplateDemo,
  type TemplateDemoAsset,
  type TemplateDemoFont,
  type TemplateDemoRecord,
} from './demo.js';

// Прод-библиотека: СЕМЬ версионированных единиц каталога (`E-00`; прежнее имя
// `FIXTURE_TEMPLATES`). Сам список — ПРОИЗВОДНЫЙ от листинга каталога и генерируется
// (`scripts/gen-template-registry.mjs`, `TPL-01a`); отсюда он выходит одним именем.
export { TEMPLATE_LIBRARY } from './templates/index.js';

// **ИМЕНОВАННЫЕ СПЕКИ И ИХ ТИПЫ `params` — ПРЯМО ИЗ ПАПОК, А НЕ ИЗ РЕЕСТРА** *(изменено:
// `TPL-01a`, 2026-09-09)*. Прежде они ехали через `./templates/index.js`; теперь тот файл
// генерируется, а имена типов (`KenburnsParams`, `Parallax25Params`) из имени папки не
// выводятся ничем — генератор, который бы их угадывал, был бы вторым разбором TypeScript.
//
// **ЭТОТ СПИСОК НОВОМУ ШАБЛОНУ ПРАВИТЬ НЕ НАДО, И ЭТО НЕ ПОСЛАБЛЕНИЕ, А ПРЕЦЕДЕНТ.** `grade@1`
// стоит в библиотеке с `E-07` и наружу не выведен вовсе: шаблон адресуется реестром по имени,
// а именованный экспорт нужен только тому, у кого есть ВТОРОЙ вызывающий, — сегодня это тесты
// и `compile`. Восьмой шаблон попадает в `TEMPLATE_LIBRARY` папкой; строка здесь появляется
// тогда и только тогда, когда его имя кому-то понадобилось.
//
// **ТРИ ИМЕНИ `parallax25@1` ВЫВЕДЕНЫ НАРУЖУ, И КАЖДОЕ — ПО АДРЕСУ.** `LAYER_ROLE_PREFIX` и
// `layerRole` читает реализация рендерера (она собирает имя роли внутри текста `mountSource`)
// и билдер запросов гейта; `MAX_PARALLAX_LAYERS` — тест протокола нарушений Н1, которому
// нужен ПЯТЫЙ слой, а не литерал `5`.
export { bed1, type BedParams } from './templates/bed@1/spec.js';
export type { AudioContribution, AudioInPoint, AudioPause } from './audio.js';
export { captionEmphasis1, type CaptionEmphasisParams } from './templates/captionEmphasis@1/spec.js';
export { flash1, type FlashParams } from './templates/flash@1/spec.js';
export { kenburns1, type KenburnsParams } from './templates/kenburns@1/spec.js';
export { kineticType1, type KineticTypeParams } from './templates/kineticType@1/spec.js';
export {
  parallax251,
  layerRole,
  LAYER_ROLE_PREFIX,
  MAX_PARALLAX_LAYERS,
  type Parallax25Params,
} from './templates/parallax25@1/spec.js';
export { still1, type StillParams } from './templates/still@1/spec.js';
