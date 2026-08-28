// **D5** в рендер-пути — «нет `Math.pow`, `Math.sin`, `Math.exp`» (ADR-0007 §3, roadmap §4.8
// `TS-02`, критерий готовности).
//
// ЧТО ЗА ПРАВИЛО. Кривая движения не вычисляется НАШИМ кодом. Реализация живёт в пришпиленном
// `gsap@3.15.0`, чья версия входит в `engineFingerprint`, а наш код держит ИМЯ кривой из
// закрытого реестра (`templates-spec/src/easing.ts`). Основание запрета — ECMA-262:
// `Math.pow`/`sin`/`exp` объявлены implementation-approximated, то есть их результат
// разрешено считать по-разному в разных движках. Кривая, посчитанная нами через них, дала бы
// РАЗНЫЕ пиксели на одном IR — ровно то, что запрещает V13 и меряет гейт.
//
// ПОЧЕМУ ГРЕП, А НЕ ESLINT. То же рассуждение, что у соседа `d4-composition.test.ts`:
// `no-restricted-properties` действует на `packages/*/src/**/*.ts`, а рендер-путь композиции —
// это `.js` (runtime без сборщика) и строковые литералы `mountSource`, которые ESLint как код
// не разбирает вовсе. Правило, действующее везде, кроме места, ради которого оно написано, —
// ложно-зелёный охранник.
//
// ГДЕ СТЕРЕЖЁТСЯ: `renderer-hyperframes/src/composition/**` (runtime, `.js`) и
// `renderer-hyperframes/src/templates/**` (реализации шаблонов, `.ts` и `.js` — реализаций
// сегодня нет, они появятся в `H-06`, и охранник обязан ждать их на месте, а не заводиться
// вместе с ними).
//
// ЧЕГО ЭТОТ ОХРАННИК НЕ ДЕЛАЕТ. Он видит ТРИ имени, названные D5 дословно, а семейство
// implementation-approximated шире (`Math.cos`, `Math.tan`, `Math.log`, `Math.expm1`,
// `Math.hypot`, …). Сегодня их в зоне ноль, но греп их не ищет: расширение списка — правка
// формулировки правила, а не теста. Записано долгом, а не сделано молча.
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ (`codeLines`): и `runtime.js`, и этот файл цитируют правило словами,
// и краснеть на собственной цитате охранник не вправе.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines } from '../boundaries/repo';

/** Три формы, названные **D5** дословно. */
const FORBIDDEN: readonly { readonly re: RegExp; readonly what: string }[] = [
  { re: /\bMath\s*\.\s*pow\b/u, what: 'Math.pow' },
  { re: /\bMath\s*\.\s*sin\b/u, what: 'Math.sin' },
  { re: /\bMath\s*\.\s*exp\b/u, what: 'Math.exp' },
];

/** Файлы рендер-пути: runtime композиции плюс реализации шаблонов. */
function renderPathFiles(): string[] {
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
  // `.js` в зоне шаблонов — не опечатка: реализация шаблона может приехать тем же способом,
  // что и runtime (текст, вставляемый в композицию), и тогда она тоже не TypeScript.
  walk(path.join(pkg, 'src/templates'), ['.ts', '.js']);
  return out;
}

/** Находки в одном ИСТОЧНИКЕ, по коду без комментариев. Отвечает «где», а не «сколько раз». */
function scan(label: string, source: string): string[] {
  const out: string[] = [];
  codeLines(source).forEach((line, i) => {
    for (const { re, what } of FORBIDDEN) {
      if (re.test(line)) out.push(`${label}:${String(i + 1)} → ${what}`);
    }
  });
  return out;
}

/** То же по файлу репозитория. */
function offenders(relPath: string): string[] {
  return scan(relPath, fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

describe('**D5** — в рендер-пути нет `Math.pow`/`Math.sin`/`Math.exp`', () => {
  const files = renderPathFiles();

  it('зона НАЙДЕНА: охранник стережёт существующие файлы, а не пустой каталог', () => {
    // Без этого утверждения тест был бы зелёным в день, когда каталог переименуют, — и это
    // не гипотеза: реализаций шаблонов сегодня нет вовсе, зона держится на одном runtime.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('packages/renderer-hyperframes/src/composition/runtime.js');
    expect(files).toContain('packages/renderer-hyperframes/src/templates/index.ts');
  });

  it('ни одной запрещённой формы ни в одном файле рендер-пути', () => {
    expect(
      files.flatMap(offenders),
      'В рендер-пути появилось вычисление кривой нашим кодом (ADR-0007 §3, **D5**). ' +
        '`Math.pow`/`sin`/`exp` объявлены ECMA-262 implementation-approximated: посчитанная ' +
        'ими кривая даёт разные пиксели на одном IR, то есть ломает V13 ровно в том месте, ' +
        'которое меряет гейт. Кривая берётся ИМЕНЕМ из закрытого реестра ' +
        '(`templates-spec/src/easing.ts`), а считает её пришпиленный `gsap`, чья версия ' +
        'входит в `engineFingerprint`.',
    ).toEqual([]);
  });

  it('ОХРАННИК СРАБАТЫВАЕТ: та же проверка краснеет на подставном нарушении', () => {
    // Иначе предыдущий тест доказывал бы только «регулярки ничего не нашли».
    const probe = [
      'var e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;',
      'var s = Math.sin(t * Math.PI);',
      'var d = 1 - Math.exp(-6 * t);',
    ];
    const found = probe.filter((line) => FORBIDDEN.some(({ re }) => re.test(line)));
    expect(found.length).toBe(probe.length);
    // Пробелы вокруг точки регулярку не обманывают, а соседние имена — не срабатывают.
    expect(FORBIDDEN.some(({ re }) => re.test('Math . pow(2, 3)'))).toBe(true);
    expect(FORBIDDEN.some(({ re }) => re.test('var x = Math.floor(t * fps + 1e-9);'))).toBe(false);
  });

  it('комментарии НЕ считаются нарушением: греп идёт по коду', () => {
    // `runtime.js` цитирует формулу восстановления кадра прямо в шапке. Если бы комментарии
    // считались, правило наказывало бы за документацию — и первым бы покраснел файл, который
    // объясняет, почему запрет существует.
    const source = [
      '// ADR-0007 §3: в рендер-пути нет Math.pow, Math.sin, Math.exp.',
      '/* cubic in-out записывается как t < 0.5 ? 4t³ : 1 - Math.pow(-2*t + 2, 3) / 2 */',
      'var frame = Math.floor(t * fps + 1e-9);',
      '',
    ].join('\n');
    expect(source).toContain('Math.pow');
    expect(scan('<проба>', source)).toEqual([]);
    // И обратно: та же строка КОДОМ — находка с номером строки.
    expect(scan('<проба>', 'var e = Math.pow(t, 3);\n')).toEqual(['<проба>:1 → Math.pow']);
  });
});
