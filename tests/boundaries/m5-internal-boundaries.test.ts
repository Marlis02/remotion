// M5 (ADR-0009 Decision): внутренние границы `compile` и `media`.
//   `compile/src/render-ir/**` ↛ `compile/src/timeline/**` и обратно — «IR не знает Timeline»;
//   `media/src/cache/**`      ↛ `media/src/audio/**`      и обратно.
//
// Эта граница СЛАБЕЕ пакетной и понижена в ранге осознанно (ADR-0009, Consequences):
// её можно снять строкой `// eslint-disable`. Смягчение — правило в CI и видимость снятия
// в диффе. Поэтому единственный способ считать M5 охраняемым — проверять, что правило
// действительно роняет ESLint, а не только записано в конфиге.
//
// Каждый случай создаёт ДВА временных файла: нарушителя и цель импорта. Второй обязателен —
// `import/no-restricted-paths` выходит из проверки раньше зон, если путь не разрешился в
// существующий файл; без цели тест был бы зелёным при снятом правиле.
import { describe, expect, it } from 'vitest';

import { errorsFor, lintTemporary } from './repo';

const RULE = 'import/no-restricted-paths';

interface Zone {
  readonly title: string;
  readonly targetDir: string;
  readonly fromDir: string;
  /** относительный путь, которым нарушитель адресует цель */
  readonly specifier: string;
  readonly expect: string;
}

const ZONES: Zone[] = [
  {
    title: 'compile/render-ir ↛ compile/timeline',
    targetDir: 'packages/compile/src/render-ir',
    fromDir: 'packages/compile/src/timeline',
    specifier: '../timeline/x',
    expect: 'M5',
  },
  {
    title: 'compile/timeline ↛ compile/render-ir',
    targetDir: 'packages/compile/src/timeline',
    fromDir: 'packages/compile/src/render-ir',
    specifier: '../render-ir/x',
    expect: 'M5',
  },
  {
    title: 'media/cache ↛ media/audio',
    targetDir: 'packages/media/src/cache',
    fromDir: 'packages/media/src/audio',
    specifier: '../audio/x',
    expect: 'M5',
  },
  {
    title: 'media/audio ↛ media/cache',
    targetDir: 'packages/media/src/audio',
    fromDir: 'packages/media/src/cache',
    specifier: '../cache/x',
    expect: 'M5',
  },
];

describe('M5 — внутренние границы `compile` и `media`', () => {
  for (const zone of ZONES) {
    it(`ESLint роняет нарушение: ${zone.title}`, async () => {
      const messages = await lintTemporary([
        { relPath: `${zone.fromDir}/x.ts`, source: 'export const x = 1;\n' },
        {
          relPath: `${zone.targetDir}/__m5_probe__.ts`,
          source: `import { x } from '${zone.specifier}';\nexport const probe = x;\n`,
        },
      ]);
      const errors = errorsFor(messages, RULE);

      expect(
        errors.length,
        `Охранник M5 молчит на прямом нарушении «${zone.title}». Две вероятные причины: ` +
          `правило снято из eslint.config.js, либо резолвер перестал находить .ts-файлы ` +
          `(тогда import/no-restricted-paths пропускает импорт МОЛЧА).`,
      ).toBeGreaterThan(0);
      expect(errors[0]?.message).toContain(zone.expect);
    });
  }

  it('импорт внутри своей зоны законен — правило не запрещает всё подряд', async () => {
    const messages = await lintTemporary([
      { relPath: 'packages/compile/src/render-ir/y.ts', source: 'export const y = 1;\n' },
      {
        relPath: 'packages/compile/src/render-ir/__m5_control__.ts',
        source: "import { y } from './y';\nexport const probe = y;\n",
      },
    ]);
    expect(errorsFor(messages, RULE), 'M5 запрещает пересечение границы, а не импорты вообще.').toEqual([]);
  });

  it('каталоги обеих границ существуют — правило исполнимо с первого дня', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { ROOT } = await import('./repo');
    const dirs = [
      'packages/compile/src/render-ir',
      'packages/compile/src/timeline',
      'packages/media/src/cache',
      'packages/media/src/audio',
    ];
    const missing = dirs.filter((d) => !existsSync(join(ROOT, d)));
    expect(
      missing,
      'Каталоги внутренних границ созданы пустыми (с .gitkeep) намеренно: правило ' +
        '`import/no-restricted-paths` обязано быть исполнимым раньше первой строки кода.',
    ).toEqual([]);
  });
});
