// M1 (ADR-0009 тест 1): `hyperframes` и `@hyperframes/*` объявляют только
// `renderer-hyperframes` и `cli`. В частности `media` не импортирует `hyperframes` ⇒
// склейка только ffmpeg; вопрос `combineChunks()` закрыт дважды — архитектурой и тем,
// что у выбранного рендерера такого API нет вовсе.
//
// В `R-01` внешние зависимости не ставятся намеренно: охранник обязан проверяться на
// пустом дереве раньше, чем появится что проверять.
import { describe, expect, it } from 'vitest';

import { dependencyEntries, lockfileImporterDeps, lockfilePackageNames } from './repo';

const ALLOWED = new Set(['@vpe/renderer-hyperframes', '@vpe/cli']);
const ALLOWED_IMPORTERS = new Set(['packages/renderer-hyperframes', 'packages/cli']);

const isHyperframes = (name: string): boolean =>
  name === 'hyperframes' || name.startsWith('@hyperframes/');

describe('M1 — `hyperframes` только у `renderer-hyperframes` и `cli`', () => {
  it('ни один посторонний package.json не объявляет hyperframes', () => {
    const offenders = dependencyEntries()
      .filter((e) => isHyperframes(e.name))
      .filter((e) => !ALLOWED.has(e.manifest.id))
      .map((e) => `${e.manifest.relPath} → ${e.field}.${e.name}`);

    expect(
      offenders,
      'M1 (ADR-0009 тест 1) нарушен: `hyperframes` разрешён только в `@vpe/renderer-hyperframes` ' +
        'и `@vpe/cli`. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('media не объявляет hyperframes — склейка только ffmpeg', () => {
    const inMedia = dependencyEntries().filter(
      (e) => e.manifest.id === '@vpe/media' && isHyperframes(e.name),
    );
    expect(
      inMedia.map((e) => e.name),
      'M1: `media` не импортирует `hyperframes` — иначе склейка перестаёт быть «только ffmpeg».',
    ).toEqual([]);
  });

  it('в pnpm-lock.yaml hyperframes объявлен только разрешёнными importer-ами', () => {
    const present = [...lockfilePackageNames()].filter(isHyperframes);
    if (present.length === 0) return; // R-01: пакет не установлен — нарушать нечего

    const offenders: string[] = [];
    for (const [importer, deps] of lockfileImporterDeps()) {
      if (ALLOWED_IMPORTERS.has(importer)) continue;
      for (const dep of deps) if (isHyperframes(dep)) offenders.push(`${importer} → ${dep}`);
    }
    expect(
      offenders,
      'M1: в pnpm-lock.yaml hyperframes объявлен посторонним пакетом: ' + offenders.join(', '),
    ).toEqual([]);
  });
});
