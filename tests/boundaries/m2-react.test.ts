// M2 (ADR-0009 тест 2): `react` не импортирует НИКТО — пакета в проекте нет.
// Композиции выбранного рендерера — HTML + GSAP, а не React (`FACT` SP-3c §6, SP-3f §3),
// поэтому правило «react не протекает в пять пакетов» стало «`react` и `react-dom`
// отсутствуют в `pnpm-lock.yaml` и ни в одном `package.json`»: это сильнее и дешевле.
//
// Оговорка, входящая в тест (ADR-0009, invariants M2): правило действует, пока не включён
// откат №4 ADR-0008 (Remotion-адаптер). При его включении строка возвращается к прежней
// формулировке — правкой инварианта, а не молчаливым исключением в этом файле.
import { describe, expect, it } from 'vitest';

import { LOCKFILE, dependencyEntries, lockfilePackageNames } from './repo';

const FORBIDDEN = ['react', 'react-dom'] as const;

describe('M2 — `react` и `react-dom` отсутствуют в проекте целиком', () => {
  it('ни один package.json их не объявляет', () => {
    const offenders = dependencyEntries()
      .filter((e) => (FORBIDDEN as readonly string[]).includes(e.name))
      .map((e) => `${e.manifest.relPath} → ${e.field}.${e.name}@${e.range}`);

    expect(
      offenders,
      'M2 (ADR-0009 тест 2) нарушен: `react`/`react-dom` в проекте нет ни у кого — композиции ' +
        'HyperFrames это HTML + GSAP. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it(`их нет в ${LOCKFILE}`, () => {
    const names = lockfilePackageNames();
    const offenders = FORBIDDEN.filter((n) => names.has(n));

    expect(
      offenders,
      `M2 нарушен: в ${LOCKFILE} присутствует ` + offenders.join(', ') +
        '. Пакет мог прийти транзитивно — проверьте `pnpm why`.',
    ).toEqual([]);
  });
});
