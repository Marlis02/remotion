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

/** Кладёт файл записей для шаблона в каталог. */
function putGates(root: string, templateId: string, bundleHash = 'd'.repeat(64)): string {
  const file = path.join(root, `${templateId}@1.gates.json`);
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
    // Спеки лежат ИМЕННО там — иначе записи гейта легли бы не рядом с ними.
    expect(existsSync(path.join(templateLibraryDir(), 'still@1.ts'))).toBe(true);
  });

  it('читаются ТОЛЬКО файлы `*.gates.json`, и порядок не зависит от ФС', () => {
    const root = dir();
    putGates(root, 'flash');
    putGates(root, 'bed');
    writeFileSync(path.join(root, 'README.md'), 'не запись', 'utf8');
    writeFileSync(path.join(root, 'still@1.ts'), 'export const x = 1;\n', 'utf8');

    expect(gateFileSources(root).map((source) => source.fileName)).toEqual([
      'bed@1.gates.json',
      'flash@1.gates.json',
    ]);
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

  it('ПРОД-каталог читается и несёт снятые записи: ПЯТЬ шаблонов, оба профиля, PASS', () => {
    const library = loadTemplateLibrary();
    expect(library.dir).toBe(templateLibraryDir());
    expect([...library.registry.names].sort()).toEqual(
      TEMPLATE_LIBRARY.map((spec: AnyTemplateSpec) => `${spec.templateId}@${String(spec.templateVersion)}`).sort(),
    );
    // ~~Ни одной записи гейта на прод-паре~~ *(изменено: `L-01`, 2026-08-30, по точечному
    // разрешению владельца.)* Прежнее ожидание (`entries ⇒ []`) описывало каталог времён
    // `E-00`, когда реализаций не было ни одной; записи ~~четырёх~~ **ПЯТИ** шаблонов на обоих
    // профилях снял владелец руками по [runbook](../../../docs/gate-runbook.md) и закоммитил.
    // Ассерт держит ФАКТ, а не его отсутствие: `bed@1` записей не имеет и иметь не может (гейт
    // на нём неисполним, долг №189 — он аудио-домена и в `RenderIR.clips` не попадает), у
    // остальных ~~четырёх~~ **пяти** — ровно по одной записи на профиль, и обе `PASS`.
    //
    // **СПИСОК ПОИМЁННЫЙ, И ОН КРАСНЕЕТ НА КАЖДОМ НОВОМ ЗАГЕЙЧЕННОМ ШАБЛОНЕ** *(долг приёмки
    // `ENV-01`, поправлено `E-02`, 2026-08-31)*. `grade@1` прошёл гейт задачей `E-07`, его
    // записи легли в репозиторий — и этот ассерт стал красным, хотя ничего не сломалось.
    // Кандидат «считать по каталогу» (`library.loaded`, а не литерал) НЕ применён здесь
    // намеренно: он снял бы и вторую половину утверждения — «`bed@1` записей не имеет», —
    // ради которой список и писался поимённо. Долг **№227**.
    const withEntries = library.loaded.filter((item) => item.entries.length > 0);
    expect(withEntries.map((item) => item.name).sort()).toEqual([
      'captionEmphasis@1',
      'flash@1',
      'grade@1',
      'kenburns@1',
      'still@1',
    ]);
    for (const item of withEntries) {
      expect(item.entries.map((entry) => entry.gate.profileId).sort()).toEqual(['draftHalf', 'final']);
      expect(item.entries.every((entry) => entry.gate.class === 'PASS')).toBe(true);
      // `bundleHash` есть у КАЖДОЙ: запись старой формы (без него) сборка считает устаревшей
      // по построению (`gateStaleness`, поправка владельца П2).
      expect(item.entries.every((entry) => typeof entry.bundleHash === 'string')).toBe(true);
    }
    expect(library.loaded.find((item) => item.name === 'bed@1')?.entries).toEqual([]);
  });

  it('каталог, куда записи ещё не клали, создаётся вызывающим, а не молча', () => {
    const root = path.join(dir(), 'вложенный');
    mkdirSync(root, { recursive: true });
    expect(loadTemplateLibrary({ dir: root, specs: [still1] }).loaded).toHaveLength(1);
  });
});
