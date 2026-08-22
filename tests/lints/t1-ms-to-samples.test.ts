// ADR-0003 T1 (`C-01`): `msToSamples` — единственная разрешённая функция перевода времени.
// `* sampleRate` и `/ 1000` запрещены везде, кроме `packages/core-model/src/time/ms.ts`.
//
// Охранник двойной, как у границ пакетов (`R-01`):
//   (а) греп по всему дереву — ловит уже написанный код;
//   (б) программный прогон ESLint по временным файлам-нарушителям — доказывает, что правило
//       в `eslint.config.js` действительно СРАБАТЫВАЕТ, а не просто записано.
//
// Плюс третья проверка, которой у границ нет: **исключение не должно быть мёртвым**.
// Файл `ms.ts` обязан содержать запрещённую форму (иначе исключение стоит зря) и обязан
// проходить линт (иначе исключение не работает).
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines, errorsFor, lint, lintTemporary, readSource, type LintMessage } from '../boundaries/repo';

/** Файл-исключение. Путь записан здесь И в `eslint.config.js`; тест стережёт, что он один. */
const EXEMPT = 'packages/core-model/src/time/ms.ts';

/**
 * Файлы, в которых запрещённая форма встречается только ВНУТРИ строковых и регулярных
 * литералов — это исходники проб самого охранника. Селекторы ESLint литералы не разбирают,
 * текстовый греп разбирает; поэтому для них греп снят — но не бесплатно: отдельный тест ниже
 * прогоняет по ним ESLint и требует нуля ошибок T1.
 */
const LITERAL_ONLY = ['tests/lints/t1-ms-to-samples.test.ts'];

/** Те же две формы, что в селекторах: умножение на `sampleRate`, деление на числовой 1000. */
const MUL_BY_RATE = /(^|[^\w.])sampleRate\s*\*|\*\s*(\w+\.)?sampleRate\b/;
const DIV_BY_1000 = /\/=?\s*1000(?![\dn_.eE])/;

function t1Errors(messages: LintMessage[]): LintMessage[] {
  return errorsFor(messages, 'no-restricted-syntax').filter((m) => m.message.startsWith('ADR-0003 T1'));
}

/** Все `.ts` репозитория, кроме сборочных артефактов и приборов спайков. */
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

describe('T1 — `msToSamples` единственная функция перевода времени', () => {
  it('(а) греп: `* sampleRate` и `/ 1000` встречаются ровно в одном файле репозитория', () => {
    const offenders: string[] = [];
    for (const file of repositorySources()) {
      if (file === EXEMPT || LITERAL_ONLY.includes(file)) continue;
      // Комментарии не код: селекторы ESLint их не видят, и греп не должен — иначе он
      // краснеет на строке ADR-0003, процитированной в JSDoc рядом с формулой.
      codeLines(readSource(file)).forEach((code, i) => {
        if (MUL_BY_RATE.test(code)) offenders.push(`${file}:${String(i + 1)} → \`* sampleRate\``);
        if (DIV_BY_1000.test(code)) offenders.push(`${file}:${String(i + 1)} → \`/ 1000\``);
      });
    }
    expect(
      offenders,
      'ADR-0003 T1 нарушен: перевод времени написан второй раз. Единственная разрешённая ' +
        `функция — \`msToSamples\` (${EXEMPT}). Найдено: ` + offenders.join(', '),
    ).toEqual([]);
  });

  it('(а) файлы, снятые с грепа, чисты по мнению самого ESLint', async () => {
    expect(t1Errors(await lint(LITERAL_ONLY))).toEqual([]);
  });

  it('(б) ESLint: правило срабатывает на `* sampleRate` в продакшн-коде', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/core-model/src/__t1_probe_mul__.ts',
        source: 'export const bad = (ms: number, sampleRate: number): number => ms * sampleRate;\n',
      },
    ]);
    const errors = t1Errors(messages);
    expect(errors.length, 'Охранник T1 молчит на `ms * sampleRate`.').toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('ЕДИНСТВЕННАЯ разрешённая функция');
  });

  it('(б) ESLint: правило срабатывает на `grid.sampleRate` — поле объекта, не только идентификатор', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/compile/src/__t1_probe_member__.ts',
        source: 'export const bad = (g: { sampleRate: number }, ms: number): number => g.sampleRate * ms;\n',
      },
    ]);
    expect(t1Errors(messages).length, 'Охранник T1 видит идентификатор, но не поле объекта.').toBeGreaterThan(0);
  });

  it('(б) ESLint: правило срабатывает на `/ 1000`', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/media/src/__t1_probe_div__.ts',
        source: 'export const bad = (samples: number): number => samples / 1000;\n',
      },
    ]);
    expect(t1Errors(messages).length, 'Охранник T1 молчит на `/ 1000`.').toBeGreaterThan(0);
  });

  it('(б) ESLint: у ТЕСТОВ исключения нет — правило действует и там', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/core-model/test/__t1_probe__.test.ts',
        source: 'export const bad = (ms: number, sampleRate: number): number => ms * sampleRate;\n',
      },
    ]);
    expect(
      t1Errors(messages).length,
      'Тест, написавший перевод времени во второй раз, — это не эталон, а копия проверяемой ' +
        'формулы. Исключения для тестов быть не должно.',
    ).toBeGreaterThan(0);
  });

  it('(б) ESLint: `BigInt`-эталон под правило НЕ попадает — и по построению, а не по исключению', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/core-model/test/__t1_etalon__.test.ts',
        source:
          'export const etalon = (ms: bigint, sampleRate: bigint): bigint =>\n' +
          '  (ms * BigInt(sampleRate)) / 1000n;\n',
      },
    ]);
    expect(
      t1Errors(messages),
      'Линт покрасил `BigInt`-эталон. Эталон обязан быть НЕЗАВИСИМЫМ вычислением; если он ' +
        'запрещён, property-тест сравнивает формулу сам с собой.',
    ).toEqual([]);
  });

  it('исключение НЕ мёртвое: `ms.ts` содержит запрещённую форму и при этом проходит линт', async () => {
    // Именно `codeLines`, а не сырой текст: шапка `ms.ts` цитирует `* sampleRate` словами,
    // и проверка по сырому тексту прошла бы даже с пустым файлом. Дефект найден протоколом
    // ручных нарушений этой сессии и записан в отчёте.
    const code = codeLines(readSource(EXEMPT)).join('\n');
    expect(
      MUL_BY_RATE.test(code),
      `${EXEMPT} перестал содержать \`* sampleRate\` — исключение в eslint.config.js стало ` +
        'мёртвой конфигурацией и обязано быть снято.',
    ).toBe(true);
    expect(t1Errors(await lint([EXEMPT]))).toEqual([]);
  });

  it('исключение УЗКОЕ: соседний файл в том же каталоге под правилом остаётся', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/core-model/src/time/__t1_neighbour__.ts',
        source: 'export const bad = (ms: number, sampleRate: number): number => ms * sampleRate;\n',
      },
    ]);
    expect(
      t1Errors(messages).length,
      'Исключение выписано на каталог, а не на файл: сосед `ms.ts` тоже получил право писать ' +
        'вторую формулу перевода.',
    ).toBeGreaterThan(0);
  });
});
