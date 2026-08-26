// Канонический писатель и проверка каноничности (ADR-0005 §4, §9; инварианты P9, P17).
//
// ДВА РАЗНЫХ КАНОНА, И ИХ НЕЛЬЗЯ ПУТАТЬ — это записано и в `CANONICAL.md`:
//
//   `canonicalJson` (`S-01`)  — вход ХЭША. Ключи сортированы БАЙТАМИ UTF-8, пробелов нет,
//                               комментариев нет и быть не может. Читает машина.
//   `writeFamily`   (`S-02`)  — файл в git. Ключи в порядке ОБЪЯВЛЕНИЯ В СХЕМЕ, отступы есть,
//                               идентификаторы в кавычках. Читает человек и ревьюит в диффе.
//
// Алфавитный порядок в файле формата был бы прямым вредом: `width` уехал бы от `height`,
// а `fps` — в середину списка. Порядок объявления в схеме — это порядок, в котором величины
// объяснены в ADR, и он же порядок, в котором их читает человек.
//
// ЧЕГО ПИСАТЕЛЬ НЕ УМЕЕТ — КОММЕНТАРИЕВ. Он их не сохраняет и не может: он строит текст из
// значения, а в значении комментариев нет. Практическое следствие записано в отчёте `S-02`
// и в `CANONICAL.md`: `fixtures/minimal` НЕ каноничны, и приводить их к канону нельзя, не
// потеряв ~200 строк объяснений со ссылками на ADR. Вопрос «канон обязан уметь комментарии»
// адресован владельцу и решается в `L-03` вместе с `vpe fmt`.

import { readFileSync } from 'node:fs';

import { parseDocument, isMap, isScalar, isSeq, type Document } from 'yaml';
import type { z } from 'zod';

import { jsonQuote } from './canonical/json.js';
import { isIdentifier } from './families/marks.js';
import { FAMILIES, type FamilyEntry } from './registry.js';
import { readFamily } from './read.js';

export class FamilyWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FamilyWriteError';
  }
}

// ── Порядок ключей и пометки: и то и другое берётся ИЗ СХЕМЫ ───────────────────────────────

interface ObjectShape {
  readonly keys: readonly string[];
  readonly fields: ReadonlyMap<string, unknown>;
}

/** Разворачивает обёртки (`optional`, `nullable`, `lazy`) до узла, у которого есть форма. */
function unwrap(node: unknown): unknown {
  if (node === undefined || node === null) return undefined;
  let current: unknown = node;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = (current as { _zod?: { def?: { type?: string } } })._zod?.def;
    if (def?.type === 'optional' || def?.type === 'nullable') {
      current = (current as { unwrap: () => unknown }).unwrap();
      continue;
    }
    if (def?.type === 'lazy') {
      current = (current as { _zod: { def: { getter: () => unknown } } })._zod.def.getter();
      continue;
    }
    return current;
  }
  return current;
}

/**
 * Форма объекта: порядок ключей — это порядок объявления в `z.object({…})`, потому что
 * `Object.keys` сохраняет порядок вставки. Отдельного списка не заводится, и это существенно:
 * список разъехался бы со схемой при первой же правке.
 *
 * Для union (в том числе `discriminatedUnion` семейства `direction/1`) ветка выбирается по
 * значению: подходит та, чей `safeParse` прошёл. Это единственный честный способ — у веток
 * разные наборы полей и разный порядок.
 */
function shapeFor(node: unknown, value: unknown): ObjectShape | null {
  const target = unwrap(node);
  if (target === undefined || target === null) return null;
  const def = (target as { _zod?: { def?: { type?: string; options?: unknown[]; shape?: Record<string, unknown> } } })._zod?.def;
  if (def === undefined) return null;

  if (def.type === 'union' && Array.isArray(def.options)) {
    for (const option of def.options) {
      if ((option as z.ZodType).safeParse(value).success) return shapeFor(option, value);
    }
    return null;
  }
  if (def.type === 'object' && def.shape !== undefined) {
    const shape = def.shape;
    return { keys: Object.keys(shape), fields: new Map(Object.entries(shape)) };
  }
  return null;
}

