// **ИНТРОСПЕКЦИЯ `paramsSchema` — ЕДИНСТВЕННЫЙ ЗАКОННЫЙ СПОСОБ ВЫГРУЗИТЬ ПАРАМЕТРЫ ШАБЛОНА.**
//
// ЗАЧЕМ ФАЙЛ СУЩЕСТВУЕТ. `vpe spec export` (`SPEC-01`) отдаёт ИИ-сценаристу правила игры, и
// половина этих правил — форма `params` семи шаблонов. Переписать её руками означало бы
// завести ВТОРОЙ ИСТОЧНИК ИСТИНЫ рядом со схемой (долг №179): первая же правка диапазона
// разошлась бы с текстом выгрузки молча, и ИИ писал бы по устаревшей спецификации, а
// компилятор отвергал бы результат. Поэтому здесь нет ни одного литерала про параметры —
// только чтение схем.
//
// ПОЧЕМУ ЭТО ЛЕЖИТ В `templates-spec`, А НЕ В `cli`. Схемы — собственность этого пакета, zod
// — его зависимость, и разбор внутренностей схемы обязан жить рядом со схемой. В `cli` zod
// не резолвится вовсе, и тащить его туда ради интроспекции значило бы менять лок.
//
// **ДВЕ ПОЛОВИНЫ, И ВТОРАЯ СУЩЕСТВУЕТ ПОТОМУ, ЧТО ПЕРВОЙ НЕ ХВАТАЕТ.** `z.toJSONSchema`
// печатает то, что выразимо в JSON Schema: типы, enum'ы, `minimum`/`maximum`, обязательность,
// `additionalProperties: false`. Проверки, заданные через `.refine`, в неё НЕ попадают —
// измерено на `parallax25@1`: `drift` с диапазоном `[0, 0.2]` выгружается голым
// `{"type":"number"}`. Три поля этого шаблона и шесть полей `kenburns@1` держат границы
// именно там, то есть выгрузка недоговаривала бы ровно про те числа, в которые ИИ упрётся
// первым отказом. Вторая половина достаёт ТЕКСТ САМОГО ОТКАЗА из чека — ту строку, которую
// вернёт схема, — и второго источника истины по-прежнему не появляется.
//
// ГРАНИЦА ПАКЕТА НЕ ТРОНУТА: обе функции ЧИСТЫ (ни диска, ни сети, ни часов), как и три
// декларации спека, и падают под тот же греп-охранник `node:fs`/сеть.

import { z } from 'zod';

import type { AnyTemplateSpec } from './spec.js';

/**
 * Одна проверка `params`, **не выразимая в JSON Schema**, — с адресом и собственным текстом.
 *
 * `path` — путь к полю точкой (`from.scale`), `[]` для элемента массива (`layers[]`), пустая
 * строка — проверка ВСЕГО объекта `params` (перекрёстная: у `bed@1` это «`inPoint.asset`
 * обязан совпасть с `asset`»).
 */
export interface ParamRefinement {
  readonly path: string;
  /** Тексты отказов — ровно те, что вернёт схема. Ничего не выдумано и не переписано. */
  readonly messages: readonly string[];
  /**
   * Сколько проверок стоит на этом адресе ВСЕГО — включая те, что своего текста не имеют.
   *
   * **`checks > messages.length` — ЭТО ИЗМЕРЕНИЕ, А НЕ ПОГРЕШНОСТЬ.** `superRefine` строит
   * текст отказа ВНУТРИ тела, через `ctx.addIssue`, и снаружи его не существует: у `bed@1`
   * так задана единственная перекрёстная проверка («`inPoint.asset` обязан совпасть с
   * `asset`»). Выгрузка обязана сказать, что проверка ЕСТЬ, — иначе ИИ прочтёт её отсутствие
   * как разрешение, — и обязана не выдумывать её текст.
   */
  readonly checks: number;
}

/** Форма `params` шаблона: машинная схема плюс то, чего схема выразить не умеет. */
export interface ParamsIntrospection {
  /** `z.toJSONSchema(paramsSchema, { io: 'input' })` — вход, а не выход: автор пишет ВХОД. */
  readonly jsonSchema: unknown;
  /** Проверки `.refine`/`.superRefine` по адресам. Пусто у шаблона без них. */
  readonly refinements: readonly ParamRefinement[];
}

