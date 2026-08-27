// Контракт шаблона, потреблённый компилятором (`CP-07`) — ЕДИНСТВЕННОЕ место, где `compile`
// зовёт спек. Чистая функция своих входов: ни `fs`, ни сети, ни часов, ни `random`.
//
// КОМПИЛЯТОР НЕ ИНТЕРПРЕТИРУЕТ ШАБЛОН. Отсюда наружу уходят четыре вызова спека —
// `paramsSchema.parse`, `declareAssets`, `declareFonts`, `declareDuration?` — и чтение
// манифеста (`purposes`, `msPerFrameBudget`). Ни одного обращения к `params` по имени поля
// («`asset`», «`durationSamples`», «`inPoint`») в `compile/src/**` нет и быть не должно:
// это охраняется грепом (`tests/lints/cp07-template-params.test.ts`), а не дисциплиной.
// Разница содержательна: имя поля принадлежит ШАБЛОНУ, и компилятор, прочитавший его сам,
// молча ломается в день, когда шаблон переименует параметр, — вместо отказа схемы.
//
// ПОРЯДОК ПРОВЕРОК ЗАФИКСИРОВАН (поправка владельца П1, 2026-08-28) и проверяется тестом:
//
//   0. версия реестра против профиля — РАНЬШЕ ЛЮБОЙ ЗАПИСИ (**K6**);
//   1. имя вызова → `parseTemplateName`;
//   2. → `registry.resolve` (шаблон зарегистрирован);
//   3. → `paramsSchema.safeParse`;
//   4. → `declareAssets` / `declareFonts` (+ разрешение alias'ов и роли шрифта);
//   5. → `declareDuration?` и сверка с `until`.
//
// **`declare*` и `declareDuration` НЕ ЗОВУТСЯ на записи, не прошедшей схему** — это часть
// поправки П1, а не оптимизация: спек, получивший `params`, которых он не обещал, вернул бы
// список файлов, которого никто не объявлял (та самая дыра, которую закрывает **R3**), либо
// упал бы `TypeError` вместо честного отказа схемы с путём к полю.
//
// ОШИБКИ СОБИРАЮТСЯ ВСЕ, а не первая: проблемы контракта приходят пачками (переименовали
// параметр — покраснели все записи шаблона), и отказ на первой заставлял бы чинить их по
// одной, перезапуская сборку. Довод и форма — те же, что у `CompileError` (`CP-01`).

import type {
  GeneratedDirectionRecord,
  IrAssetRef,
  IrFontRef,
  PlacedRecord,
  Samples,
  TemplateParams,
} from '@vpe/core-model';
import { resolveAlias, type AssetCatalog } from '@vpe/media';
import {
  declaredDurationOf,
  parseTemplateName,
  type AnyTemplateSpec,
  type TemplateRegistry,
} from '@vpe/templates-spec';

import { CompileError, type CompileProblem } from './errors.js';

/**
 * Всё, что вызов шаблона объявил о себе, — по одному на клип.
 *
 * ЭТО НЕ «РАЗВЁРНУТЫЙ ШАБЛОН». Разворачивание (`(params, тайминги) → примитивы`) исполняет
 * АДАПТЕР (ADR-0008, «Разрешение V3 × V9»); здесь — только то, что шаблон ОБЪЯВИЛ, и в форме,
 * в которой это уедет в IR: sha вместо alias'ов, роли рядом, длительность в сэмплах.
 */
export interface ClipContract {
  /** `declareAssets` + `resolveAlias`, порядок деклараций спека сохранён. */
  readonly assets: readonly IrAssetRef[];
  /** `declareFonts` + запись `kind: 'font'` каталога, порядок деклараций спека сохранён. */
  readonly fonts: readonly IrFontRef[];
  /** `declareDuration?` — `null`, если шаблон о длительности не высказывается (№119). */
  readonly declaredDurationSamples: Samples | null;
  /** `manifest.purposes` — перечень seed'ов узла (ADR-0007 §1, №135). */
  readonly purposes: readonly string[];
  /** `manifest.msPerFrameBudget` — слагаемое суммы по кадру (ADR-0008 «Бюджет AC2», №146). */
  readonly msPerFrameBudget: number;
}

