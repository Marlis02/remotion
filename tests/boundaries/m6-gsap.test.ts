// M6 (ADR-0009 тест 2a): `gsap` и его плагины (`SplitText`, `MorphSVGPlugin`) объявляет
// только `renderer-hyperframes`.
//
// Отдельной строкой, а не «деталью рендерера»: GSAP — источник кривых движения. Его версия
// входит в `engineFingerprint` (R14) и в реестр easing (D5), и протечка в `compile`
// означала бы, что easing вычисляется в двух местах.
import { describe, expect, it } from 'vitest';

import { dependencyEntries, lockfileImporterDeps, lockfilePackageNames } from './repo';

const ALLOWED = new Set(['@vpe/renderer-hyperframes']);
const ALLOWED_IMPORTERS = new Set(['packages/renderer-hyperframes']);

// `gsap`, `@gsap/*` (в том числе `@gsap/shockingly` — канал доставки плагинов),
// а также любые пакеты-обёртки вида `gsap-*`.
const isGsap = (name: string): boolean =>
  name === 'gsap' || name.startsWith('@gsap/') || name.startsWith('gsap-');

describe('M6 — `gsap` только у `renderer-hyperframes`', () => {
  it('ни один посторонний package.json не объявляет gsap', () => {
    const offenders = dependencyEntries()
      .filter((e) => isGsap(e.name))
      .filter((e) => !ALLOWED.has(e.manifest.id))
      .map((e) => `${e.manifest.relPath} → ${e.field}.${e.name}`);

    expect(
      offenders,
      'M6 (ADR-0009 тест 2a) нарушен: `gsap` — источник кривых движения, его версия входит в ' +
        '`engineFingerprint` (R14) и в реестр easing (D5). Разрешён только в ' +
        '`@vpe/renderer-hyperframes`. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('compile не объявляет gsap — иначе easing вычислялся бы в двух местах', () => {
    const inCompile = dependencyEntries().filter(
      (e) => e.manifest.id === '@vpe/compile' && isGsap(e.name),
    );
    expect(inCompile.map((e) => e.name), 'M6: протечка gsap в `compile`.').toEqual([]);
  });

  it('в pnpm-lock.yaml gsap объявлен только разрешённым importer-ом', () => {
    const present = [...lockfilePackageNames()].filter(isGsap);
    if (present.length === 0) return; // R-01: пакет не установлен

    const offenders: string[] = [];
    for (const [importer, deps] of lockfileImporterDeps()) {
      if (ALLOWED_IMPORTERS.has(importer)) continue;
      for (const dep of deps) if (isGsap(dep)) offenders.push(`${importer} → ${dep}`);
    }
    expect(
      offenders,
      'M6: в pnpm-lock.yaml gsap объявлен посторонним пакетом: ' + offenders.join(', '),
    ).toEqual([]);
  });
});
