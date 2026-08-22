// Толерантный читатель семейств (ADR-0005 §4). ОДНА функция на все семейства.
//
// ЧТО ЗАМЕНЯЕТ. В `R-02` чтение шапки было заглушкой внутри `render-profile.ts`
// (`assertHeader`: `split('/')` и строгое равенство). Заглушка снесена целиком, как и было
// записано в её собственном комментарии; `loadRenderProfile` теперь обёртка над `readFamily`.
//
// ПОЧЕМУ ШАПКА ЧИТАЕТСЯ ОТДЕЛЬНЫМ ШАГОМ, хотя `schema:` есть и в самой схеме. Без него файл
// чужого семейства давал бы стену `unrecognized_keys` — по строке на каждое поле, — и человек
// узнавал бы «двадцать полей лишние» вместо «это `compile-profile/1`, а ожидался
// `render-profile/1`». Ошибка обязана называть причину, а не следствие.
//
// ТОЛЕРАНТНОСТЬ ЗДЕСЬ ОЗНАЧАЕТ РОВНО ОДНО (ADR-0005 §4): читатель понимает ВСЕ исторические
// версии семейства. Мусор он отвергает строже прежнего.

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

import { FAMILIES, FAMILY_NAMES, type FamilyEntry, type FamilyFormat } from './registry.js';

/** Ошибка чтения: несёт путь к файлу и, где применимо, семейство и версию. */
export class FamilyReadError extends Error {
  readonly filePath: string;
  readonly family: string | undefined;
  readonly version: number | undefined;

  constructor(filePath: string, message: string, details: { family?: string; version?: number } = {}) {
    super(`${filePath}: ${message}`);
    this.name = 'FamilyReadError';
    this.filePath = filePath;
    this.family = details.family;
    this.version = details.version;
  }
}

export interface FamilyHeader {
  readonly family: string;
  readonly version: number;
  /** Значение шапки целиком, как в файле: `render-profile/1`. */
  readonly raw: string;
}

export interface ReadOptions {
  /** Ожидаемое семейство. Несовпадение — ошибка ДО валидации тела, одной строкой. */
  readonly expectFamily?: string;
}

export interface ReadResult {
  readonly header: FamilyHeader;
  readonly entry: FamilyEntry;
  /** Для `jsonl` — массив записей; для остальных — разобранный документ. */
  readonly value: unknown;
}

/** Первая строка файла — там обязана быть шапка у `jsonl` и `markdown-header`. */
function firstLine(text: string): string {
  const index = text.indexOf('\n');
  return index === -1 ? text : text.slice(0, index);
}

/**
 * Как разобрать файл, ЕЩЁ НЕ ЗНАЯ семейства.
 *
 * Круг «формат известен из реестра, а реестр находится по шапке, которую надо разобрать»
 * разрывается расширением файла, и только на шаге чтения шапки. После того как семейство
 * найдено, стратегия сверяется с `entry.format`: расхождение (`direction/1` в файле `.json`)
 * — ошибка, а не молчаливое чтение.
 */
function strategyByExtension(filePath: string): FamilyFormat {
  if (filePath.endsWith('.jsonl')) return 'jsonl';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown-header';
  return 'yaml';
}

/**
 * Разбирает значение шапки `<семейство>/<версия>`.
 *
 * Версия — целое десятичное без знака и без ведущих нулей: `render-profile/01` и
 * `render-profile/1` иначе были бы двумя записями одной версии.
 */
function parseHeaderValue(raw: string, filePath: string): FamilyHeader {
  const parts = raw.split('/');
  const family = parts[0];
  const version = parts[1];
  if (parts.length !== 2 || family === undefined || family === '' || version === undefined) {
    throw new FamilyReadError(
      filePath,
      `шапка \`schema: ${raw}\` не имеет формы \`<семейство>/<версия>\` (ADR-0005 §3)`,
    );
  }
  if (!/^[1-9][0-9]*$/.test(version)) {
    throw new FamilyReadError(
      filePath,
      `версия в шапке \`schema: ${raw}\` не является целым числом без ведущих нулей`,
      { family },
    );
  }
  return { family, version: Number(version), raw };
}

function headerOf(document: unknown, filePath: string): FamilyHeader {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new FamilyReadError(filePath, 'ожидался маппинг с шапкой `schema: <семейство>/<версия>` (P1)');
  }
  const raw = (document as Record<string, unknown>)['schema'];
  if (typeof raw !== 'string') {
    throw new FamilyReadError(
      filePath,
      'нет шапки `schema: <семейство>/<версия>` — P1 требует её у каждого файла формата',
    );
  }
  return parseHeaderValue(raw, filePath);
}