/** Вход стадии контракта. Всё — значения; реестр приходит СНАРУЖИ, а не импортируется. */
export interface TemplateContractsInput {
  /** Записи режиссуры с разрешённым scope (`readDirection`, `C-05`). */
  readonly records: readonly PlacedRecord[];
  /** Порождённые `[img:]`-записи (`expandImg`, `C-04`). */
  readonly generated: readonly GeneratedDirectionRecord[];
  readonly catalog: AssetCatalog;
  /**
   * Реестр шаблонов — ВХОД, а не глобал.
   *
   * «Реестра по умолчанию» внутри стадии нет ни одного импорта, и это исполнимая форма K6:
   * реестр, который компилятор молча берёт сам, невозможно сверить с профилем — сверять было
   * бы не с чем. Реестр подаёт CLI (`L-01`), тест — свой.
   */
  readonly registry: TemplateRegistry;
  /** `compile-profile/1 → templateRegistryVersion`. Сверяется с `registry.version` (**K6**). */
  readonly templateRegistryVersion: string;
}

/** Ключ карты контрактов — `clipId`, тот же, что построит укладка (`records.ts`). */
export type ClipContracts = ReadonlyMap<string, ClipContract>;

/**
 * Разбирает одно объявление шрифта в ссылку с sha и семейством.
 *
 * **ПРАВИЛО V1 (решение владельца `CP-07`, вопрос 3, вариант «а»): ровно одна запись
 * `kind: 'font'` в проекте обслуживает ВСЕ роли; ноль или две+ — ошибка.** Записи
 * `asset-record/1` ролей не несут, профиль — тоже (`@vpe/schema` в этой задаче закрыт), и
 * третьего места, где связь «роль → файл» могла бы жить, сегодня нет.
 *
 * Отвергнутая альтернатива названа ценой: сделать `FontRef.family` обязательным и сверять его
 * с `intrinsic.family` значило бы, что `captionEmphasis@1` вписывает «DejaVu Sans» — то есть
 * ШАБЛОН знает шрифт канала и увозит временный выбор (№13) в `engineFingerprint` вместе с
 * первым гейтом. Цена принятого правила — неявность; она оплачена ошибкой на неоднозначности
 * (две записи — отказ, а не «первая попавшаяся») и долгом «поле роли шрифта в профиле».
 *
 * `family` в ссылку кладётся ИЗМЕРЕННОЕ — `intrinsic.family` записи, а не то, что назвал
 * шаблон: в запрос рендерера (ADR-0008 «Контракт») едет семейство ФАЙЛА, и разойтись эти две
 * строки не имеют права. Если спек семейство всё же назвал — оно сверяется.
 */
function fontRefOf(
  catalog: AssetCatalog,
  role: string,
  family: string | undefined,
  problems: CompileProblem[],
  where: string,
): IrFontRef | null {
  const fonts = [...catalog.records].filter(([, record]) => record.kind === 'font');
  if (fonts.length !== 1) {
    problems.push({
      address: where,
      message:
        `шаблон объявил шрифт роли \`${role}\`, а записей \`kind: 'font'\` в каталоге ` +
        `${String(fonts.length)}. Правило v1 (решение владельца \`CP-07\`, вопрос 3): роли ` +
        'обслуживает ЕДИНСТВЕННАЯ запись шрифта проекта; при нуле её негде взять, при двух ' +
        'и более — выбор между ними принадлежит автору, а не компилятору. Укажите шрифт ' +
        'роли (поле профиля — долг с адресом `H-07`/№13)',
    });
    return null;
  }

  const [sha256, record] = fonts[0] as [IrFontRef['sha256'], { readonly intrinsic: unknown }];
  const intrinsic = record.intrinsic;
  if (typeof intrinsic !== 'object' || intrinsic === null || !('family' in intrinsic)) {
    problems.push({
      address: where,
      message:
        `запись шрифта \`${sha256}\` не несёт \`intrinsic.family\`: \`kind: 'font'\` при ` +
        'геометрическом или звуковом `intrinsic` означает запись, описывающую не шрифт ' +
        '(ADR-0005 §1: одно семейство `asset-record/1`, вид блоба — поле `kind`)',
    });
    return null;
  }

  const measured = String((intrinsic as { readonly family: unknown }).family);
  if (family !== undefined && family !== measured) {
    problems.push({
      address: where,
      message:
        `шаблон объявил семейство \`${family}\` для роли \`${role}\`, а единственная запись ` +
        `шрифта проекта — \`${measured}\`. В запрос рендерера едет семейство ФАЙЛА ` +
        '(ADR-0008 «Контракт»), и разойтись эти две строки не имеют права',
    });
    return null;
  }
  return { sha256, family: measured, role };
}

