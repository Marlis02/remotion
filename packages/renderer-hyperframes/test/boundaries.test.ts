// Границы пакета — то, что охранник графа ADR-0009 проверить не может.
//
// `tests/boundaries/adr0009-graph.test.ts` читает `dependencies` из `package.json`. Этого мало
// в одном месте: `@vpe/media` стоит здесь в `devDependencies` (решение владельца `H-01`,
// поправка A — сквозной тест «кадры → артефакт» зовёт `buildSegmentArtifact`), а
// `devDependencies` охранник графа не смотрит. Значит правило «`src/**` не знает `media`»
// обязано иметь СВОЙ охранник — иначе стрелка протекла бы через тестовую зависимость.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Текст файла БЕЗ комментариев.
 *
 * Греп по сырому тексту краснеет на слове `fetch` внутри объяснения, почему `fetch` здесь не
 * используется, — то есть наказывает за документирование решения. Комментарии срезаются
 * грубо (строчные и блочные), и этого достаточно: искомые формы — импорты и вызовы, они в
 * строковых литералах не живут.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

/** Все файлы каталога рекурсивно. */
function filesOf(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...filesOf(abs, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(abs);
  }
  return out;
}

const srcFiles = filesOf(path.join(PKG, 'src'), ['.ts', '.js']);
const binFiles = filesOf(path.join(PKG, 'bin'), ['.ts']);

describe('ADR-0009 — стрелки пакета, которых охранник графа не видит', () => {
  it('`src/**` не импортирует `@vpe/media` НИ ОДНОЙ строкой', () => {
    // Стрелки `renderer-hyperframes → media` в карте нет (решение владельца, поправка A):
    // `SegmentArtifact` собирает `media`, а рендерер отдаёт КАДРЫ.
    const offenders = srcFiles.filter((f) => /from '@vpe\/media'/u.test(code(f)));
    expect(offenders.map((f) => path.relative(PKG, f))).toEqual([]);
  });

  it('`bin/**` тоже не импортирует `@vpe/media`: подпроцесс отдаёт кадры, а не артефакт', () => {
    const offenders = binFiles.filter((f) => /from '@vpe\/media'/u.test(code(f)));
    expect(offenders.map((f) => path.relative(PKG, f))).toEqual([]);
  });

  it('`src/**` не импортирует `compile` и `voice` — рендерер потребляет ЗНАЧЕНИЕ IR', () => {
    const offenders = srcFiles.filter((f) =>
      /from '@vpe\/(compile|voice|cli)'/u.test(code(f)),
    );
    expect(offenders.map((f) => path.relative(PKG, f))).toEqual([]);
  });

  it('`src/**` не импортирует `@vpe/schema` напрямую — бренд берётся у `core-model`', () => {
    // Пакет по карте зависит от `core-model` и `templates-spec`; `@vpe/schema` из него не
    // резолвится вовсе (образец — `packages/compile/src/timeline/types.ts`).
    const offenders = srcFiles.filter((f) => /from '@vpe\/schema'/u.test(code(f)));
    expect(offenders.map((f) => path.relative(PKG, f))).toEqual([]);
  });

  it('`@vpe/media` стоит в `devDependencies`, а НЕ в `dependencies`', () => {
    const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@vpe/core-model',
      '@vpe/templates-spec',
      'gsap',
      'hyperframes',
    ]);
    expect(manifest.devDependencies['@vpe/media']).toBe('workspace:*');
  });

  it('внешних зависимостей ровно две — `hyperframes` и `gsap` (карта ADR-0009 дословно)', () => {
    const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const external = Object.keys(manifest.dependencies).filter((n) => !n.startsWith('@vpe/'));
    // `zod` здесь НЕТ намеренно: карта называет внешние зависимости этого пакета поимённо,
    // и добавление третьей было бы правкой карты, а не деталью реализации.
    expect(external.sort()).toEqual(['gsap', 'hyperframes']);
  });

  it('сеть в `src/**` не появляется ни одним импортом (**M4**)', () => {
    const offenders = srcFiles.filter((f) =>
      /from 'node:(http|https|net|dgram|tls)'|\bfetch\s*\(/u.test(code(f)),
    );
    expect(offenders.map((f) => path.relative(PKG, f))).toEqual([]);
  });
});
