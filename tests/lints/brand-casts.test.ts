// `S-01` долг №3 (`C-01`): бренд, снимаемый кастом, не бренд.
// `as Samples` / `as Frames` / `as Sha256` / `as Blake3` запрещены везде, кроме
// `packages/schema/src/types/brands.ts` — файла, где живут конструкторы-валидаторы.
//
// ПОЧЕМУ ЭТО ВООБЩЕ ПРАВИЛО. Отчёт `S-01` §6 п. 3: «Бренды снимаются кастом. `x as Frames`
// компилируется: TypeScript не умеет запретить утверждение типа. Охранник тут — код-ревью
// и то, что конструктор единственный». Код-ревью — не охранник; здесь долг закрывается.
//
// У ТЕСТОВ ИСКЛЮЧЕНИЯ НЕТ. Значение, построенное кастом, не прошло `Number.isSafeInteger`,
// проверку знака и `-0`, то есть тест начинает проверять арифметику на входах, которые
// продакшн-код получить не может.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines, errorsFor, lint, lintTemporary, readSource, type LintMessage } from '../boundaries/repo';

/** Файл-исключение. Путь записан здесь И в `eslint.config.js`; тест стережёт, что он один. */
const EXEMPT = 'packages/schema/src/types/brands.ts';

const BRANDS = ['Samples', 'Frames', 'Sha256', 'Blake3'] as const;

/**
 * Файлы, в которых каст встречается только ВНУТРИ строковых и регулярных литералов — это
 * исходники проб самого охранника. Греп для них снят, но взамен по ним прогоняется ESLint.
 */
const LITERAL_ONLY = ['tests/lints/brand-casts.test.ts'];

/**
 * `as Samples`, `as unknown as Frames`, `as Samples[]`, `<Sha256>x`.
 *
 * ИСТОЧНИК ИСТИНЫ — НЕ ЭТА РЕГУЛЯРКА, а AST-селектор `BRAND_SYNTAX` в `eslint.config.js`
 * (`TSAsExpression`/`TSTypeAssertion` → `TSTypeReference` → `Identifier`). Греп её
 * ДУБЛИРУЕТ текстом — затем, чтобы охранник краснел и на файле, до которого ESLint по
 * какой-то причине не дошёл. Расхождение дубля с оригиналом — дефект дубля.
 *
 * ПОЧЕМУ LOOKBEHIND (`M-01`, 2026-08-23, правка чужого охранника по явному разрешению
 * владельца). Вторая ветка написана под СТАРЫЙ каст `<Sha256>x` — форму, которую AST зовёт
 * `TSTypeAssertion`. Без `(?<!\w)` она ловила заодно аргумент дженерика: `Promise<Sha256>`
 * — возвращаемый тип `Store.put` из ADR-0005 §8, где никакого утверждения типа нет.
 * ESLint на тех же строках молчал, то есть дубль противоречил оригиналу. `<` после
 * идентификатора — это всегда список типовых аргументов, а не утверждение; после пробела,
 * `=`, `(`, `,` или начала строки — утверждение. Разбор — `docs/impl/M-01/report.md`;
 * долг «греп-половина разъезжается с AST-правилом» — `docs/DEBTS.md`.
 */
const CAST = new RegExp(String.raw`(\bas\s+(readonly\s+)?(${BRANDS.join('|')})\b)|((?<!\w)<(${BRANDS.join('|')})>)`);

function brandErrors(messages: LintMessage[]): LintMessage[] {
  return errorsFor(messages, 'no-restricted-syntax').filter((m) => m.message.startsWith('`S-01` долг №3'));
}

function repositorySources(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.cache', 'out', '.git', 'docs']);
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && abs.endsWith('.ts')) out.push(path.relative(ROOT, abs));
    }
  };
  walk(ROOT);
  return out;
}