/** Элемент массива по схеме — чтобы дети списка тоже получили порядок и пометки. */
function elementOf(node: unknown): unknown {
  const target = unwrap(node);
  if (target === undefined || target === null) return undefined;
  const def = (target as { _zod?: { def?: { type?: string; element?: unknown; valueType?: unknown } } })._zod?.def;
  if (def?.type === 'array') return def.element;
  return undefined;
}

/** Тип значений открытой карты (`z.record`, `.catchall`) — у `aliases/1` и `params`. */
function valueTypeOf(node: unknown): unknown {
  const target = unwrap(node);
  if (target === undefined || target === null) return undefined;
  const def = (target as { _zod?: { def?: { type?: string; valueType?: unknown; catchall?: unknown } } })._zod?.def;
  if (def?.type === 'record') return def.valueType;
  return def?.catchall;
}

// ── Эмиттер ────────────────────────────────────────────────────────────────────────────────

/**
 * Нужны ли строке кавычки, даже если она не помечена идентификатором.
 *
 * Это защита P16 со стороны писателя: `no`, `yes`, `08`, `1.20`, `04:30`, `~`, пустая строка
 * без кавычек вернутся из YAML не строками. Читатель ловит такое как ошибку типа; писатель
 * обязан просто не создавать таких файлов.
 */
