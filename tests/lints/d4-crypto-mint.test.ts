// Расширение **D4** (`C-04`): единственный законный недетерминизм модели — минт якоря, и он
// живёт в одном файле.
//
// ПОЧЕМУ ЭТО ПРАВИЛО ВООБЩЕ ЕСТЬ. ADR-0004 §4 требует минтить id из CSPRNG (детерминированный
// минт от `ledgerRev` даёт двум веткам одинаковые id разным токенам — M3), и одновременно
// Charter V8 запрещает недетерминизм. Совмещаются эти два требования ровно одним способом:
// случайность разрешена в ОДНОМ объявленном месте, а всё остальное берёт источник параметром.
// Без линта «одно место» — обещание; с линтом — свойство.
//
// ЧЕГО ЭТОГО ПРАВИЛА НЕТ В ADR-0007 §4. Там перечислены `Math.random`, `Date.now`, `new Date`,
// `performance.now`, `toLocaleString`, `localeCompare`, `Intl` — про `node:crypto` ни слова.
// Это РАСШИРЕНИЕ, того же класса, что схлопывание пробельных в `C-02` (пометка у D8): записано
// в `docs/DEBTS.md` и обязано попасть в ADR при его следующей ревизии.

import { describe, expect, it } from 'vitest';

import { codeLines, errorsFor, lint, lintTemporary, moduleSpecifiers, readSource, sourceFiles, type LintMessage } from '../boundaries/repo';

/** Файл-исключение. Путь записан здесь И в `eslint.config.js`; тест стережёт, что он один. */
const EXEMPT = 'packages/core-model/src/anchors/mint.ts';

const CRYPTO_SPECIFIER = /^(node:)?crypto$/;

const PROBE = 'packages/core-model/src/anchors/__crypto_probe__.ts';
const NEIGHBOUR = 'packages/core-model/src/anchors/__crypto_neighbour__.ts';
const CONTROL = 'packages/voice/src/__crypto_control__.ts';

const SOURCE = "import { randomBytes } from 'node:crypto';\nexport const bad = randomBytes(16);\n";

/**
 * Сообщения именно нашего правила.
 *
 * `includes`, а не `startsWith`: у `no-restricted-imports` ESLint сам приписывает к тексту
 * префикс «'node:crypto' import is restricted from being used», и наша фраза стоит после него.
 */
function cryptoErrors(messages: LintMessage[]): LintMessage[] {
  return errorsFor(messages, 'no-restricted-imports').filter((m) => m.message.includes('Расширение D4'));
}

describe('Расширение D4 (`C-04`) — случайность в `core-model` живёт в одном файле', () => {
  it('(а) греп: `node:crypto` импортируется ровно в файле минта', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('core-model')) {
      if (file === EXEMPT) continue;
      for (const specifier of moduleSpecifiers(readSource(file))) {
        if (CRYPTO_SPECIFIER.test(specifier)) offenders.push(`${file} → "${specifier}"`);
      }
    }
    expect(
      offenders,
      'Случайность появилась в модели вне минта. Возьмите источник параметром — тип ' +
        `\`RandomBytes\`, как это делает \`syncLedger\`. Найдено: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('(б) ESLint: правило срабатывает на импорте внутри `core-model`', async () => {
    const messages = await lintTemporary([{ relPath: PROBE, source: SOURCE }]);
    expect(
      cryptoErrors(messages).length,
      'Охранник в eslint.config.js молчит на прямом нарушении: правило сломано или снято.',
    ).toBeGreaterThan(0);
    expect(cryptoErrors(messages)[0]?.message).toContain('ADR-0004 §4');
  });

  it('(б) ESLint: исключение УЗКОЕ — сосед по каталогу `anchors/` под правилом остаётся', async () => {
    const messages = await lintTemporary([{ relPath: NEIGHBOUR, source: SOURCE }]);
    expect(
      cryptoErrors(messages).length,
      'Исключение выписано на каталог, а не на файл `mint.ts`.',
    ).toBeGreaterThan(0);
  });

  it('(б) ESLint: правило не задевает другие пакеты — оно про модель', async () => {
    const messages = await lintTemporary([{ relPath: CONTROL, source: SOURCE }]);
    expect(cryptoErrors(messages)).toEqual([]);
  });

  it('исключение НЕ мёртвое: `mint.ts` действительно импортирует `node:crypto` и проходит линт', async () => {
    const code = codeLines(readSource(EXEMPT)).join('\n');
    expect(
      moduleSpecifiers(code).some((specifier) => CRYPTO_SPECIFIER.test(specifier)),
      `${EXEMPT} перестал импортировать \`node:crypto\` — исключение в eslint.config.js стало ` +
        'мёртвой конфигурацией и обязано быть снято.',
    ).toBe(true);
    expect(cryptoErrors(await lint([EXEMPT]))).toEqual([]);
  });

  it('V8 в файле минта НЕ снят: `Math.random` там запрещён по-прежнему', async () => {
    const messages = await lintTemporary([
      {
        relPath: EXEMPT.replace('mint.ts', '__mint_v8_probe__.ts'),
        source: 'export const bad = Math.random();\n',
      },
    ]);
    expect(
      errorsFor(messages, 'no-restricted-properties').length,
      'Недетерминизм обязан быть КРИПТОГРАФИЧЕСКИМ и объявленным, а не любым.',
    ).toBeGreaterThan(0);
  });
});
