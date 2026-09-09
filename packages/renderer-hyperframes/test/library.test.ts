// Дисковая половина каталога шаблонов: `readdir`/`readFile` + слияние двух источников.
//
// Браузер здесь не нужен: проверяется чтение файлов и то, что правило слияния берётся у
// `templates-spec`, а не переписывается второй раз.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TEMPLATE_LIBRARY,
  makeGateFile,
  still1,
  type AnyTemplateSpec,
  type GateRecord,
} from '@vpe/templates-spec';

import {
  LIBRARY_SUBDIR,
  gateFileSources,
  loadTemplateLibrary,
  templateLibraryDir,
  templatesSpecDir,
} from '../src/library.js';

const record: GateRecord = {
  profileId: 'draftHalf',
  N: 3,
  sha256: 'a'.repeat(64),
  framemd5: 'b'.repeat(64),
  date: '2026-08-29T00:00:00Z',
  engineFingerprint: 'c'.repeat(64),
  class: 'PASS',
};

const dir = (): string => mkdtempSync(path.join(tmpdir(), 'vpe-e00-lib-'));

/** Кладёт файл записей для шаблона в его ПАПКУ (`TPL-01a`). */
function putGates(root: string, templateId: string, bundleHash = 'd'.repeat(64)): string {
  const file = path.join(root, `${templateId}@1`, 'gates.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      makeGateFile({ namespace: null, templateId, templateVersion: 1 }, [{ gate: record, bundleHash }]),
    ),
    'utf8',
  );
  return file;
}

