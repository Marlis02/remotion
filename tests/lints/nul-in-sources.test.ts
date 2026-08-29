// NUL (`U+0000`) в исходниках запрещён — литеральным байтом. Экранированная форма `\u0000`
// разрешена и нужна: символ у нас законный разделитель (см. ниже).
//
// ЗАЧЕМ ОХРАННИК. Литеральный NUL делает файл **бинарным для git**: `git diff` показывает
// `Bin 0 -> 4858 bytes` вместо диффа. Последствия — не косметические:
//   * ревью исчезает. Правка в таком файле не видна ни в диффе, ни в PR, ни в `git log -p`;
//   * сам символ невидим в редакторе — он неотличим от пробела, которого на его месте ждёшь;
//   * `grep`, `sed` и половина текстовых инструментов на таком файле ведут себя иначе
//     (GNU grep без `-a` объявляет «binary file matches» и не печатает строку).
// То есть литеральный NUL отключает и ревью, и поиск — два механизма, на которых стоит весь
// процесс `00-PROCESS.md`.
//
// ЧТО ИМЕННО ЗАПРЕЩЕНО, А ЧТО НЕТ. Запрещён БАЙТ `0x00` в файле. Последовательность из шести
// символов `\u0000` в исходнике — это не байт NUL, а его экранированная запись; JS-строка из
// неё получается ровно та же. То есть правило не отнимает у кода ни одной возможности, а
// требует записывать её видимо.
//
// ГДЕ ПРОВЕРЯЕТСЯ: `packages/`, `tests/`, `fixtures/` целиком, без `node_modules/` и `dist/`
// (первое чужое, второе — сборка, и в `.d.ts` NUL приезжает из исходника). **`docs/` НЕ
// проверяется**, и это названо явно: там лежат измеренные бинарные артефакты спайков —
// сорок с лишним `.pcm`-файлов SP-2 (`docs/spikes/sp2/out/`), в которых NUL законен по
// природе аудио. Проверять `docs/` значило бы завести список исключений длиной со спайк.
//
// ~~СПИСОК ИСКЛЮЧЕНИЙ ПУСТ, И ЭТО ИЗМЕРЕНО~~ *(изменено: `GATE-PREP`, 2026-08-29 — в списке
// ОДНА строка.)* Правило про исключения при этом исполнено буквально, а не обойдено: файл
// НАЗВАН здесь поимённо, с ответом на вопрос «почему он не может быть текстовым», то есть
// попал в дифф и в ревью — ровно так, как эта шапка и требовала.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT } from '../boundaries/repo';

/** Корни, в которых NUL запрещён. */
const ROOTS = ['packages', 'tests', 'fixtures'];

/** Каталоги, которые не обходим: чужое и сборка. */
const SKIP = new Set(['node_modules', 'dist', '.git']);

/**
 * Файлы, которым литеральный NUL разрешён.
 *
 * Пуст. Строка сюда добавляется только вместе с ответом на вопрос «почему этот файл не может
 * быть текстовым» — и попадает в ревью, потому что это дифф.
 */
const ALLOWED: readonly string[] = [
  // **Ассет восьми запросов гейта** (`GATE-PREP`): 32×32 PNG, шахматка с диагональным
  // градиентом. ПОЧЕМУ ОН НЕ МОЖЕТ БЫТЬ ТЕКСТОВЫМ — три причины, и ни одна не про удобство:
  //   1. его БАЙТЫ читает `materialize.ts`, кладёт в каталог композиции и считает их `sha256`
  //      в `bundle.hash`; base64 или любая текстовая форма дала бы в композиции ДРУГОЙ файл и
  //      другой хэш — то есть гейт, снятый не на той картинке;
  //   2. расширение определяется по МАГИЧЕСКИМ БАЙТАМ (`extensionOf`, правило R3), и текстовая
  //      форма отказала бы на них, а не отрисовалась;
  //   3. заменить его однопиксельной заливкой нельзя: на ровном фоне Ken Burns двигать нечего,
  //      и гейт дал бы PASS, не измерив движения — ложно-зелёный №164, измерено `H-06`.
  // Файл производный: его порождает и сверяет побайтово
  // `packages/renderer-hyperframes/test/gate-requests.test.ts`.
  'packages/renderer-hyperframes/gate-requests/assets/pattern-32.png',
];

/** Все файлы под корнями, путями от корня репозитория, в байтовом порядке. */
function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(path.relative(ROOT, abs));
    }
  };
  for (const root of ROOTS) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

/** `путь: сколько NUL` — только для файлов, где они есть и не разрешены. */
function offenders(): string[] {
  const out: string[] = [];
  for (const relPath of scannedFiles()) {
    if (ALLOWED.includes(relPath)) continue;
    let count = 0;
    for (const byte of fs.readFileSync(path.join(ROOT, relPath))) {
      if (byte === 0) count += 1;
    }
    if (count > 0) out.push(`${relPath}: ${String(count)} NUL`);
  }
  return out;
}

describe('NUL в исходниках запрещён (`CP-04fix`, 2026-08-27)', () => {
  it('ни одного байта `0x00` в `packages/`, `tests/`, `fixtures/`', () => {
    expect(
      offenders(),
      'В исходнике появился ЛИТЕРАЛЬНЫЙ NUL. Файл с ним git считает бинарным ' +
        '(`Bin 0 -> N bytes`), то есть дифф исчезает и правка перестаёт быть ревьюируемой; ' +
        'в редакторе символ неотличим от пробела. Разделитель `U+0000` — законный приём ' +
        '(инъективная склейка ключа), и запрещён не он, а его ЗАПИСЬ байтом: пишите ' +
        '`\\u0000` — поведение тождественно, а файл остаётся текстовым.',
    ).toEqual([]);
  });

  it('охранник НЕ мёртвый: он обходит настоящее дерево и видит достаточно файлов', () => {
    const files = scannedFiles();
    expect(files.length, 'обход не нашёл файлов — корни или фильтр каталогов сломались').toBeGreaterThan(200);
    expect(files).toContain('packages/compile/src/render-ir/records.ts');
    expect(files).toContain('tests/lints/nul-in-sources.test.ts');
    expect(files).toContain('fixtures/minimal/project.yaml');
    // `dist/` и `node_modules/` действительно не обходятся: в `dist` NUL приезжает из
    // исходника, и без фильтра тест краснел бы на сборке, а не на коде.
    expect(files.some((file) => file.includes('/dist/'))).toBe(false);
    expect(files.some((file) => file.includes('/node_modules/'))).toBe(false);
  });

  it('охранник РАБОТАЕТ: подставной нарушитель краснеет, экранированная форма — нет', () => {
    const probeDir = path.join(ROOT, 'tests', '__nul_probe__');
    const probe = path.join(probeDir, 'probe.ts');
    fs.mkdirSync(probeDir, { recursive: true });
    try {
      // Литеральный байт — краснеет.
      fs.writeFileSync(probe, 'export const bad = "a\u0000b";\n', 'utf8');
      expect(offenders()).toEqual(['tests/__nul_probe__/probe.ts: 1 NUL']);

      // Экранированная запись тех же шести символов — не краснеет, а строка получается та же.
      fs.writeFileSync(probe, 'export const ok = "a\\u0000b";\n', 'utf8');
      expect(offenders()).toEqual([]);
      expect('a\u0000b').toHaveLength(3);
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
  });
});
