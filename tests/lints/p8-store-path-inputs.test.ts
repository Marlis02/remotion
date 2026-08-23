// **P8** (вторая половина) — модуль стора не может УЗНАТЬ, где `~`, а тесты не могут туда попасть.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ОХРАННИК, А НЕ СТРОЧКА В ОТЧЁТЕ. P8 («`.store` вне дерева проекта»)
// исполняется двумя вещами сразу: отказом `resolveStorePath` на пути внутри дерева (это
// проверяет `packages/media/test/store-layout.test.ts`) и тем, что путь ВООБЩЕ не берётся из
// окружения — ни `os.homedir()`, ни `os.tmpdir()`, ни `process.env`. Вторая половина
// проверяется только грепом: тест на поведение не отличит «взяли из входа» от «угадали
// правильно».
//
// И ПРЯМОЕ ТРЕБОВАНИЕ ЗАДАНИЯ `M-01`: тест, пишущий в домашний каталог владельца, не
// принимается. Здесь это свойство репозитория, а не обещание автора: тесты пакета `media`
// физически не знают, где настоящий `~` — вызова `homedir()` в них нет ни одного.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines, moduleSpecifiers, readSource, sourceFiles } from '../boundaries/repo';

const STORE = 'packages/media/src/store/';

/** Вызовы, которыми программа узнаёт про окружение вместо того, чтобы взять его входом. */
const AMBIENT_CALL = /\b(homedir|tmpdir|userInfo)\s*\(/;

/** Домашний каталог — то, чего не должен знать НИ ОДИН тест пакета (`os.tmpdir()` им можно). */
const HOME_CALL = /\bhomedir\s*\(/;

function storeFiles(): string[] {
  return sourceFiles('media').filter((file) => file.startsWith(STORE));
}

function testFiles(): string[] {
  const base = path.join(ROOT, 'packages/media/test');
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `packages/media/test/${name}`);
}

describe('**P8** — путь стора приходит входом, а не из окружения', () => {
  it('в `media/src/store/**` нет импорта `node:os`', () => {
    const offenders: string[] = [];
    for (const file of storeFiles()) {
      for (const specifier of moduleSpecifiers(readSource(file))) {
        if (/^(node:)?os$/.test(specifier)) offenders.push(`${file} → "${specifier}"`);
      }
    }
    expect(
      offenders,
      'Модуль стора начал спрашивать окружение. `homedir`/`tmpdir` — ВХОДЫ (`StorePathContext`), ' +
        'иначе «вне дерева проекта» проверяется совпадением, а не правилом. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('в `media/src/store/**` нет вызовов `homedir()`/`tmpdir()`/`userInfo()`', () => {
    const offenders: string[] = [];
    for (const file of storeFiles()) {
      for (const [index, line] of codeLines(readSource(file)).entries()) {
        if (AMBIENT_CALL.test(line)) offenders.push(`${file}:${String(index + 1)} — ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('охранник не мёртвый: `homedir` объявлен ВХОДОМ и используется в резолве', () => {
    const layout = codeLines(readSource(`${STORE}layout.ts`)).join('\n');
    expect(layout).toMatch(/readonly homedir: string/);
    expect(layout).toMatch(/context\.homedir/);
  });

  it('ни один тест `media` не зовёт `homedir()` — настоящий `~/.vpe` им недостижим', () => {
    const files = testFiles();
    expect(files.length, 'тестов пакета не нашлось — охранник стережёт пустоту').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      for (const [index, line] of codeLines(readSource(file)).entries()) {
        if (HOME_CALL.test(line)) offenders.push(`${file}:${String(index + 1)} — ${line.trim()}`);
      }
    }
    expect(
      offenders,
      'Тест пакета `media` узнал настоящий домашний каталог. Задание `M-01`: тест, пишущий в ' +
        'домашний каталог машины владельца, не принимается — временные каталоги только в ' +
        '`os.tmpdir()`. Найдено: ' + offenders.join('; '),
    ).toEqual([]);
  });

  it('и при этом тесты пакета действительно пишут во временный каталог', () => {
    const sources = testFiles().map((file) => readSource(file)).join('\n');
    expect(sources).toMatch(/mkdtempSync\(/);
    expect(sources).toMatch(/tmpdir\(\)/);
  });
});
