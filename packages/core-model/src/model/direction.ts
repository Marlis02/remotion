// Чтение и **семантическая** валидация `direction/1` — то, чего схема проверить не может.
//
// ГРАНИЦА СО СХЕМОЙ ПРОВЕДЕНА ТАК. `parseFamilyText` (`@vpe/schema`) проверяет ФОРМУ ОДНОГО
// ФАЙЛА: шапку, поля, типы, форму якоря (`publicAnchor()` — то есть `w:` отвергается уже там).
// Здесь — три вещи, которые из одного файла не видны в принципе:
//   1. **D3** — `recordId` уникальны В ПРЕДЕЛАХ ПРОЕКТА. Схема видит массив одного файла;
//      «два разных файла принесли один id» — свойство множества файлов, и ловится только тут.
//   2. **Цель ссылки существует** — якорь резолвится против ledger'а и структуры документа.
//      Схема знает форму `sc:opening`, но не знает, есть ли такая сцена (ADR-0004 §9).
//   3. **`gridPoint` отвергается** (ADR-0001): формат не имеет права обещать то, чего нет.
//
// ДИСКА ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ (**M3**). На вход идут уже прочитанные `{filePath, text}`;
// обход дерева `direction/**` — задача CLI (`L-03`). Это то же решение, что у лексера (`C-02`,
// вход — текст) и у ledger'а (`C-04`, вход — текст прежнего файла).
//
// A1 ДЕРЖИТСЯ ТИПОМ, И ЭШЕЛОНОВ ДВА (как в `C-04` §3.8). Первый — схема: `publicAnchor()`
// отвергает `w:` при разборе файла. Второй — граница модели: `at`/`until` объявлены
// `PublicAnchorId`, единственный конструктор которого (`asPublicAnchorId`) валидирует ТОЙ ЖЕ
// формой. Значение с `w:` невыразимо в `DirectionRecord` — это проверяет компилятор. Второй
// эшелон не лишний: значения приходят в модель не только из файлов (порождённая `[img:]`-запись
// — `C-04`, `anchors/img.ts`), а правило A1 — про модель, а не про YAML.
//
// ПОЧЕМУ РЕЗОЛВ ЖИВЁТ ЗДЕСЬ, А НЕ В `CP-01`. Без него «валидация» сводится к проверке формы,
// которую уже сделала схема. Решение владельца (`C-05`, вопрос 7) — здесь, с оговоркой про M3.

import { asPublicAnchorId, parseFamilyText, type AnchorEntry, type Direction } from '@vpe/schema';

import { liveAnchors } from '../anchors/ledger.js';
import type { SourceDocument } from '../source/ast.js';
import { assertRealizable, type TimePoint } from '../time/timepoint.js';
import type { AnchorRef, DirectionRecord, JsonValue, TemplateParams } from './entities.js';
import { ModelError } from './errors.js';

/** Семейство, которого ждёт `parseDirection`. Имя — из реестра `@vpe/schema`. */
export const DIRECTION_FAMILY = 'direction';

/** Уже прочитанный файл режиссуры. Чтение — обязанность вызывающего (**M3**). */
export interface DirectionSource {
  /** Путь, как его покажет ошибка. Разбор зависит от расширения (`.yaml`). */
  readonly filePath: string;
  readonly text: string;
}

/** Разобранный файл режиссуры: записи уже в типах модели, а не в типах схемы. */
export interface DirectionFile {
  readonly filePath: string;
  readonly records: readonly DirectionRecord[];
}

/**
 * Scope записи: `chapterId ‖ sceneId` из формулы seed'а (ADR-0007 §1).
 *
 * `sceneId: null` — запись стоит на якоре ГЛАВЫ (`at: ch:main`): сцены у неё нет. Пустой
 * строкой это не кодируется: пустая строка неотличима от сцены с пустым id, а `canonicalJson`
 * кодирует `null` отдельно — ровно то же рассуждение, по которому `prev`/`next` в `boundTo`
 * объявлены `nullable` (`C-04`, ADR-0004 §6). `INFERENCE`: ADR-0007 §1 пишет формулу для узла
 * внутри сцены и случай «запись на якоре главы» не разбирает; записано в `docs/DEBTS.md`.
 */
export interface Scope {
  readonly chapterId: string;
  readonly sceneId: string | null;
}

/** Запись вместе с адресом (файл) и разрешённым scope. Вход `seedOf`. */
export interface PlacedRecord {
  readonly filePath: string;
  readonly record: DirectionRecord;
  readonly scope: Scope;
}

