// **D4** в рендер-пути КОМПОЗИЦИИ — там, куда ESLint не дотягивается.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ОХРАННИК. ADR-0007 §4 запрещает `Math.random`, `Date`, `performance.now`,
// `Intl`, `toLocaleString`, `localeCompare` В РЕНДЕР-ПУТИ. Механизм этого запрета —
// `no-restricted-properties`/`no-restricted-syntax` в `eslint.config.js`, и область его
// действия — `packages/*/src/**/*.ts`. Runtime композиции и `mountSource` шаблонов под неё
// НЕ подпадают дважды: runtime — это `.js`, а исходники шаблонов живут внутри строковых
// литералов, которые ESLint по определению не разбирает как код.
//
// А ведь именно это и есть рендер-путь в самом буквальном смысле: код, исполняемый в браузере
// на каждом кадре. Правило, действующее везде, кроме места, ради которого оно написано, —
// ложно-зелёный охранник. Поэтому здесь стоит греп, и это сказано вслух: греп слабее ESLint
// (он не знает области видимости), но область, которую он покрывает, ESLint не покрывает
// вовсе.
//
// ЧТО ИМЕННО СТЕРЕЖЁТСЯ. Два множества файлов: (1) runtime композиции
// `packages/renderer-hyperframes/src/composition/**`; (2) ЛЮБОЙ `mountSource` шаблона —
// и в продакшн-реестре (`src/templates/**`), и в тестовом (`test/solid.ts`), потому что
// синтетический шаблон исполняется в браузере ровно так же, как настоящий.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines } from '../boundaries/repo';

/** Формы, запрещённые ADR-0007 §4 в рендер-пути. Список — тот же, что в `eslint.config.js`. */
const FORBIDDEN: readonly { readonly re: RegExp; readonly what: string }[] = [
  { re: /\bMath\s*\.\s*random\b/u, what: 'Math.random' },
  { re: /\bDate\s*\.\s*now\b/u, what: 'Date.now' },
  { re: /\bnew\s+Date\b/u, what: 'new Date' },
  { re: /\bDate\s*\(/u, what: 'Date()' },
  { re: /\bperformance\s*\.\s*now\b/u, what: 'performance.now' },
  { re: /\bIntl\s*\./u, what: 'Intl' },
  { re: /\.toLocale(String|DateString|TimeString)\b/u, what: 'toLocale*' },
  { re: /\.localeCompare\b/u, what: 'localeCompare' },
];

/** Файлы рендер-пути композиции: runtime + всё, что несёт `mountSource`. */
function compositionFiles(): string[] {
  const pkg = path.join(ROOT, 'packages/renderer-hyperframes');
  const out: string[] = [];

  const walk = (dir: string, exts: readonly string[]): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, exts);
      else if (exts.some((e) => entry.name.endsWith(e))) out.push(path.relative(ROOT, abs));
    }
  };

  walk(path.join(pkg, 'src/composition'), ['.js']);
  walk(path.join(pkg, 'src/templates'), ['.ts']);
  // Тестовые реестры — тоже рендер-путь: `solid@1` исполняется в браузере. Файлов ДВА
  // (`E-00`): второй появился у команды `vpe template gate`, чей живой тест держит свою копию
  // `mountSource` — импорт тестового файла чужого пакета не собирается `tsc --build`. Список
  // ИМЕНОВАННЫЙ и проверяется на существование ниже: молча «потерять» файл нельзя.
  for (const abs of [
    path.join(pkg, 'test/solid.ts'),
    path.join(ROOT, 'packages/cli/test/solid.ts'),
  ]) {
    if (fs.existsSync(abs)) out.push(path.relative(ROOT, abs));
  }
  return out;
}

describe('D4 — рендер-путь композиции (греп там, куда ESLint не дотягивается)', () => {
  const files = compositionFiles();

  it('файлы рендер-пути НАЙДЕНЫ: охранник не стережёт пустое место', () => {
    // Без этого утверждения тест был бы зелёным в день, когда каталог переименуют.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('packages/renderer-hyperframes/src/composition/runtime.js');
    expect(files).toContain('packages/renderer-hyperframes/test/solid.ts');
    expect(files).toContain('packages/cli/test/solid.ts');
  });

  it('ни одной запрещённой формы ни в одном файле рендер-пути', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      lines.forEach((line, i) => {
        for (const { re, what } of FORBIDDEN) {
          if (re.test(line)) offenders.push(`${file}:${String(i + 1)} → ${what}`);
        }
      });
    }
    expect(
      offenders,
      'Недетерминизм в рендер-пути композиции (ADR-0007 §4, Charter V8). Источник обязан ' +
        'приходить значением: материализованные компилятором seeds лежат в `ctx.seeds`, ' +
        `время — в кадрах. Найдено: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('ОХРАННИК СРАБАТЫВАЕТ: та же проверка краснеет на подставном нарушении', () => {
    // Иначе предыдущий тест доказывал бы только «регулярки ничего не нашли».
    const probe = ['var x = Math.random();', 'var t = Date.now();', "s.localeCompare('a');"];
    const found = probe.filter((line) => FORBIDDEN.some(({ re }) => re.test(line)));
    expect(found.length).toBe(probe.length);
  });

  it('комментарии НЕ считаются нарушением: греп идёт по коду', () => {
    // `runtime.js` объясняет в шапке, почему `Math.random` там запрещён, — и это объяснение
    // не должно красить охранника. Если бы считалось, правило наказывало бы за документацию.
    const runtime = fs.readFileSync(
      path.join(ROOT, 'packages/renderer-hyperframes/src/composition/runtime.js'),
      'utf8',
    );
    expect(runtime).toContain('Math.random');
    expect(codeLines(runtime).join('\n')).not.toContain('Math.random');
  });
});