/** Внутренности zod, которые здесь читаются. Ни одна из них не является публичным API. */
interface ZodInternals {
  readonly _zod: { readonly def: ZodDef };
}

interface ZodDef {
  readonly type: string;
  readonly checks?: readonly ZodCheck[];
  readonly shape?: Readonly<Record<string, unknown>>;
  readonly innerType?: unknown;
  readonly element?: unknown;
  readonly options?: readonly unknown[];
  readonly in?: unknown;
  readonly out?: unknown;
}

interface ZodCheck {
  readonly _zod: {
    readonly def: {
      readonly check: string;
      readonly error?: unknown;
    };
  };
}

/** Узел ли это zod-схемы. Проверка формы, а не `instanceof`: типов узлов десятки. */
function defOf(node: unknown): ZodDef | null {
  if (typeof node !== 'object' || node === null) return null;
  const candidate = node as Partial<ZodInternals>;
  const def = candidate._zod?.def;
  return typeof def === 'object' && def !== null && typeof def.type === 'string' ? def : null;
}

/**
 * Текст одного чека — вызовом его собственной `error`, а не копированием.
 *
 * zod нормализует второй аргумент `.refine(fn, 'текст')` в функцию `(issue) => string`; здесь
 * она вызывается с пустой заготовкой issue. Функция, зависящая от `issue.input` (такой у нас
 * нет), вернула бы текст со словом `undefined` — это видно глазами в выгрузке и честнее, чем
 * подставить сюда выдуманное значение.
 */
function messageOf(check: ZodCheck): string | null {
  const { error } = check._zod.def;
  if (typeof error === 'string') return error;
  if (typeof error !== 'function') return null;
  try {
    const text: unknown = (error as (issue: { input: unknown; code: string; path: readonly PropertyKey[] }) => unknown)({
      input: undefined,
      code: 'custom',
      path: [],
    });
    return typeof text === 'string' ? text : null;
  } catch {
    // Чек, чей текст построен по значению, своего текста БЕЗ значения не имеет. Молчание
    // здесь честнее выдумки: строка адреса всё равно попадёт в выгрузку, без текста.
    return null;
  }
}

/** Проверки узла, не выразимые в JSON Schema. `custom` — это и есть `.refine`/`.superRefine`. */
function customChecks(def: ZodDef): { readonly messages: readonly string[]; readonly checks: number } {
  const messages: string[] = [];
  let checks = 0;
  for (const check of def.checks ?? []) {
    if (check._zod.def.check !== 'custom') continue;
    checks += 1;
    const text = messageOf(check);
    if (text !== null) messages.push(text);
  }
  return { messages, checks };
}

/** Обход схемы вглубь. Ветвление по `def.type` — закрытым списком: неизвестный узел не углубляется. */
function walk(node: unknown, path: string, found: ParamRefinement[]): void {
  const def = defOf(node);
  if (def === null) return;

  const { messages, checks } = customChecks(def);
  if (checks > 0) {
    const index = found.findIndex((item) => item.path === path);
    const at = found[index];
    if (at === undefined) found.push({ path, messages, checks });
    else {
      found.splice(index, 1, {
        path,
        messages: [...at.messages, ...messages],
        checks: at.checks + checks,
      });
    }
  }

  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        walk(child, path === '' ? key : `${path}.${key}`, found);
      }
      return;
    case 'array':
      walk(def.element, `${path}[]`, found);
      return;
    case 'union':
      for (const option of def.options ?? []) walk(option, path, found);
      return;
    case 'pipe':
      walk(def.in, path, found);
      walk(def.out, path, found);
      return;
    case 'optional':
    case 'nullable':
    case 'nonoptional':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
      walk(def.innerType, path, found);
      return;
    default:
      return;
  }
}

/**
 * Форма `params` одного шаблона — **интроспекцией, без единого литерала**.
 *
 * @throws {Error} схема содержит форму, невыразимую в JSON Schema (`z.toJSONSchema`). Ни одна
 * из семи такой формы не содержит; восьмая, содержащая, обязана упасть громко — молчаливая
 * выгрузка «параметров нет» была бы хуже отказа команды.
 */
export function introspectParams(spec: AnyTemplateSpec): ParamsIntrospection {
  const refinements: ParamRefinement[] = [];
  walk(spec.paramsSchema, '', refinements);
  return {
    jsonSchema: z.toJSONSchema(spec.paramsSchema, { io: 'input' }),
    refinements,
  };
}