function readHeaderSource(filePath: string, text: string, strategy: FamilyFormat): unknown {
  try {
    switch (strategy) {
      case 'jsonl':
        return JSON.parse(firstLine(text) === '' ? '{}' : firstLine(text));
      case 'json':
        return JSON.parse(text);
      case 'markdown-header':
        return parseYaml(firstLine(text));
      default:
        return parseYaml(text);
    }
  } catch (error) {
    throw new FamilyReadError(filePath, `не разбирается: ${(error as Error).message}`);
  }
}

function lookup(header: FamilyHeader, filePath: string): FamilyEntry {
  const entry = FAMILIES.get(header.family);
  if (entry === undefined) {
    throw new FamilyReadError(
      filePath,
      `семейство \`${header.family}\` неизвестно. Движок знает: ${FAMILY_NAMES.join(', ')}`,
      { family: header.family },
    );
  }
  return entry;
}

/**
 * Выбирает схему версии.
 *
 * НЕИЗВЕСТНАЯ ВЕРСИЯ — ОТДЕЛЬНАЯ ОШИБКА, а не падение по `undefined`. Разница практическая:
 * «файл записан более новым движком» говорит человеку обновить движок, а
 * `TypeError: cannot read properties of undefined` не говорит ничего. Это единственный класс
 * ошибки формата, который не чинится правкой файла.
 */
function schemaFor(entry: FamilyEntry, header: FamilyHeader, filePath: string): z.ZodType {
  const schema = entry.versions.get(header.version);
  if (schema === undefined) {
    const known = [...entry.versions.keys()].sort((a, b) => a - b).join(', ');
    throw new FamilyReadError(
      filePath,
      `файл записан более новым движком: семейство \`${header.family}\`, версия ${String(header.version)}; эта версия движка знает версии ${known}`,
      { family: header.family, version: header.version },
    );
  }
  return schema;
}

function validate(schema: z.ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success) throw result.error;
  return result.data;
}

/** JSONL: шапка первой строкой отдельным объектом, дальше — по записи на строку (ADR-0005 §10). */
function readJsonlEntries(entry: FamilyEntry, text: string, filePath: string, schema: z.ZodType): unknown[] {
  const lines = text.split('\n');
  const out: unknown[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new FamilyReadError(
        filePath,
        `строка ${String(index + 1)} не разбирается как JSON: ${(error as Error).message}`,
        { family: entry.family },
      );
    }
    out.push(validate(schema, parsed));
  }
  return out;
}

/**
 * Читает и валидирует файл любого известного семейства.
 *
 * @throws {FamilyReadError} нет шапки, неизвестное семейство, не то семейство (`expectFamily`),
 *   неизвестная версия, битый формат, расхождение расширения файла с форматом семейства.
 * @throws {z.ZodError} тело не соответствует схеме — с путём к полю.
 */
export function readFamily(filePath: string, options: ReadOptions = {}): ReadResult {
  const text = readFileSync(filePath, 'utf8');
  const strategy = strategyByExtension(filePath);
  const header = headerOf(readHeaderSource(filePath, text, strategy), filePath);
  const entry = lookup(header, filePath);

  // Проверка семейства идёт ДО валидации тела, и это половина смысла отдельного шага шапки:
  // иначе `compile-profile/1`, поданный туда, где ждут `render-profile/1`, дал бы стену
  // `unrecognized_keys` по строке на каждое поле вместо одной строки «не то семейство».
  if (options.expectFamily !== undefined && entry.family !== options.expectFamily) {
    const expected = FAMILIES.get(options.expectFamily);
    throw new FamilyReadError(
      filePath,
      `ожидалось семейство \`${options.expectFamily}/${String(expected?.current ?? 1)}\`, а файл объявляет \`${header.raw}\``,
      { family: header.family, version: header.version },
    );
  }

  if (entry.format !== strategy) {
    throw new FamilyReadError(
      filePath,
      `семейство \`${entry.family}\` хранится как \`${entry.format}\`, а расширение файла читается как \`${strategy}\``,
      { family: entry.family, version: header.version },
    );
  }

  const schema = schemaFor(entry, header, filePath);

  if (entry.format === 'jsonl') {
    return { header, entry, value: readJsonlEntries(entry, text, filePath, schema) };
  }
  if (entry.format === 'markdown-header') {
    // Тело — проза, её читает лексер (`C-02`). Валидируется ровно шапка.
    return { header, entry, value: validate(schema, parseYaml(firstLine(text))) };
  }

  const document = entry.format === 'json' ? (JSON.parse(text) as unknown) : parseYaml(text);
  return { header, entry, value: validate(schema, document) };
}