describe('Бренды — единственный вход в тип это конструктор (`S-01` долг №3)', () => {
  it('(а) греп: каст в бренд встречается ровно в одном файле репозитория', () => {
    const offenders: string[] = [];
    for (const file of repositorySources()) {
      if (file === EXEMPT || LITERAL_ONLY.includes(file)) continue;
      // Комментарии не код: селекторы ESLint их не видят, и греп не должен.
      codeLines(readSource(file)).forEach((code, i) => {
        if (CAST.test(code)) offenders.push(`${file}:${String(i + 1)}`);
      });
    }
    expect(
      offenders,
      'Бренд снят кастом. Единственный вход — `asSamples`/`asFrames`/`asSha256`/`asBlake3` ' +
        `(${EXEMPT}). Найдено: ` + offenders.join(', '),
    ).toEqual([]);
  });

  it('(а) файлы, снятые с грепа, чисты по мнению самого ESLint', async () => {
    expect(brandErrors(await lint(LITERAL_ONLY))).toEqual([]);
  });

  it.each(BRANDS)('(б) ESLint: правило срабатывает на `as %s` в продакшн-коде', async (brand) => {
    const literal = brand === 'Sha256' || brand === 'Blake3' ? "'x'" : '1';
    const messages = await lintTemporary([
      {
        relPath: `packages/core-model/src/__brand_probe_${brand}__.ts`,
        source:
          `import { type ${brand} } from '@vpe/schema';\n` +
          `export const bad = ${literal} as unknown as ${brand};\n`,
      },
    ]);
    expect(brandErrors(messages).length, `Охранник молчит на \`as ${brand}\`.`).toBeGreaterThan(0);
  });

  it('(б) ESLint: контейнер — та же фабрикация (`as Samples[]`)', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/media/src/__brand_probe_array__.ts',
        source:
          "import { type Samples } from '@vpe/schema';\n" +
          'export const bad = [1, 2] as unknown as Samples[];\n',
      },
    ]);
    expect(
      brandErrors(messages).length,
      'Каст в `Samples[]` проходит мимо охранника: массив непроверенных чисел получил бренд.',
    ).toBeGreaterThan(0);
  });

  it('(б) ESLint: у ТЕСТОВ исключения нет — правило действует и там', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/core-model/test/__brand_probe__.test.ts',
        source: "import { type Frames } from '@vpe/schema';\nexport const bad = 3 as unknown as Frames;\n",
      },
      {
        relPath: 'tests/lints/__brand_probe_repo__.test.ts',
        source: "import { type Samples } from '@vpe/schema';\nexport const bad = 3 as unknown as Samples;\n",
      },
    ]);
    expect(
      brandErrors(messages).length,
      'Тест строит брендированные значения кастом. Тогда он проверяет арифметику на входах, ' +
        'которые продакшн-код получить не может: `asSamples` их отвергает.',
    ).toBeGreaterThanOrEqual(2);
  });

  it('исключение НЕ мёртвое: `brands.ts` содержит касты и при этом проходит линт', async () => {
    // Именно `codeLines`: шапка `brands.ts` цитирует «никаких `as Samples`» словами, и
    // проверка по сырому тексту прошла бы даже без единого каста. Дефект найден протоколом.
    expect(
      CAST.test(codeLines(readSource(EXEMPT)).join('\n')),
      `${EXEMPT} перестал содержать касты — исключение в eslint.config.js стало мёртвой ` +
        'конфигурацией и обязано быть снято.',
    ).toBe(true);
    expect(brandErrors(await lint([EXEMPT]))).toEqual([]);
  });

  it('исключение УЗКОЕ: соседний файл в `types/` под правилом остаётся', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/schema/src/types/__brand_neighbour__.ts',
        source: "import { type Samples } from '@vpe/schema';\nexport const bad = 1 as unknown as Samples;\n",
      },
    ]);
    expect(
      brandErrors(messages).length,
      'Исключение выписано на каталог, а не на файл `brands.ts`.',
    ).toBeGreaterThan(0);
  });
});