/**
 * Мир, против которого резолвятся ссылки.
 *
 * `ledger` — записи `anchors.lock.jsonl` (живым считается id, у которого ПОСЛЕДНЯЯ запись
 * `live`, — свёртка `liveAnchors`, `C-04`). `document` — разобранный исходник; нужен ровно для
 * `ch:`, которого в ledger'е нет и быть не может: `anchors/1` требует непустой `sceneId`, а у
 * якоря главы сцены нет (`C-04` §6.2, долг №22).
 */
export interface AnchorWorld {
  readonly ledger: readonly AnchorEntry[];
  readonly document: SourceDocument | null;
}

/** Ссылки на якорь, которые несёт запись. `until` — необязательна. */
function referencesOf(record: DirectionRecord): { field: 'at' | 'until'; ref: AnchorRef }[] {
  const out: { field: 'at' | 'until'; ref: AnchorRef }[] = [{ field: 'at', ref: record.at }];
  if (record.until !== undefined) out.push({ field: 'until', ref: record.until });
  return out;
}

/**
 * `at`/`until` схемы → ссылка модели. Здесь и только здесь `string` становится
 * `PublicAnchorId` (долг №20 закрыт на границе модели — см. `AnchorRef`).
 */
function anchorRef(raw: { readonly anchor: string }, filePath: string, recordId: string): AnchorRef {
  try {
    return { kind: 'anchor', anchor: asPublicAnchorId(raw.anchor) };
  } catch (error) {
    throw new ModelError(
      'A1',
      `ссылка \`${raw.anchor}\` не является публичным якорем. ADR-0004 §2: ни одна ` +
        'direction-запись и ни один override не имеют права ссылаться на `w:` — это внутреннее ' +
        'пространство ledger\'а. Публичные пространства: `b:`/`sc:`/`ch:`/`r:`',
      { file: filePath, recordId, cause: error },
    );
  }
}

/** Запись схемы → запись модели. Единственный переход между слоями. */
function toDirectionRecord(raw: Direction['records'][number], filePath: string): DirectionRecord {
  const base = {
    recordId: raw.recordId,
    at: anchorRef(raw.at, filePath, raw.recordId),
    ...(raw.until === undefined ? {} : { until: anchorRef(raw.until, filePath, raw.recordId) }),
  };
  return raw.track === 'voice'
    ? { ...base, track: 'voice', voiceRole: raw.voiceRole }
    : { ...base, track: raw.track, z: raw.z, template: raw.template, params: raw.params };
}

/**
 * Разбирает один файл режиссуры и переводит его записи в типы модели.
 *
 * @throws {FamilyReadError} нет шапки, не то семейство, битый YAML (`@vpe/schema`).
 * @throws {z.ZodError} тело не соответствует `direction/1` — с путём к полю.
 * @throws {ModelError} A1 — ссылка на `w:` (второй эшелон; схема ловит первой).
 */
export function parseDirection(source: DirectionSource): DirectionFile {
  const { value } = parseFamilyText(source.text, source.filePath, { expectFamily: DIRECTION_FAMILY });
  const direction = value as Direction;
  return {
    filePath: source.filePath,
    records: direction.records.map((raw) => toDirectionRecord(raw, source.filePath)),
  };
}

// ── `gridPoint`: принимается схемой, отвергается валидатором ────────────────

/**
 * Три имени варианта `TimePoint` (ADR-0001). Значение с любым из них — момент времени,
 * куда бы оно ни было записано.
 */
const TIME_POINT_KINDS = new Set(['anchor', 'mediaTime', 'gridPoint']);

/**
 * **ВРЕМЕННАЯ МЕРА, И ЭТО ЗАФИКСИРОВАНО** (решение владельца, `C-05` вопрос 5;
 * `docs/DEBTS.md`, адрес `TS-01`).
 *
 * ГДЕ `gridPoint` ВООБЩЕ ПРИНИМАЕТСЯ СХЕМОЙ. В `direction/1` поля `at`/`until` — это
 * `AnchorPointSchema.strict()`, только `kind: anchor`: туда `gridPoint` не проходит вовсе.
 * Единственный путь, которым он реально доезжает из файла в модель, — `params`
 * (`z.record(JsonValueSchema)`), и в фикстуре ровно там лежит момент времени:
 * `inPoint: { kind: mediaTime, asset: "pad-loop", offsetSamples: 96000 }`.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ЧТО НЕТ. Проверяется ровно одно: не является ли встреченное
 * значение `gridPoint`. Контракт `params` — обязанность **манифеста шаблона** (`TS-01`), и
 * второй его копии здесь нет: `anchor` и `mediaTime` проходят через `assertRealizable` как
 * есть, поля их не сверяются, лишние ключи не запрещаются. Когда манифест появится, этот
 * скан заменяется контрактом параметров.
 *
 * СУДИТ НЕ ЭТА ФУНКЦИЯ, А `assertRealizable` (`C-01`). Отказ живёт в одном месте: схема
 * стережёт файл, ассерт — значение, дошедшее до модели, откуда бы оно ни пришло.
 */
