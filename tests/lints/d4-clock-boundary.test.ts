// **D4**, часы: системное время читается РОВНО В ОДНОМ файле — на границе процесса.
//
// ПОЧЕМУ ИСКЛЮЧЕНИЕ ВООБЩЕ ЕСТЬ. `SegmentArtifact.stats.wallMs` — поле ADR-0008: «сколько шёл
// рендер» есть свойство прогона, и измерить его нечем, кроме часов. При этом ADR-0007 §4
// запрещает `Date.now`/`performance.now` в рендер-пути, а `eslint.config.js` исполняет запрет
// на всём `packages/*/src/**`. Совмещаются они тем же приёмом, что случайность в `C-04`:
// источник разрешён в ОДНОМ объявленном месте, всё остальное берёт его параметром
// (`renderSegment(request, {clock})`).
//
// МЕСТО ВЫБРАНО РАСПОЛОЖЕНИЕМ, А НЕ ИСКЛЮЧЕНИЕМ В КОНФИГЕ. `bin/render-segment.ts` лежит вне
// `src/`, то есть вне зоны действия правила ESLint, — отдельной строки-исключения в
// `eslint.config.js` не заводится вовсе. Цена этого решения: правило «файл ровно один» ESLint
// не выражает, и его стережёт греп ниже. Решение владельца `H-01`, поправка П1.
//
// ЧЕГО ЭТОТ ОХРАННИК НЕ ДЕЛАЕТ. Не запрещает часы в ТЕСТАХ: у тестов своя зона в
// `eslint.config.js`, и подать фальшивые часы — их прямая обязанность. Проверяется другое —
// что в `bin/` часы читает один файл, а в `src/` не читает никто.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines, lintTemporary, errorsFor } from '../boundaries/repo';

/** Единственный файл, которому разрешены часы. Путь записан здесь и нигде больше. */
const EXEMPT = 'packages/renderer-hyperframes/bin/render-segment.ts';

const CLOCK = /\bDate\s*\.\s*now\b|\bperformance\s*\.\s*now\b|\bnew\s+Date\b/u;

const PROBE = 'packages/renderer-hyperframes/src/__clock_probe__.ts';

function filesUnder(rel: string, ext: string): string[] {
  const base = path.join(ROOT, rel);
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(ext)) out.push(path.relative(ROOT, abs));
    }
  };
  walk(base);
  return out;
}

describe('D4 (часы) — системное время живёт на границе процесса и больше нигде', () => {
  it('в `bin/**` часы читает РОВНО ОДИН файл, и это исключение названо поимённо', () => {
    const offenders = filesUnder('packages/renderer-hyperframes/bin', '.ts').filter((file) => {
      if (file === EXEMPT) return false;
      return codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8')).some((l) => CLOCK.test(l));
    });
    expect(
      offenders,
      `Часы появились вне единственного разрешённого файла (${EXEMPT}). Возьмите время ` +
        `параметром \`clock\`, как это делает \`renderSegment\`. Найдено: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('ИСКЛЮЧЕНИЕ НЕ МЁРТВОЕ: в названном файле часы действительно есть', () => {
    // Без этой проверки правило могло бы «выполняться» просто потому, что `wallMs` перестал
    // измеряться, — и мы бы этого не заметили.
    const source = codeLines(fs.readFileSync(path.join(ROOT, EXEMPT), 'utf8')).join('\n');
    expect(source).toMatch(CLOCK);
  });

  it('в `src/**` пакета часов нет ни в одном файле', () => {
    const offenders = filesUnder('packages/renderer-hyperframes/src', '.ts')
      .concat(filesUnder('packages/renderer-hyperframes/src', '.js'))
      .filter((file) =>
        codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8')).some((l) => CLOCK.test(l)),
      );
    expect(offenders).toEqual([]);
  });

  it('ESLint КРАСНЕЕТ на часах внутри `src/**` — исключение узкое, а не общее', async () => {
    const messages = await lintTemporary([
      { relPath: PROBE, source: 'export const t = Date.now();\n' },
    ]);
    const hits = errorsFor(messages, 'no-restricted-properties');
    expect(
      hits.length,
      'Охранник D4 молчит на `Date.now` внутри `src/**` пакета рендерера: правило снято или ' +
        'зона ESLint перестала покрывать пакет.',
    ).toBeGreaterThan(0);
  });

  it('`renderSegment` принимает часы ПАРАМЕТРОМ — источник берётся снаружи', () => {
    const run = fs.readFileSync(
      path.join(ROOT, 'packages/renderer-hyperframes/src/run.ts'),
      'utf8',
    );
    expect(run).toContain('readonly clock: () => number');
  });
});
