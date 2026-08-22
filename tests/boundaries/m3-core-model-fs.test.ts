// M3 (ADR-0009 тест 3): `core-model` не импортирует `node:fs` / `fs` / `fs/promises` —
// модель не умеет читать диск. Всё, что работает с байтами на диске, живёт в `media`.
//
// Охранник двойной, как требует задание R-01:
//   (а) греп по `packages/core-model/src/**` — ловит уже написанный код;
//   (б) программный прогон ESLint по временному файлу-нарушителю — доказывает, что правило
//       `no-restricted-imports` в `eslint.config.js` действительно СРАБАТЫВАЕТ, а не просто
//       записано. Без (б) правило можно было бы сломать опечаткой в конфиге и не заметить.
import { describe, expect, it } from 'vitest';

import { errorsFor, lintTemporary, moduleSpecifiers, readSource, sourceFiles } from './repo';

const FS_SPECIFIER = /^(node:)?fs(\/.*)?$/;

const PROBE = 'packages/core-model/src/__m3_probe__.ts';
const CONTROL = 'packages/media/src/__m3_control__.ts';

describe('M3 — `core-model` не читает диск', () => {
  it('(а) греп: в packages/core-model/src/** нет ни одного импорта fs', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('core-model')) {
      for (const spec of moduleSpecifiers(readSource(file))) {
        if (FS_SPECIFIER.test(spec)) offenders.push(`${file} → "${spec}"`);
      }
    }
    expect(
      offenders,
      'M3 (ADR-0009 тест 3) нарушен: `core-model` не умеет читать диск. Перенесите работу с ' +
        'файлами в `media`. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('(б) ESLint: правило срабатывает на файле-нарушителе внутри core-model', async () => {
    const messages = await lintTemporary([
      { relPath: PROBE, source: 'import fs from "node:fs";\nexport const probe = fs;\n' },
    ]);
    const errors = errorsFor(messages, 'no-restricted-imports');

    expect(
      errors.length,
      'Охранник M3 в eslint.config.js молчит на прямом нарушении. Правило `no-restricted-imports` ' +
        'для `packages/core-model/src/**` сломано или снято.',
    ).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('M3');
  });

  it('(б) ESLint: правило не задевает `media` — там работа с диском законна', async () => {
    const messages = await lintTemporary([
      { relPath: CONTROL, source: 'import fs from "node:fs";\nexport const probe = fs;\n' },
    ]);
    expect(
      errorsFor(messages, 'no-restricted-imports'),
      'Правило M3 не должно распространяться на `media`: CAS-store и ffmpeg-сборка — его ' +
        'прямая ответственность по карте ADR-0009.',
    ).toEqual([]);
  });
});