describe('каталог шаблонов на диске', () => {
  it('каталог библиотеки — это `src/templates` пакета `@vpe/templates-spec`, и он существует', () => {
    const spec = templatesSpecDir();
    expect(existsSync(path.join(spec, 'package.json'))).toBe(true);
    expect(templateLibraryDir()).toBe(path.join(spec, LIBRARY_SUBDIR));
    // Спеки лежат ИМЕННО там — иначе записи гейта легли бы не рядом с ними. Единица каталога
    // — ПАПКА (`TPL-01a`): `spec.ts`, `gates.json` и `gate-requests/` внутри неё.
    expect(existsSync(path.join(templateLibraryDir(), 'still@1', 'spec.ts'))).toBe(true);
    expect(existsSync(path.join(templateLibraryDir(), 'still@1', 'gates.json'))).toBe(true);
    expect(existsSync(path.join(templateLibraryDir(), 'still@1', 'gate-requests', 'final.json'))).toBe(true);
  });

  it('читаются ТОЛЬКО папки шаблонов с `gates.json`, и порядок не зависит от ФС', () => {
    const root = dir();
    putGates(root, 'flash');
    putGates(root, 'bed');
    writeFileSync(path.join(root, 'README.md'), 'не запись', 'utf8');
    writeFileSync(path.join(root, 'index.ts'), 'export const x = 1;\n', 'utf8');
    // Папка шаблона БЕЗ `gates.json` — законное состояние (`UNGATED`), а не пропуск файла.
    mkdirSync(path.join(root, 'still@1'), { recursive: true });

    expect(gateFileSources(root).map((source) => source.dirName)).toEqual(['bed@1', 'flash@1']);
  });

  it('каталога нет — отказ, а не «записей нет»', () => {
    expect(() => gateFileSources(path.join(dir(), 'нет-такого'))).toThrow(/каталога библиотеки/u);
  });

  it('манифест собирается из двух мест: запись файла доезжает до реестра', () => {
    const root = dir();
    const file = putGates(root, 'still');
    const library = loadTemplateLibrary({ dir: root, specs: [still1] });

    expect(library.dir).toBe(root);
    expect(library.loaded[0]?.file).toBe(file);
    expect(library.registry.resolve('still@1').manifest.gates).toEqual([record]);
    // Спек В КОДЕ при этом не мутирован: слияние даёт НОВЫЙ объект.
    expect(still1.manifest.gates).toEqual([]);
  });

  it('спеки без файлов — законны: ноль записей у каждого', () => {
    const library = loadTemplateLibrary({ dir: dir(), specs: TEMPLATE_LIBRARY });
    expect(library.loaded).toHaveLength(TEMPLATE_LIBRARY.length);
    expect(library.loaded.every((item) => item.entries.length === 0)).toBe(true);
  });

  it('файл без спека — отказ с полным путём (правило берётся у `templates-spec`)', () => {
    const root = dir();
    const orphan = putGates(root, 'kenburns');
    expect(() => loadTemplateLibrary({ dir: root, specs: [still1] })).toThrow(orphan);
  });

  it('ПРОД-каталог читается и несёт снятые записи: все, кроме `bed@1`, оба профиля, PASS', () => {
    const library = loadTemplateLibrary();
    expect(library.dir).toBe(templateLibraryDir());
    expect([...library.registry.names].sort()).toEqual(
      TEMPLATE_LIBRARY.map((spec: AnyTemplateSpec) => `${spec.templateId}@${String(spec.templateVersion)}`).sort(),
    );
    // ~~Ни одной записи гейта на прод-паре~~ *(изменено: `L-01`, 2026-08-30.)* Записи ПЯТИ
    // шаблонов на обоих профилях снял владелец руками по
    // [runbook](../../../docs/gate-runbook.md) и закоммитил.
    //
    // **СПИСОК ЗАГЕЙЧЕННЫХ ВЫЧИСЛЯЕТСЯ, А ОБЕ ПОЛОВИНЫ УТВЕРЖДЕНИЯ ЖИВЫ** *(изменено:
    // `TPL-01a`, 2026-09-09; долг №227 закрыт)*.
    //
    // ~~Список был ПОИМЁННЫЙ и краснел не когда что-то сломалось, а когда владелец снял гейт
    // на очередном шаблоне и закоммитил записи.~~ Кандидат «считать по каталогу» был отвергнут
    // `E-02` потому, что снял бы вторую половину — «`bed@1` записей не имеет и иметь не
    // может» (гейт на нём неисполним, долг №189). Долг просил ОДИН ассерт, который держит
    // обе половины, — вот он: множество загейченных вычисляется, а исключение НАЗЫВАЕТСЯ.
    // Восьмой шаблон, чей гейт снял владелец, теперь зелёный; `bed@1`, у которого записи
    // ВДРУГ появились бы, — красный, и это тот же отказ, что и раньше.
    const UNGATEABLE = ['bed@1'];
    const withEntries = library.loaded.filter((item) => item.entries.length > 0);
    const expected = library.loaded
      .map((item) => item.name)
      .filter((name) => !UNGATEABLE.includes(name))
      .sort();
    expect(
      withEntries.map((item) => item.name).sort(),
      'Записи гейта обязаны быть у ВСЕХ шаблонов каталога, кроме названного `bed@1`: он ' +
        'аудио-домена, в `RenderIR.clips` не попадает, и гейт на нём неисполним (долг №189). ' +
        'Шаблон без записей — это либо гейт, который владелец ещё не снял (тогда снять по ' +
        'runbook), либо новый шаблон без гейта в коммите (тогда он не имеет права быть в ' +
        'библиотеке — Charter V13).',
    ).toEqual(expected);
    for (const item of withEntries) {
      expect(item.entries.map((entry) => entry.gate.profileId).sort()).toEqual(['draftHalf', 'final']);
      expect(item.entries.every((entry) => entry.gate.class === 'PASS')).toBe(true);
      // `bundleHash` есть у КАЖДОЙ: запись старой формы (без него) сборка считает устаревшей
      // по построению (`gateStaleness`, поправка владельца П2).
      expect(item.entries.every((entry) => typeof entry.bundleHash === 'string')).toBe(true);
    }
    // Вторая половина — дословно та, ради которой список писался поимённо.
    for (const name of UNGATEABLE) {
      expect(library.loaded.find((item) => item.name === name)?.entries).toEqual([]);
    }
  });

  it('каталог, куда записи ещё не клали, создаётся вызывающим, а не молча', () => {
    const root = path.join(dir(), 'вложенный');
    mkdirSync(root, { recursive: true });
    expect(loadTemplateLibrary({ dir: root, specs: [still1] }).loaded).toHaveLength(1);
  });
});
