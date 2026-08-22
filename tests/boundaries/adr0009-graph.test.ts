// Граф зависимостей между пакетами — строго по стрелкам карты ADR-0009, ни одной лишней.
//
// Это не отдельный инвариант реестра, а охранник самой раскладки: M1/M2/M6 проверяют, что
// наружу не течёт чужая библиотека, а этот тест — что внутрь не течёт лишний пакет. Без него
// «стрелки вниз» остались бы соглашением: `renderer-hyperframes` зависит от `core-model`, а
// НЕ от `compile` (рендерер потребляет значение IR, а не компилятор), и заметить обратное
// можно было бы только на ревью.
import { describe, expect, it } from 'vitest';

import { PACKAGES, manifests } from './repo';
import type { PackageName } from './repo';

/** Карта ADR-0009, Decision — дословно. */
const ARROWS: Record<PackageName, readonly PackageName[]> = {
  'schema': [],
  'core-model': ['schema'],
  'media': ['schema', 'core-model'],
  'voice': ['core-model', 'media'],
  'templates-spec': ['core-model'],
  'compile': ['core-model', 'media', 'voice', 'templates-spec'],
  'renderer-hyperframes': ['core-model', 'templates-spec'],
  'cli': [...PACKAGES].filter((p): p is Exclude<PackageName, 'cli'> => p !== 'cli'),
};

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

function declared(pkg: PackageName): string[] {
  const manifest = manifests().find((m) => m.id === `@vpe/${pkg}`);
  const deps = (manifest?.json['dependencies'] ?? {}) as Record<string, string>;
  return Object.keys(deps)
    .filter((n) => n.startsWith('@vpe/'))
    .map((n) => n.slice('@vpe/'.length));
}

describe('ADR-0009 — стрелки графа пакетов', () => {
  for (const pkg of PACKAGES) {
    it(`${pkg} зависит ровно от [${ARROWS[pkg].join(', ') || '—'}]`, () => {
      expect(
        sorted(declared(pkg)),
        `Граф ADR-0009 нарушен у \`${pkg}\`. Лишняя стрелка — это протёкшая граница, а не ` +
          `удобство: каждая стрелка соответствует строке «НЕ знает» из ADR-0001.`,
      ).toEqual(sorted(ARROWS[pkg]));
    });
  }

  it('циклов нет; `cli` — единственный пакет, который знает про всех', () => {
    const seen = new Set<PackageName>();
    const stack = new Set<PackageName>();
    const cycles: string[] = [];
    const visit = (pkg: PackageName, trail: PackageName[]): void => {
      if (stack.has(pkg)) {
        cycles.push([...trail, pkg].join(' → '));
        return;
      }
      if (seen.has(pkg)) return;
      stack.add(pkg);
      for (const dep of ARROWS[pkg]) visit(dep, [...trail, pkg]);
      stack.delete(pkg);
      seen.add(pkg);
    };
    for (const pkg of PACKAGES) visit(pkg, []);

    expect(cycles, 'Цикл в графе пакетов: ' + cycles.join('; ')).toEqual([]);
    expect(ARROWS['cli'].length).toBe(PACKAGES.length - 1);
  });
});