function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (value !== value.trim()) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/[:#]\s|\n|\t/.test(value)) return true;
  // Всё, что YAML 1.2 core прочитает не строкой.
  if (/^(true|false|null|~)$/i.test(value)) return true;
  if (/^[-+]?([0-9]+|[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+)$/.test(value)) return true;
  // Ловушки YAML 1.1, которые читатель не примет, но человек может написать руками.
  if (/^(yes|no|on|off|y|n)$/i.test(value)) return true;
  if (/^[0-9]+(:[0-9]{2})+$/.test(value)) return true;
  return false;
}

/**
 * Экранирование строки берётся из `canonical/json.ts` — единственного файла, которому линт
 * разрешает `JSON.stringify`. Свой `JSON.stringify` здесь был бы вторым исключением и заодно
 * разрешил бы сериализацию объектов ЧУЖИМ порядком ключей (алфавитным), а у файла формата
 * порядок другой — объявления в схеме.
 */
function quote(value: string): string {
  return jsonQuote(value);
}

function emitScalar(value: unknown, forceQuotes: boolean): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return forceQuotes || needsQuotes(value) ? quote(value) : value;
  throw new FamilyWriteError(`значение типа ${typeof value} не выразимо в каноническом YAML`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalarValue(value: unknown): boolean {
  return !isPlainObject(value) && !Array.isArray(value);
}

/** Ключи объекта: сперва объявленные схемой (в её порядке), потом остальные — байтами UTF-8. */
function orderedKeys(value: Record<string, unknown>, shape: ObjectShape | null): string[] {
  const present = new Set(Object.keys(value));
  const declared = shape === null ? [] : shape.keys.filter((key) => present.has(key));
  const rest = [...present].filter((key) => !declared.includes(key)).sort();
  return [...declared, ...rest];
}

function emitValue(value: unknown, node: unknown, indent: string, out: string[]): void {
  if (Array.isArray(value)) {
    const element = elementOf(node);
    for (const item of value) {
      if (isScalarValue(item)) {
        out.push(`${indent}- ${emitScalar(item, isIdentifier(element))}`);
      } else {
        out.push(`${indent}-`);
        emitValue(item, element, `${indent}  `, out);
      }
    }
    return;
  }

  if (isPlainObject(value)) {
    const shape = shapeFor(node, value);
    const fallback = valueTypeOf(node);
    for (const key of orderedKeys(value, shape)) {
      const child = value[key];
      const childNode = shape?.fields.get(key) ?? fallback;
      if (isScalarValue(child)) {
        out.push(`${indent}${key}: ${emitScalar(child, isIdentifier(childNode))}`);
      } else if (Array.isArray(child) && child.length === 0) {
        out.push(`${indent}${key}: []`);
      } else if (isPlainObject(child) && Object.keys(child).length === 0) {
        out.push(`${indent}${key}: {}`);
      } else {
        out.push(`${indent}${key}:`);
        emitValue(child, childNode, Array.isArray(child) ? indent : `${indent}  `, out);
      }
    }
    return;
  }

  throw new FamilyWriteError('на верхнем уровне ожидались маппинг или список');
}

/**
 * Канонический JSON ДЛЯ ФАЙЛА — не путать с `canonicalJson` (`S-01`).
 *
 * Отличие ровно одно и оно принципиально: здесь ключи идут **в порядке объявления в схеме**,
 * а у `canonicalJson` — байтами UTF-8. Первый порядок читает человек в диффе, второй уходит
 * в хэш. Поэтому это два разных алгоритма, а не один с флагом.
 *
 * @param indent `null` — компактная запись в одну строку (запись JSONL); строка — отступ.
 */
function emitJson(value: unknown, node: unknown, indent: string | null): string {
  const step = indent === null ? '' : `${indent}  `;
  const newline = indent === null ? '' : '\n';
  const space = indent === null ? '' : ' ';

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return quote(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const element = elementOf(node);
    const items = value.map((item) => `${step}${emitJson(item, element, indent === null ? null : step)}`);
    return `[${newline}${items.join(`,${newline}`)}${newline}${indent ?? ''}]`;
  }

  if (isPlainObject(value)) {
    const shape = shapeFor(node, value);
    const fallback = valueTypeOf(node);
    const keys = orderedKeys(value, shape);
    if (keys.length === 0) return '{}';
    const items = keys.map((key) => {
      const child = emitJson(value[key], shape?.fields.get(key) ?? fallback, indent === null ? null : step);
      return `${step}${quote(key)}:${space}${child}`;
    });
    return `{${newline}${items.join(`,${newline}`)}${newline}${indent ?? ''}}`;
  }

  throw new FamilyWriteError(`значение типа ${typeof value} не выразимо в каноническом JSON`);
}

// ── Публичное ──────────────────────────────────────────────────────────────────────────────

function entryFor(family: string): FamilyEntry {
  const entry = FAMILIES.get(family);
  if (entry === undefined) throw new FamilyWriteError(`семейство \`${family}\` неизвестно`);
  if (!entry.writable) {
    throw new FamilyWriteError(
      `семейство \`${family}\` не записывается: его схема — только шапка, тело читает лексер. ` +
        'Писатель уничтожил бы тело файла (M7, ADR-0005 §4)',
    );
  }
  return entry;
}

/**
 * Каноническая форма файла семейства как текст. Значение обязано пройти схему семейства —
 * писатель не создаёт файлов, которые читатель отвергнет.
 */
export function renderFamily(family: string, value: unknown): string {
  const entry = entryFor(family);
  const schema = entry.versions.get(entry.current);
  if (schema === undefined) throw new FamilyWriteError(`у семейства \`${family}\` нет текущей версии`);

  if (entry.format === 'jsonl') {
    // Шапка первой строкой отдельным объектом; дальше — запись на строку (ADR-0005 §10).
    const records = Array.isArray(value) ? value : [];
    const head = `{${quote('schema')}:${quote(`${family}/${String(entry.current)}`)}}`;
    const body = records.map((record) => emitJson(schema.parse(record), schema, null));
    return [head, ...body, ''].join('\n');
  }

  const parsed: unknown = schema.parse(value);
  if (!isPlainObject(parsed)) throw new FamilyWriteError('ожидался маппинг верхнего уровня');

  if (entry.format === 'json') {
    // JSON пишет CLI, человек его не редактирует ⇒ порядок ключей тот же, что у YAML
    // (объявление в схеме), отступ два пробела, перевод строки в конце.
    return `${emitJson(parsed, schema, '')}\n`;
  }

  const out: string[] = [];
  emitValue(parsed, schema, '', out);
  return `${out.join('\n')}\n`;
}

/** Каноническая форма файла, прочитанного с диска. */
export function canonicalTextOf(filePath: string): string {
  const { header, value } = readFamily(filePath);
  return renderFamily(header.family, value);
}

// ── checkCanonical ─────────────────────────────────────────────────────────────────────────

export type DifferenceKind =
  | 'comment'
  | 'key-order'
  | 'identifier-quoting'
  | 'trailing-whitespace'
  | 'other';

export interface Difference {
  readonly kind: DifferenceKind;
  /** Номер строки исходного файла, 1-based; `null` — расхождение не привязано к строке. */
  readonly line: number | null;
  readonly message: string;
}

export interface CanonicalReport {
  readonly filePath: string;
  readonly family: string;
  readonly canonical: boolean;
  readonly differences: readonly Difference[];
  /**
   * Какие проверки РЕАЛЬНО выполнялись на этом файле.
   *
   * Поле существует, чтобы зелёный отчёт нельзя было прочитать шире, чем он есть: у
   * `source-dialect/1` тело — проза, и из четырёх проверок применима одна (хвостовые пробелы).
   * Без этого списка `canonical: true` на сценарии выглядел бы как «файл каноничен целиком».
   */
  readonly checks: readonly DifferenceKind[];
}

/** Комментарии в YAML — по узлам документа, а не грепом по `#`: `#` бывает внутри строки. */
function collectComments(document: Document): Difference[] {
  const out: Difference[] = [];
  const seen = (node: unknown): void => {
    const anyNode = node as { comment?: string | null; commentBefore?: string | null };
    if (anyNode.commentBefore != null || anyNode.comment != null) {
      out.push({
        kind: 'comment',
        line: null,
        message: 'комментарий: канонический писатель его не сохраняет',
      });
    }
  };
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    seen(node);
    if (isMap(node)) {
      for (const item of node.items) {
        seen(item.key);
        seen(item.value);
        walk(item.value);
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) walk(item);
    }
  };
  if (document.commentBefore != null || document.comment != null) {
    out.push({ kind: 'comment', line: null, message: 'комментарий документа: писатель его не сохраняет' });
  }
  walk(document.contents);
  return out;
}

/** Номер строки по смещению в тексте — чтобы `vpe fmt --check` показывал место, а не только путь. */
function lineOf(text: string, range: readonly number[] | null | undefined): number | null {
  const start = range?.[0];
  if (start === undefined) return null;
  let line = 1;
  for (let i = 0; i < start && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** Идентификаторы без кавычек — по типу узла (`PLAIN` против `QUOTE_*`), а не по содержимому. */
function collectQuoting(document: Document, text: string, schema: z.ZodType, value: unknown): Difference[] {
  const out: Difference[] = [];
  const walk = (node: unknown, schemaNode: unknown, currentValue: unknown, path: string): void => {
    if (isMap(node) && isPlainObject(currentValue)) {
      const shape = shapeFor(schemaNode, currentValue);
      const fallback = valueTypeOf(schemaNode);
      for (const item of node.items) {
        const key = isScalar(item.key) ? String(item.key.value) : '';
        const childSchema = shape?.fields.get(key) ?? fallback;
        const childValue = currentValue[key];
        const childPath = path === '' ? key : `${path}.${key}`;
        // `typeof … === 'string'` обязательно: `lastVerifiedAt: null` — тоже PLAIN-скаляр
        // у поля, помеченного идентификатором, но `null` кавычек не требует и не терпит.
        if (
          isScalar(item.value)
          && typeof item.value.value === 'string'
          && isIdentifier(childSchema)
          && item.value.type === 'PLAIN'
        ) {
          out.push({
            kind: 'identifier-quoting',
            line: lineOf(text, item.value.range),
            message: `\`${childPath}\` — идентификатор, а записан без кавычек (P17)`,
          });
        }
        walk(item.value, childSchema, childValue, childPath);
      }
      return;
    }
    if (isSeq(node) && Array.isArray(currentValue)) {
      const element = elementOf(schemaNode);
      node.items.forEach((item, index) => {
        if (isScalar(item) && typeof item.value === 'string' && isIdentifier(element) && item.type === 'PLAIN') {
          out.push({
            kind: 'identifier-quoting',
            line: lineOf(text, item.range),
            message: `\`${path}[${String(index)}]\` — идентификатор, а записан без кавычек (P17)`,
          });
        }
        walk(item, element, currentValue[index], `${path}[${String(index)}]`);
      });
    }
  };
  walk(document.contents, schema, value, '');
  return out;
}

/** Порядок ключей — сравнение с порядком объявления в схеме, на всех уровнях. */
function collectKeyOrder(schema: z.ZodType, value: unknown): Difference[] {
  const out: Difference[] = [];
  const walk = (schemaNode: unknown, currentValue: unknown, path: string): void => {
    if (isPlainObject(currentValue)) {
      const shape = shapeFor(schemaNode, currentValue);
      const actual = Object.keys(currentValue);
      const expected = orderedKeys(currentValue, shape);
      if (actual.join('\u0000') !== expected.join('\u0000')) {
        out.push({
          kind: 'key-order',
          line: null,
          message: `порядок ключей в \`${path === '' ? '<корень>' : path}\`: ${actual.join(', ')} ⇒ ${expected.join(', ')}`,
        });
      }
      const fallback = valueTypeOf(schemaNode);
      for (const key of actual) {
        walk(shape?.fields.get(key) ?? fallback, currentValue[key], path === '' ? key : `${path}.${key}`);
      }
      return;
    }
    if (Array.isArray(currentValue)) {
      const element = elementOf(schemaNode);
      currentValue.forEach((item, index) => { walk(element, item, `${path}[${String(index)}]`); });
    }
  };
  walk(schema, value, '');
  return out;
}

/**
 * Чем файл отличается от своей канонической формы. Основа `vpe fmt --check` (`L-03`);
 * сама команда здесь не пишется.
 *
 * Все четыре проверки МЕХАНИЧЕСКИЕ: комментарии и кавычки берутся из дерева документа
 * (`YAML.parseDocument` даёт тип каждого скаляра), порядок ключей — из схемы, хвостовые
 * пробелы — из текста. Ни одной эвристики «похоже на …».
 */
export function checkCanonical(filePath: string): CanonicalReport {
  const { header, entry, value } = readFamily(filePath);
  const text = readFileSync(filePath, 'utf8');
  const differences: Difference[] = [];
  const checks: DifferenceKind[] = ['trailing-whitespace'];

  text.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      differences.push({
        kind: 'trailing-whitespace',
        line: index + 1,
        message: 'хвостовые пробелы',
      });
    }
  });

  if (entry.format === 'yaml') {
    const document = parseDocument(text);
    const schema = entry.versions.get(header.version);
    checks.push('comment');
    differences.push(...collectComments(document));
    if (schema !== undefined) {
      checks.push('identifier-quoting', 'key-order');
      differences.push(...collectQuoting(document, text, schema, value));
      differences.push(...collectKeyOrder(schema, value));
    }
  }

  if (entry.writable) {
    checks.push('other');
    const canonical = renderFamily(header.family, value);
    if (canonical !== text && differences.length === 0) {
      differences.push({
        kind: 'other',
        line: null,
        message: 'текст отличается от канонического (отступы, пробелы или форма скаляров)',
      });
    }
  }

  return {
    filePath,
    family: header.family,
    canonical: differences.length === 0,
    differences,
    checks,
  };
}