/** Один вызов шаблона: шаги 1–5 порядка П1. `null` ⇒ проблемы записаны, контракта нет. */
function contractOf(
  input: TemplateContractsInput,
  where: string,
  template: string,
  params: TemplateParams,
  hasUntil: boolean,
  isGenerated: boolean,
  problems: CompileProblem[],
): ClipContract | null {
  // Шаги 1–2. `parseTemplateName` и `resolve` живут в `templates-spec` и бросают
  // `TemplateSpecError`; здесь их отказ переводится в проблему СПИСКА, а не в падение —
  // иначе вторая ошибка вызова осталась бы ненайденной до следующего прогона.
  let spec: AnyTemplateSpec;
  try {
    spec = input.registry.resolve(parseTemplateName(template));
  } catch (error) {
    problems.push({ address: where, message: error instanceof Error ? error.message : String(error) });
    return null;
  }

  // Шаг 3. `safeParse`, а не `parse`: путь к полю нужен КАЖДЫЙ, а не только первый.
  const parsed = spec.paramsSchema.safeParse(params);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push({
        address: where,
        // ПУТЬ ПИШЕТСЯ ЧЕРЕЗ СТРЕЛКУ, А НЕ ТОЧКОЙ ОТ `params`, и это не косметика: греп
        // `tests/lints/cp07-template-params.test.ts` запрещает форму `params.<имя>` во всём
        // `compile/src/**`, а строковый литерал от обращения к полю он не отличает — и
        // отличать не должен, иначе его пришлось бы учить разбирать TypeScript.
        message: `\`${template}\` · поле \`params\` → \`${issue.path.join('.') || '<корень>'}\`: ${issue.message}`,
      });
    }
    // ВОЗВРАТ ЗДЕСЬ — ЧАСТЬ ПРАВИЛА (поправка владельца П1), а не ранний выход: ниже стоят
    // вызовы спека, и подать в них `params`, которых спек не обещал, значило бы получить
    // список файлов, которого никто не объявлял (**R3**).
    return null;
  }
  const value: unknown = parsed.data;

  // Шаг 4. Обе декларации — на РАЗОБРАННЫХ `params`.
  const assets: IrAssetRef[] = [];
  for (const ref of spec.declareAssets(value)) {
    const sha256 = resolveAlias(input.catalog, ref.alias);
    if (sha256 === undefined) {
      problems.push({
        address: where,
        message:
          `\`${template}\` объявил ассет роли \`${ref.role}\` по alias'у \`${ref.alias}\`, а ` +
          'в `assets/aliases.yaml` такого alias\'а нет. Пропустить его молча значило бы ' +
          'собрать ролик без картинки; выдумать sha — положить в ключ кэша адрес байтов, ' +
          'которых не существует',
      });
      continue;
    }
    assets.push({ sha256, role: ref.role });
  }

  const fonts: IrFontRef[] = [];
  for (const ref of spec.declareFonts(value)) {
    const font = fontRefOf(input.catalog, ref.role, ref.family, problems, `${where} · \`${template}\``);
    if (font !== null) fonts.push(font);
  }

  // Шаг 5. Длительность и её противоречие с `until`.
  const declaredDurationSamples = declaredDurationOf(spec, value);
  if (declaredDurationSamples !== null && hasUntil) {
    problems.push({
      address: where,
      message:
        `\`${template}\` объявляет длительность (${String(declaredDurationSamples)} сэмплов), ` +
        'и у записи при этом есть `until`. Две длительности у одного клипа — противоречие ' +
        'автора самому себе, а не выбор компилятора (решение владельца `CP-07`, вопрос 4): ' +
        'уберите `until` либо возьмите шаблон, длительность которого задаёт место',
    });
  }

  // Порождённая запись + непустые `purposes` — ошибка, а не выдуманный `recordId`.
  // ADR-0007 §1 определяет `recordId` как id, ВЫДАННЫЙ CLI и ЗАПИСАННЫЙ в `direction/*.yaml`;
  // у порождённой `[img:]`-записи нет ни одного из двух событий (решение владельца `C-05`,
  // долг №21). Формула seed'а без `recordId` не записывается — значит шаблон, просящий
  // случайность, на порождённую запись поставлен быть не может (долг №136, условие открытия).
  if (isGenerated && spec.manifest.purposes.length > 0) {
    problems.push({
      address: where,
      message:
        `\`${template}\` объявляет ${String(spec.manifest.purposes.length)} purpose(s) ` +
        `(${spec.manifest.purposes.join(', ')}), а запись порождена из \`[img:]\` — у неё нет ` +
        '`recordId` (ADR-0007 §1: id выдаёт CLI и записывает в `direction/*.yaml`). Формула ' +
        'seed\'а без `recordId` не записывается, а выдумать его компилятор не вправе',
    });
    return null;
  }

  return {
    assets,
    fonts,
    declaredDurationSamples,
    purposes: spec.manifest.purposes,
    msPerFrameBudget: spec.manifest.msPerFrameBudget,
  };
}