function assertNoGridPoint(value: JsonValue, path: string, filePath: string, recordId: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { assertNoGridPoint(item, `${path}[${String(index)}]`, filePath, recordId); });
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const kind = (value as { readonly kind?: unknown }).kind;
  if (typeof kind === 'string' && TIME_POINT_KINDS.has(kind)) {
    try {
      assertRealizable(value as unknown as TimePoint);
    } catch (error) {
      throw new ModelError(
        'ADR-0001 gridPoint',
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
        { file: filePath, recordId, cause: error },
      );
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    assertNoGridPoint(nested, `${path}.${key}`, filePath, recordId);
  }
}

/** Обход `params` записи. У директивной записи `voice` параметров нет — обходить нечего. */
function assertParamsRealizable(record: DirectionRecord, filePath: string): void {
  if (record.track === 'voice') return;
  const params: TemplateParams = record.params;
  for (const [key, value] of Object.entries(params)) {
    assertNoGridPoint(value, `params.${key}`, filePath, record.recordId);
  }
}

// ── Резолв ссылок ───────────────────────────────────────────────────────────

/** Пространство имён якоря: `b:`/`sc:`/`ch:`/`r:` (ADR-0004 §1). */
function namespaceOf(anchor: string): string {
  return anchor.slice(0, anchor.indexOf(':'));
}

/** Имя внутри пространства: `ch:main` → `main`. */
function nameOf(anchor: string): string {
  return anchor.slice(anchor.indexOf(':') + 1);
}

interface Resolver {
  readonly live: ReadonlyMap<string, AnchorEntry>;
  readonly chapters: ReadonlySet<string>;
  readonly byRecordId: ReadonlyMap<string, { readonly record: DirectionRecord; readonly filePath: string }>;
  readonly hasDocument: boolean;
}

function unknownAnchor(anchor: string, filePath: string, recordId: string, why: string): ModelError {
  return new ModelError(
    'ADR-0004 §9',
    `ссылка \`${anchor}\` не разрешается: ${why}. Переименование сцен пока не автоматизировано ` +
      '— верни прежний id или удали ссылку',
    { file: filePath, recordId },
  );
}

/**
 * Резолв одной ссылки в scope.
 *
 * ЧЕТЫРЕ ПРОСТРАНСТВА — ТРИ РАЗНЫХ ИСТОЧНИКА, и это не разнобой, а следствие того, где живёт
 * каждое имя:
 *   * `b:` и `sc:` минтит ledger (`C-04`, `slots.ts`) — резолв по свёртке `liveAnchors`;
 *   * `ch:` в ledger НЕ пишется (`anchors/1` требует непустой `sceneId`, а у главы сцены нет)
 *     — резолв по структуре AST, как и записано в `C-04` §6.2 (долг №22);
 *   * `r:` — это запись режиссуры, она живёт в `direction/*.yaml`, а не в прозе, и в ledger не
 *     попадает вовсе (`slots.ts`: «пятое пространство `r:` сюда не попадает»). Резолв — по
 *     множеству `recordId` разобранных записей; scope такой ссылки = scope записи, на которую
 *     она указывает. **`INFERENCE`:** связь `r:<recordId>` ADR-0004 §1 прямо не записывает,
 *     она называет только пространство. Решение владельца (`C-05` вопрос 7): резолвить с
 *     пометкой и долгом, потому что валидатор, молчащий про один вид якорей, хуже, чем
 *     `INFERENCE` с записью.
 */
