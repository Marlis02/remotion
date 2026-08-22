// Инструмент охранника V13: «язык контента всех фикстур репозитория — английский».
//
// ПРАВИЛО ТОГО ЖЕ КАТАЛОГА, ЧТО И `tests/boundaries/`: тест ЧИТАЕТ ФАЙЛЫ и не импортирует
// модули пакетов. Здесь у этого есть вторая причина: `yaml` — зависимость `@vpe/schema`, а не
// корня, и импорт её из `tests/` завёл бы необъявленную зависимость корневого importer'а —
// то самое, что стерегут тесты границ `R-01`.
//
// ЧТО ИМЕННО ПРОВЕРЯЕТСЯ — БУКВАЛЬНО ПО V13: содержимое `fixtures/**/source/*.md` целиком и
// ДВА КОНТЕНТНЫХ ПОЛЯ каждого `fixtures/**/publish.yaml` — `title` и `descriptionTemplate`.
// Комментарии YAML и `docs/**` НЕ проверяются: «по V12 меняется язык контента, а не язык
// документации» (V13 говорит это прямо, `fixtures/minimal/README.md` — тоже). Поэтому здесь
// нет обхода `docs/`, а из `publish.yaml` берутся ровно два поля, а не весь файл.
//
// ПОЧЕМУ КОРЕНЬ — ПАРАМЕТР. Чтобы протокол нарушений мог направить тот же сканер на ВРЕМЕННУЮ
// копию фикстуры с кириллицей: `fixtures/` не изменяется ни в одном нарушении.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Кириллица по V13 — ровно этот диапазон: `[Ѐ-ӿ]`. */
export const CYRILLIC = /[Ѐ-ӿ]/u;

/** Два контентных поля `publish.yaml`. Список закрыт: V13 называет именно их. */
export const CONTENT_FIELDS = ['title', 'descriptionTemplate'] as const;

export interface LanguageViolation {
  /** Путь от корня переданного дерева. */
  readonly file: string;
  /** Номер строки, 1-based. */
  readonly line: number;
  /** `source` — тело файла прозы; иначе имя поля `publish.yaml`. */
  readonly where: string;
  /** Первый кириллический символ. */
  readonly character: string;
  readonly excerpt: string;
}

function walk(dir: string, visit: (abs: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, visit);
    else if (entry.isFile()) visit(abs);
  }
}

/** Все `fixtures/**\/source/*.md` и все `fixtures/**\/publish.yaml` дерева. */
export function contentFiles(root: string): { readonly prose: string[]; readonly publish: string[] } {
  const prose: string[] = [];
  const publish: string[] = [];
  walk(path.join(root, 'fixtures'), (abs) => {
    const rel = path.relative(root, abs);
    if (path.basename(abs) === 'publish.yaml') publish.push(rel);
    else if (abs.endsWith('.md') && path.basename(path.dirname(abs)) === 'source') prose.push(rel);
  });
  return { prose, publish };
}

/**
 * Значение однострочного скаляра. Кавычки снимаются; у НЕкавыченного скаляра отрезается
 * хвостовой комментарий — иначе русский комментарий в строке `topic: history  # PG-A5` попал
 * бы под проверку, а V13 комментарии исключает явно.
 */
function scalarValue(rest: string): string {
  const trimmed = rest.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"|^'((?:[^']|'')*)'/u.exec(trimmed);
  if (quoted !== null) return quoted[1] ?? quoted[2] ?? '';
  const comment = trimmed.indexOf(' #');
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
}

interface Field {
  readonly name: string;
  readonly line: number;
  readonly value: string;
}

/**
 * Достаёт `title` и `descriptionTemplate` из `publish.yaml`.
 *
 * Полноценного YAML здесь нет и не нужно: проверяются два поля верхнего уровня, одно из них —
 * блочный скаляр `|`. Блочный скаляр читается до дедента; комментариев внутри блочного скаляра
 * в YAML не бывает, поэтому там ничего не отрезается.
 */
export function contentFieldsOf(text: string): Field[] {
  const lines = text.split('\n');
  const out: Field[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const head = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/u.exec(line);
    if (head === null) continue;
    const name = head[1] ?? '';
    if (!(CONTENT_FIELDS as readonly string[]).includes(name)) continue;
    const rest = head[2] ?? '';
    const block = /^\s*[|>][-+0-9]*\s*$/u.test(rest);
    if (!block) {
      out.push({ name, line: i + 1, value: scalarValue(rest) });
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const next = lines[j] ?? '';
      if (next.trim() === '') {
        body.push('');
        continue;
      }
      if (!/^\s/u.test(next)) break;
      body.push(next);
    }
    out.push({ name, line: i + 1, value: body.join('\n') });
    i = j - 1;
  }
  return out;
}

function firstCyrillic(value: string): { index: number; character: string } | undefined {
  const points = [...value];
  for (let i = 0; i < points.length; i += 1) {
    const ch = points[i] ?? '';
    if (CYRILLIC.test(ch)) return { index: i, character: ch };
  }
  return undefined;
}

function excerptAround(value: string, index: number): string {
  const points = [...value];
  return points.slice(Math.max(0, index - 20), index + 20).join('').replace(/\n/gu, '⏎');
}

/**
 * Все нарушения V13 в дереве `root`. Пустой список — язык контента фикстур английский.
 *
 * Строка нарушения в прозе считается по самому файлу; у поля `publish.yaml` — строка ключа
 * (блочный скаляр занимает несколько строк, и указывать внутрь него смысла нет: правится поле).
 */
export function scanContentLanguage(root: string): LanguageViolation[] {
  const out: LanguageViolation[] = [];
  const files = contentFiles(root);

  for (const rel of files.prose) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const hit = firstCyrillic(lines[i] ?? '');
      if (hit === undefined) continue;
      out.push({
        file: rel,
        line: i + 1,
        where: 'source',
        character: hit.character,
        excerpt: excerptAround(lines[i] ?? '', hit.index),
      });
    }
  }

  for (const rel of files.publish) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const field of contentFieldsOf(text)) {
      const hit = firstCyrillic(field.value);
      if (hit === undefined) continue;
      out.push({
        file: rel,
        line: field.line,
        where: field.name,
        character: hit.character,
        excerpt: excerptAround(field.value, hit.index),
      });
    }
  }

  return out;
}

/** Человекочитаемый список нарушений — им падает тест. */
export function formatViolations(violations: readonly LanguageViolation[]): string {
  return violations
    .map((v) => `${v.file}:${String(v.line)}: ${v.where}: кириллица \`${v.character}\` — …${v.excerpt}…`)
    .join('\n');
}