/**
 * Контракты всех вызовов шаблонов проекта — `clipId → ClipContract`.
 *
 * ОДИН ПУТЬ НА ВСЕ КЛИПЫ, включая порождённые `[img:]`. До `CP-07` у порождённой записи была
 * своя ветка (`resolveAlias` прямо в укладке — «единственный alias, который `compose`
 * разрешает», решение владельца `CP-01`, вопрос 8), потому что манифеста шаблона не
 * существовало. Теперь он существует: `still@1` объявляет `{alias: params.asset, role:
 * 'asset'}` тем же `declareAssets`, что и все, — и особой ветки больше нет (долг №120).
 *
 * @throws {CompileError} со СПИСКОМ — версия реестра, имя вызова, шаблон вне реестра,
 *   `params` не по схеме, alias без записи, шрифт роли не найден, `until` при объявленной
 *   длительности, purposes у порождённой записи.
 */
export function templateContracts(input: TemplateContractsInput): ClipContracts {
  // Шаг 0. РАНЬШЕ ЛЮБОЙ ЗАПИСИ (**K6**, поправка владельца П1): при разошедшейся версии все
  // дальнейшие ответы давал бы не тот реестр, который назвал автор, — и список ошибок «эти
  // шесть шаблонов не зарегистрированы» описывал бы не проект, а подмену реестра.
  if (input.registry.version !== input.templateRegistryVersion) {
    throw new CompileError('ADR-0006 §5 (K6)', 'реестр шаблонов не тот, который назвал профиль', [
      {
        address: 'profiles/compile.yaml · templateRegistryVersion',
        message:
          `профиль назвал версию реестра \`${input.templateRegistryVersion}\`, а подан реестр ` +
          `версии \`${input.registry.version}\` (${String(input.registry.names.length)} ` +
          'шаблонов). Версия реестра входит в `compileProfile` (ADR-0008 «Разрешение V3 × V9») ' +
          'и через него — в ключ сегмента: собрать ролик другим реестром, чем назвал автор, ' +
          'значит выдать чужие пиксели за его',
      },
    ]);
  }

  const problems: CompileProblem[] = [];
  const out = new Map<string, ClipContract>();

  for (const placed of input.records) {
    const record = placed.record;
    // Дорожка `voice` — ДИРЕКТИВНАЯ: шаблона у записи нет вовсе (`VoiceDirectionRecord`),
    // она питает SpeechPlan и клипа не порождает (ADR-0001, RM2 решение владельца 1).
    if (record.track === 'voice') continue;
    const where = `${placed.filePath} · r:${record.recordId}`;
    const contract = contractOf(
      input,
      where,
      record.template,
      record.params,
      record.until !== undefined,
      false,
      problems,
    );
    if (contract !== null) out.set(`r:${record.recordId}`, contract);
  }

  for (const record of input.generated) {
    // АДРЕС — ЯКОРЬ, А НЕ ALIAS. `record.params.asset` дал бы читаемую строку и был бы
    // обращением к `params` по имени поля шаблона — ровно тем, что здесь запрещено. Якорь
    // неявного бита (`b:img-harbour-1`) alias уже содержит по построению (ADR-0002 §4).
    const where = `[img:] · ${record.at.anchor}`;
    const contract = contractOf(input, where, record.template, record.params, true, true, problems);
    if (contract !== null) out.set(`img:${record.at.anchor}`, contract);
  }

  if (problems.length > 0) {
    throw new CompileError(
      'ADR-0008 «Декларация ресурсов шаблона»',
      'вызовы шаблонов не проходят свой контракт',
      problems,
    );
  }
  return out;
}
