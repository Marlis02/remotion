// **РЕЕСТРЫ ШАБЛОНОВ ПРОИЗВОДНЫ ОТ ЛИСТИНГА КАТАЛОГА, И ЭТО ПРОВЕРЯЕТСЯ, А НЕ ПОДРАЗУМЕВАЕТСЯ**
// (`TPL-01a`, 2026-09-09).
//
// ЗАЧЕМ. Задача сняла с нового шаблона ~10 мест правки (измерено `E-02`), и часть из них —
// ручные массивы `templates/index.ts` в двух пакетах. Ручной массив ловил ровно одно: шаблон,
// добавленный молча. Реестр стал сгенерированным, и это утверждение обязано стеречь кто-то
// другой — иначе «папка есть, а в реестре её нет» стало бы тихим состоянием: `tsc` промолчит,
// потому что забытый шаблон синтаксически не существует, а гейт на нём никто не потребует.
//
// ПОЧЕМУ ПРОГОН СКРИПТА, А НЕ ИМПОРТ ЕГО ФУНКЦИЙ. Генератор — `.mjs` вне проектов `tsc`
// (`scripts/` не входит ни в один `tsconfig`), и импорт из теста потребовал бы либо `.d.mts`,
// либо `@ts-expect-error`. Прогон проверяет ТУ САМУЮ команду, которую запускает автор нового
// шаблона, вместе с её кодом возврата и текстом отказа: тест и runbook говорят одно и то же.
//
// ПОЧЕМУ ЭТО НЕ «ТЕСТ НА ТО, ЧТО ФАЙЛ СГЕНЕРИРОВАН». Здесь стережётся РАВЕНСТВО двух величин:
// текста в дереве и текста, который даёт генератор на текущем листинге. Разойтись они могут с
// двух сторон — забыли запустить генератор (появилась папка) или правили индекс руками, — и
// оба случая одинаково красные.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT } from '../boundaries/repo';

const SCRIPT = path.join(ROOT, 'scripts/gen-template-registry.mjs');

const SPEC_DIR = path.join(ROOT, 'packages/templates-spec/src/templates');
const IMPL_DIR = path.join(ROOT, 'packages/renderer-hyperframes/src/templates');

/** Прогон генератора: `{code, out}`. `--check` не пишет ничего — его можно звать всегда. */
function run(args: readonly string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Папки шаблонов каталога — тем же фильтром, что у генератора. */
function dirsOf(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z][A-Za-z0-9]*@[1-9][0-9]*$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('`TPL-01a` — реестры шаблонов совпадают с генератором', () => {
  it('`--check` зелёный: текст в дереве равен сгенерированному', () => {
    const { code, out } = run(['--check']);
    expect(
      code,
      'Реестр шаблонов разошёлся с листингом каталога. Это либо новая папка шаблона без ' +
        'запуска генератора, либо правка сгенерированного `index.ts` руками. Лечится одной ' +
        `командой: \`node scripts/gen-template-registry.mjs\`. Вывод:\n${out}`,
    ).toBe(0);
  });

  it('ЗОНА НАЙДЕНА: обе папки существуют и в них одни и те же шаблоны', () => {
    // Без этого утверждения тест был бы зелёным в день, когда каталог переименуют: генератор
    // отдал бы пустой реестр, а `--check` подтвердил бы, что пустой реестр равен пустому.
    const specs = dirsOf(SPEC_DIR);
    const impls = dirsOf(IMPL_DIR);
    expect(specs.length).toBeGreaterThan(0);
    // «Папка шаблона — это ДВЕ папки с одним именем» (ADR-0009): спек без реализации есть
    // отказ до браузера, реализация без спека — шаблон, которого нет в библиотеке.
    expect(impls, 'состав папок двух пакетов разошёлся: у шаблона обязаны быть обе половины').toEqual(
      specs,
    );
  });

  it('каждая папка несёт свою половину: `spec.ts` в спеках, `impl.ts` в рендерере', () => {
    for (const name of dirsOf(SPEC_DIR)) {
      expect(fs.existsSync(path.join(SPEC_DIR, name, 'spec.ts')), `${name}: нет spec.ts`).toBe(true);
      expect(fs.existsSync(path.join(IMPL_DIR, name, 'impl.ts')), `${name}: нет impl.ts`).toBe(true);
    }
  });

  it('в сгенерированных реестрах нет импортов мимо папок шаблонов', () => {
    // Ручной import в сгенерированном файле пережил бы `--check` только вместе с правкой
    // генератора, но проверить это дешевле здесь: строка называет ФАЙЛ, а не дифф целиком.
    const allowed = (spec: string): boolean =>
      spec === './template.js' || /^\.\/[^/]+@[0-9]+\/(spec|impl)\.js$/u.test(spec);
    for (const [file, extra] of [
      [path.join(SPEC_DIR, 'index.ts'), '../spec.js'],
      [path.join(IMPL_DIR, 'index.ts'), './template.js'],
    ] as const) {
      const source = fs.readFileSync(file, 'utf8');
      const specs = [...source.matchAll(/from '([^']+)'/gu)].map((m) => m[1] ?? '');
      const offenders = specs.filter((s) => s !== extra && !allowed(s));
      expect(offenders, `${path.relative(ROOT, file)}: импорт мимо папки шаблона`).toEqual([]);
    }
  });

  it('охранник РАБОТАЕТ: папка-шаблон без запуска генератора краснит `--check`', () => {
    // Проба, а не рассуждение (`H-01`, решение владельца §4 п. 2): «зелёный, потому что не
    // гонялось» отличается от «зелёного, потому что проверено», только если это написано.
    const probe = path.join(SPEC_DIR, 'zzprobe@1');
    fs.mkdirSync(probe, { recursive: true });
    try {
      const { code, out } = run(['--check']);
      expect(code).toBe(1);
      expect(out).toContain('templates-spec/src/templates/index.ts');
      expect(out).toContain('zzprobe@1');
      expect(out).toMatch(/перегенерировать/u);
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
    // И дерево осталось таким же: `--check` не пишет.
    expect(run(['--check']).code).toBe(0);
  });
});