function resolveAnchor(
  anchor: string,
  filePath: string,
  recordId: string,
  resolver: Resolver,
  seen: ReadonlySet<string>,
): Scope {
  const entry = resolver.live.get(anchor);
  if (entry !== undefined) return { chapterId: entry.chapterId, sceneId: entry.sceneId };

  const namespace = namespaceOf(anchor);

  if (namespace === 'ch') {
    if (!resolver.hasDocument) {
      throw unknownAnchor(anchor, filePath, recordId, 'ссылки `ch:` резолвятся по структуре документа, а документ не подан');
    }
    if (resolver.chapters.has(nameOf(anchor))) return { chapterId: nameOf(anchor), sceneId: null };
    throw unknownAnchor(anchor, filePath, recordId, `главы \`${nameOf(anchor)}\` в документе нет`);
  }

  if (namespace === 'r') {
    const target = resolver.byRecordId.get(nameOf(anchor));
    if (target === undefined) {
      throw unknownAnchor(anchor, filePath, recordId, `записи режиссуры \`${nameOf(anchor)}\` нет ни в одном поданном файле`);
    }
    if (seen.has(anchor)) {
      throw unknownAnchor(anchor, filePath, recordId, `ссылки \`r:\` образуют цикл (${[...seen, anchor].join(' → ')})`);
    }
    return resolveAnchor(target.record.at.anchor, target.filePath, target.record.recordId, resolver, new Set([...seen, anchor]));
  }

  throw unknownAnchor(anchor, filePath, recordId, 'такого живого якоря нет в ledger\'е');
}

// ── Валидация проекта целиком ───────────────────────────────────────────────

/**
 * **D3 — `recordId` уникальны в пределах ПРОЕКТА** (ADR-0007 §1, Consequences: «дубликат
 * `recordId` = ошибка компиляции, иначе копипаста записи режиссуры даст два узла с одним
 * seed'ом»).
 *
 * Сообщение называет ОБА пути: дубль в двух файлах — это, как правило, копипаста, и человеку
 * нужно увидеть, откуда и куда.
 */
function assertUniqueRecordIds(files: readonly DirectionFile[]): Map<string, { record: DirectionRecord; filePath: string }> {
  const byId = new Map<string, { record: DirectionRecord; filePath: string }>();
  for (const file of files) {
    for (const record of file.records) {
      const previous = byId.get(record.recordId);
      if (previous !== undefined) {
        throw new ModelError(
          'D3',
          `\`recordId\` \`${record.recordId}\` встречается дважды: \`${previous.filePath}\` и ` +
            `\`${file.filePath}\`. Он — вход seed'а (ADR-0007 §1), поэтому две записи с одним id ` +
            'дают два узла с одной случайностью; id выдаёт CLI при создании записи',
          { file: file.filePath, recordId: record.recordId },
        );
      }
      byId.set(record.recordId, { record, filePath: file.filePath });
    }
  }
  return byId;
}

/**
 * Семантическая валидация всех файлов режиссуры проекта.
 *
 * Порядок проверок — от общего к частному, и он существенен: дубль `recordId` обязан быть
 * назван раньше, чем «неизвестный якорь» у одной из двух одинаково названных записей.
 *
 * @returns записи с разрешённым scope — вход `seedOf`.
 * @throws {ModelError} D3, A1, `gridPoint`, неразрешённая ссылка.
 */
export function validateDirection(files: readonly DirectionFile[], world: AnchorWorld): PlacedRecord[] {
  const byRecordId = assertUniqueRecordIds(files);
  const resolver: Resolver = {
    live: liveAnchors(world.ledger),
    chapters: new Set((world.document?.chapters ?? []).map((chapter) => chapter.id)),
    byRecordId,
    hasDocument: world.document !== null,
  };

  const out: PlacedRecord[] = [];
  for (const file of files) {
    for (const record of file.records) {
      assertParamsRealizable(record, file.filePath);
      let scope: Scope | null = null;
      for (const { field, ref } of referencesOf(record)) {
        const resolved = resolveAnchor(ref.anchor, file.filePath, record.recordId, resolver, new Set());
        if (field === 'at') scope = resolved;
      }
      if (scope === null) throw new ModelError('ADR-0004 §9', 'у записи нет `at`', { file: file.filePath, recordId: record.recordId });
      out.push({ filePath: file.filePath, record, scope });
    }
  }
  return out;
}

/**
 * Разбор + валидация одним вызовом — форма, которой будет пользоваться CLI (`L-03`).
 *
 * @throws {FamilyReadError | z.ZodError | ModelError}
 */
export function readDirection(sources: readonly DirectionSource[], world: AnchorWorld): PlacedRecord[] {
  return validateDirection(sources.map(parseDirection), world);
}
