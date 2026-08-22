// Общий инструмент тестов границ репозитория.
//
// Правило, общее для всего каталога `tests/boundaries/`: тест **читает файлы**
// (`package.json`, `pnpm-lock.yaml`, `src/**`) и **не импортирует модули пакетов**.
// Иначе тест границ сам стал бы нарушителем границы, а на пустом дереве (R-01)
// импортировать ещё нечего.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Восемь пакетов карты ADR-0009. Порядок — порядок стрелок вниз. */
export const PACKAGES = [
  'schema',
  'core-model',
  'media',
  'voice',
  'templates-spec',
  'compile',
  'renderer-hyperframes',
  'cli',
] as const;

export type PackageName = (typeof PACKAGES)[number];

export interface Manifest {
  /** `@vpe/schema` либо `<root>` для корневого package.json */
  readonly id: string;
  /** путь от корня репозитория, для сообщения об ошибке */
  readonly relPath: string;
  readonly json: Record<string, unknown>;
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function readJson(abs: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
}

/** Корневой манифест плюс манифесты восьми пакетов. */
export function manifests(): Manifest[] {
  const out: Manifest[] = [
    { id: '<root>', relPath: 'package.json', json: readJson(path.join(ROOT, 'package.json')) },
  ];
  for (const name of PACKAGES) {
    const relPath = path.join('packages', name, 'package.json');
    out.push({ id: `@vpe/${name}`, relPath, json: readJson(path.join(ROOT, relPath)) });
  }
  return out;
}

export interface DependencyEntry {
  readonly manifest: Manifest;
  readonly field: (typeof DEPENDENCY_FIELDS)[number];
  readonly name: string;
  readonly range: string;
}

/** Все объявленные зависимости всех манифестов, из всех четырёх полей. */
export function dependencyEntries(): DependencyEntry[] {
  const out: DependencyEntry[] = [];
  for (const manifest of manifests()) {
    for (const field of DEPENDENCY_FIELDS) {
      const block = manifest.json[field];
      if (block === undefined || block === null) continue;
      for (const [name, range] of Object.entries(block as Record<string, string>)) {
        out.push({ manifest, field, name, range });
      }
    }
  }
  return out;
}

// ── pnpm-lock.yaml ──────────────────────────────────────────────────────────
// Разбор ровно того, что нужно тестам: имена пакетов в `packages:`/`snapshots:`
// и зависимости, объявленные каждым importer'ом. Полноценный YAML-парсер сюда
// не тянется — это добавило бы зависимость ради двух регулярных выражений.

export const LOCKFILE = 'pnpm-lock.yaml';

function lockfileText(): string {
  const abs = path.join(ROOT, LOCKFILE);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `${LOCKFILE} не найден. Тесты границ читают lockfile как источник истины о дереве ` +
        `зависимостей; выполните \`pnpm install\` перед прогоном.`,
    );
  }
  return fs.readFileSync(abs, 'utf8');
}

function sections(text: string): { section: string; line: string }[] {
  let section = '';
  const out: { section: string; line: string }[] = [];
  for (const line of text.split('\n')) {
    const top = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line);
    if (top !== null && top[1] !== undefined) {
      section = top[1];
      continue;
    }
    out.push({ section, line });
  }
  return out;
}

function unquote(s: string): string {
  return s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

/** Имена всех пакетов, попавших в дерево (`packages:` и `snapshots:`). */
export function lockfilePackageNames(): Set<string> {
  const names = new Set<string>();
  for (const { section, line } of sections(lockfileText())) {
    if (section !== 'packages' && section !== 'snapshots') continue;
    const m = /^ {2}('[^']+'|"[^"]+"|[^\s].*?):\s*$/.exec(line);
    if (m === null || m[1] === undefined) continue;
    let key = unquote(m[1]);
    if (key.startsWith('/')) key = key.slice(1); // формат lockfile v6
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    names.add(key.slice(0, at));
  }
  return names;
}

/** `importer` (путь от корня, `.` = корень) → имена объявленных им зависимостей. */
export function lockfileImporterDeps(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let importer: string | null = null;
  for (const { section, line } of sections(lockfileText())) {
    if (section !== 'importers') continue;
    const head = /^ {2}('[^']+'|"[^"]+"|[^\s].*?):\s*$/.exec(line);
    if (head !== null && head[1] !== undefined) {
      importer = unquote(head[1]);
      if (!out.has(importer)) out.set(importer, new Set());
      continue;
    }
    if (importer === null) continue;
    const dep = /^ {6}('[^']+'|"[^"]+"|[^\s].*?):\s*$/.exec(line);
    if (dep === null || dep[1] === undefined) continue;
    out.get(importer)?.add(unquote(dep[1]));
  }
  return out;
}

// ── Исходники пакетов ───────────────────────────────────────────────────────

/** Все `.ts`-файлы внутри `packages/<name>/src`, путями от корня репозитория. */
export function sourceFiles(pkg: PackageName): string[] {
  const base = path.join(ROOT, 'packages', pkg, 'src');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && abs.endsWith('.ts')) out.push(path.relative(ROOT, abs));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out;
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bcreateRequire\s*\([^)]*\)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Спецификаторы модулей, встречающиеся в исходнике (import/export from, dynamic import, require). */
export function moduleSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of SPECIFIER_PATTERNS) {
    for (const m of source.matchAll(re)) {
      if (m[1] !== undefined) out.push(m[1]);
    }
  }
  return out;
}

export function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ── Программный запуск ESLint ───────────────────────────────────────────────

export interface LintMessage {
  readonly ruleId: string | null;
  readonly message: string;
  readonly severity: number;
}

/** Прогоняет ESLint по указанным файлам корневым flat-конфигом репозитория. */
export async function lint(relPaths: string[]): Promise<LintMessage[]> {
  const eslint = new ESLint({ cwd: ROOT, errorOnUnmatchedPattern: true });
  const results = await eslint.lintFiles(relPaths.map((p) => path.join(ROOT, p)));
  return results.flatMap((r) =>
    r.messages.map((m) => ({ ruleId: m.ruleId ?? null, message: m.message, severity: m.severity })),
  );
}

/**
 * Создаёт временные файлы, прогоняет по ним ESLint и удаляет их в `finally`.
 * Именно так проверяется, что охранник **срабатывает**, а не просто описан в конфиге.
 */
export async function lintTemporary(
  files: { readonly relPath: string; readonly source: string }[],
): Promise<LintMessage[]> {
  const created: string[] = [];
  try {
    for (const file of files) {
      const abs = path.join(ROOT, file.relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs)) throw new Error(`временный файл ${file.relPath} уже существует — прогон прерван`);
      fs.writeFileSync(abs, file.source, 'utf8');
      created.push(abs);
    }
    return await lint(files.map((f) => f.relPath));
  } finally {
    for (const abs of created.reverse()) {
      if (fs.existsSync(abs)) fs.rmSync(abs);
    }
  }
}

export function errorsFor(messages: LintMessage[], ruleId: string): LintMessage[] {
  return messages.filter((m) => m.ruleId === ruleId && m.severity === 2);
}
