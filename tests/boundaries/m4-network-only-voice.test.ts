// M4 (ADR-0009 тест 7): сеть — только в `voice`. Ни один другой пакет не обращается к сети.
// Это исполнимая форма Charter V9 («рендерер глупый: во время рендера нет сети, TTS, поиска
// ассетов»); сетевой binder дополнительно помечается `requiresNetwork: true` (задача `V-05`).
//
// Проверяются обе формы обращения к сети: импорт модуля (`node:http`, `undici`, `ws`, …)
// и **глобал** `fetch` — второй не ловится грепом по импортам, поэтому охранник двойной:
//   (а) греп по `packages/*/src/**` всех пакетов, кроме `voice`;
//   (б) программный прогон ESLint по временным файлам-нарушителям.
import { describe, expect, it } from 'vitest';

import {
  PACKAGES,
  errorsFor,
  lintTemporary,
  moduleSpecifiers,
  readSource,
  sourceFiles,
} from './repo';
import type { PackageName } from './repo';

const NETWORK_SPECIFIER =
  /^(node:)?(http|https|http2|net|tls|dgram)$|^(undici|ws|node-fetch|axios|got|superagent)(\/.*)?$/;

/** `fetch(` как глобал: не `foo.fetch(`, не `this.fetch(`, не объявление своей функции. */
const BARE_FETCH = /(^|[^.\w$])fetch\s*\(/;

const NON_VOICE = PACKAGES.filter((p): p is Exclude<PackageName, 'voice'> => p !== 'voice');

describe('M4 — сеть только в `voice`', () => {
  it('(а) греп: ни один пакет кроме voice не импортирует сетевые модули', () => {
    const offenders: string[] = [];
    for (const pkg of NON_VOICE) {
      for (const file of sourceFiles(pkg)) {
        for (const spec of moduleSpecifiers(readSource(file))) {
          if (NETWORK_SPECIFIER.test(spec)) offenders.push(`${file} → "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      'M4 (ADR-0009 тест 7) нарушен: сеть разрешена только в `voice`. Найдено: ' +
        offenders.join(', '),
    ).toEqual([]);
  });

  it('(а) греп: ни один пакет кроме voice не зовёт глобальный fetch', () => {
    const offenders: string[] = [];
    for (const pkg of NON_VOICE) {
      for (const file of sourceFiles(pkg)) {
        if (BARE_FETCH.test(readSource(file))) offenders.push(file);
      }
    }
    expect(
      offenders,
      'M4 нарушен: `fetch` как глобал — тоже сеть, и импортом он не виден. Найдено: ' +
        offenders.join(', '),
    ).toEqual([]);
  });

  it('(б) ESLint: импорт node:https в compile — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/compile/src/__m4_probe_import__.ts',
        source: 'import https from "node:https";\nexport const probe = https;\n',
      },
    ]);
    const errors = errorsFor(messages, 'no-restricted-imports');
    expect(
      errors.length,
      'Охранник M4 (импорты) в eslint.config.js молчит на прямом нарушении.',
    ).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('M4');
  });

  it('(б) ESLint: глобальный fetch в renderer-hyperframes — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/renderer-hyperframes/src/__m4_probe_fetch__.ts',
        source: 'export const probe = () => fetch("http://example.invalid");\n',
      },
    ]);
    const errors = errorsFor(messages, 'no-restricted-globals');
    expect(
      errors.length,
      'Охранник M4 (глобали) молчит: `fetch` не ловится `no-restricted-imports`, и без ' +
        '`no-restricted-globals` сеть протекает мимо теста.',
    ).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('M4');
  });

  it('(б) ESLint: в `voice` и то, и другое законно', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__m4_control__.ts',
        source:
          'import https from "node:https";\n' +
          'export const probe = () => fetch("http://example.invalid");\n' +
          'export const agent = https;\n',
      },
    ]);
    expect(
      [...errorsFor(messages, 'no-restricted-imports'), ...errorsFor(messages, 'no-restricted-globals')],
      '`voice` — единственный пакет, которому сеть разрешена (ADR-0009 тест 7).',
    ).toEqual([]);
  });
});
