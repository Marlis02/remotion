// **ДЕМО КАЖДОЙ ПАПКИ ЧИТАЕТСЯ И КОМПИЛИРУЕТСЯ — БЕЗ БРАУЗЕРА** (`TPL-01c`, охранник §B5.1).
//
// ЧТО ЭТОТ ФАЙЛ УТВЕРЖДАЕТ И ПОЧЕМУ ЭТОГО ДОСТАТОЧНО. Кривое демо обязано краснить прогон
// ДО браузера: рендер стоит минуты, а всё, чем демо бывает криво, видно раньше — файл не
// разбирается, ассет не найден, alias не объявлен, `params` не проходят схему шаблона,
// якорь не резолвится, запись зовёт шаблон вне реестра. Всё это ловит компиляция до IR,
// и она идёт ТЕМ ЖЕ `runPipeline`, каким идёт `vpe build`: собственная «облегчённая»
// компиляция проверяла бы не то, что собирается.
//
// СПИСКА ШАБЛОНОВ ЗДЕСЬ НЕТ. Он вычисляется по каталогу библиотеки (`loadTemplateLibrary`),
// ровно как это сделано у охранников `TPL-01a`: поимённый список — это место, которое правит
// каждый новый шаблон, и краснеет оно не тем, чем нужно.
//
// ═══ ЗДЕСЬ ЖЕ — ОБЕ КОМПЕНСАЦИИ ЗОНЫ NUL (`tests/lints/nul-in-sources.test.ts`) ═══
// Литеральный NUL разрешён в `<id>@<N>/demo/assets/**`, и разрешение это стоит ровно
// столько, сколько стоят две проверки ниже: **байты сверяются с литералом** (подложить в
// зону «что угодно» нельзя) и **сирот не бывает** (файл, которого не называет `demo.json`
// своей папки, — красный). Те же две компенсации и по тем же причинам, что у соседней зоны
// `gate-requests/assets/**`.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readStoreLock } from '@vpe/media';
import { loadTemplateLibrary, templateDemoDir } from '@vpe/renderer-hyperframes';
import { DEMO_ASSETS_DIR, demoOf, demoFileOf, presetNames } from '@vpe/templates-spec';

import { readProject } from '../src/build-stages/inputs.js';
import { runPipeline } from '../src/build-stages/pipeline.js';
import {
  aliasesText,
  demoRecordId,
  directionText,
  materializeDemoProject,
  presetsShown,
  templatesWithDemo,
} from '../src/template-demo.js';

import { countingRandom } from './build-fixture.js';

const library = loadTemplateLibrary();
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-demo-test-'));
  roots.push(root);
  return root;
}

const sha256File = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

/** Шаблоны каталога, у которых есть демо, — вычислено, а не выписано. */
const withDemo = library.loaded.filter((item) => demoOf(item) !== null);

describe('`demo/` есть у каждого шаблона каталога', () => {
  it('шаблонов без демо не осталось ни одного', () => {
    // Решение владельца `TPL-01c`: отсутствие демо — ПРЕДУПРЕЖДЕНИЕ в `template list`, а не
    // отказ. Но семь старых шаблонов демо получили в этой же задаче, поэтому здесь равенство:
    // упасть обязан тот, кто заведёт восьмой шаблон и забудет про демо.
    const names = library.loaded.map((item) => item.name);
    expect(templatesWithDemo(library.loaded)).toEqual(names);
    expect(withDemo.length).toBeGreaterThan(0);
  });
});

describe.each(withDemo.map((item) => [item.name, item] as const))(
  '`%s` — демо читается, разворачивается и КОМПИЛИРУЕТСЯ до IR',
  (name, item) => {
    const demo = demoOf(item);
    const demoFile = demoFileOf(item);
    if (demo === null || demoFile === null) throw new Error(`демо \`${name}\` не прочитано`);

    it('файл демо назвал все свои файлы, и они на месте', () => {
      for (const asset of [...demo.assets, ...demo.fonts]) {
        const file = path.resolve(path.dirname(demoFile), asset.file);
        expect(existsSync(file), `${name}: ${asset.file}`).toBe(true);
      }
    });

    it('демо показывает ВСЕ пресеты своего шаблона', () => {
      // Требование задания §B2: «по одной записи на каждый пресет шаблона, чтобы демо
      // показывало ВСЕ пресеты последовательно». Проверяется РАВЕНСТВОМ множеств, а не
      // включением: пресет, которого демо не показывает, — это ручка, которую владелец не
      // увидит ни разу.
      expect(presetsShown(demo)).toEqual(presetNames(item.spec));
    });

    it('разворачивается в проект и компилируется до IR — тем же конвейером, что `vpe build`', async () => {
      const root = tempRoot();
      const project = materializeDemoProject(name, demo, path.dirname(demoFile), root);

      const inputs = readProject({
        projectDir: project.projectDir,
        buildDir: project.buildDir,
        takesRoot: null,
        storeDir: project.storeDir,
      });
      const result = await runPipeline({
        project: inputs,
        registry: library.registry,
        lock: readStoreLock(path.join(project.projectDir, 'store.lock')),
        now: '2026-09-10T00:00:00.000Z',
        randomBytes: countingRandom(),
        allowTts: true,
        runtime: {},
        secrets: () => undefined,
      });

      // Сегменты есть, кадры есть: демо, у которого нечего рендерить, — не демо.
      expect(result.ir.segments.length).toBeGreaterThan(0);
      const frames = result.ir.segments.reduce(
        (sum, segment) => sum + segment.segmentDurationInFrames,
        0,
      );
      expect(frames).toBeGreaterThan(0);

      // Названный шаблон РИСУЕТ в этом IR — либо он аудио-домена и в клипы не попадает
      // никогда (`bed@1`, долг №189). Второй случай назван явно, а не прощён молчанием.
      const calls = new Set(
        result.ir.segments.flatMap((segment) => segment.clips.map((clip) => clip.template)),
      );
      const audioOnly = demo.records.every((record) => (record.template ?? name) !== name || record.track === 'music');
      expect(calls.has(name) || audioOnly, `${name}: клипы IR — ${[...calls].join(', ')}`).toBe(true);
    });
  },
);

describe('раскладка временного проекта — то, что обещает шапка команды', () => {
  const item = withDemo[0];
  if (item === undefined) throw new Error('в каталоге нет ни одного демо');
  const demo = demoOf(item);
  const demoFile = demoFileOf(item);
  if (demo === null || demoFile === null) throw new Error('демо не прочитано');

  it('sha ассета СЧИТАЕТСЯ по байтам, и по нему же лежит блоб в CAS', () => {
    const root = tempRoot();
    const project = materializeDemoProject(item.name, demo, path.dirname(demoFile), root);
    expect(project.blobs.length).toBe(demo.assets.length + demo.fonts.length);
    for (const blob of project.blobs) {
      expect(blob.sha256).toBe(sha256File(blob.file));
      const inStore = path.join(
        project.storeDir,
        blob.sha256.slice(0, 2),
        blob.sha256.slice(2, 4),
        blob.sha256,
      );
      expect(existsSync(inStore), inStore).toBe(true);
      expect(sha256File(inStore)).toBe(blob.sha256);
    }
  });

  it('`~/.vpe/store` не назван ни одним путём раскладки', () => {
    const root = tempRoot();
    const project = materializeDemoProject(item.name, demo, path.dirname(demoFile), root);
    // Прямая проверка обещания шапки: CAS демо лежит ВНУТРИ временного корня, и никакой
    // другой каталог командой не адресуется.
    expect(project.storeDir.startsWith(root)).toBe(true);
    expect(project.projectDir.startsWith(root)).toBe(true);
    expect(project.buildDir.startsWith(root)).toBe(true);
  });
});

describe('`recordId` демо детерминирован', () => {
  it('одна и та же пара (шаблон, номер) даёт одно и то же значение', () => {
    expect(demoRecordId('kenburns@1', 0)).toBe(demoRecordId('kenburns@1', 0));
    expect(demoRecordId('kenburns@1', 0)).not.toBe(demoRecordId('kenburns@1', 1));
    expect(demoRecordId('kenburns@1', 0)).not.toBe(demoRecordId('still@1', 0));
  });

  it('форма — восемь строчных hex, как требует `direction/1`', () => {
    for (const item of withDemo) {
      const demo = demoOf(item);
      if (demo === null) continue;
      for (let i = 0; i < demo.records.length; i += 1) {
        expect(demoRecordId(item.name, i)).toMatch(/^[0-9a-f]{8}$/u);
      }
    }
  });
});

describe('порождённые тексты канонические', () => {
  it('алиасы сортируются, а не идут в порядке файла', () => {
    const text = aliasesText([
      { alias: 'zebra', sha256: 'b'.repeat(64) },
      { alias: 'alpha', sha256: 'a'.repeat(64) },
    ]);
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zebra'));
  });

  it('`direction/1` несёт шапку семейства и по записи на каждую запись демо', () => {
    const item = withDemo.find((loaded) => loaded.name === 'kenburns@1');
    const demo = item === undefined ? null : demoOf(item);
    if (item === undefined || demo === null) throw new Error('нет демо `kenburns@1`');
    const text = directionText(demo, item.name);
    expect(text.startsWith('schema: direction/1\n')).toBe(true);
    expect(text.split('recordId:').length - 1).toBe(demo.records.length);
    // Умолчание `template` — шаблон СВОЕЙ папки; в тексте оно обязано быть выписано.
    expect(text.split(`"${item.name}"`).length - 1).toBeGreaterThanOrEqual(1);
  });
});

// ═══ ДВЕ КОМПЕНСАЦИИ ЗОНЫ NUL — см. шапку файла ═══
describe('свои файлы демо (`demo/assets/**`): байты сверены, сирот нет', () => {
  /** Файлы зоны с их sha256 — ЛИТЕРАЛОМ. Строка сюда добавляется вместе с файлом. */
  const EXPECTED_BYTES: Readonly<Record<string, string>> = {
    'bed@1/demo/assets/bed-loop.wav':
      '82268f1e3ede4dfe80b51c9dd816cdf873d0b8f1772467a8fb94a813fe9df026',
    // `VID-02a`, 2026-09-11. Синтетика `testsrc2`, 320×180, 48 кадров при 24/1 fps.
    // Своя, а не из `gate-requests/`, по измеренной причине: видео гейта 64×36 на полном
    // кадре нечитаемо, а частота 24 против канальных 30 нужна обоим — на ней и видно повтор
    // кадров, ради которого `video@1` вообще имеет отображение.
    //
    // *(Изменено: `VID-02b`, 2026-09-12 — в файл ДОБАВЛЕНА звуковая дорожка `sine 440 Гц`,
    // 24 000 Гц, моно, AAC 48 кбит/с; было 21 580 Б без звука, стало 35 252 Б со звуком.)*
    // **КАРТИНКА НЕ ТРОНУТА НИ БИТОМ:** видеопоток скопирован (`-c:v copy`), 48 кадров как
    // были, битрейт 80 кбит/с как был. Звук понадобился потому, что два новых пресета
    // (`*-sound`) объявляют `audio: "duck"`, а демо обязано показывать ВСЕ пресеты шаблона —
    // и на видео без звуковой дорожки такой пресет даёт законный отказ компилятора.
    'video@1/demo/assets/demo-clip-320x180.mp4':
      '59471a736810630e17f66feb726af5ba36afa84846d45a630e00792668d54508',
  };

  /** Все файлы зоны, найденные обходом каталога библиотеки. */
  function zoneFiles(): readonly string[] {
    const out: string[] = [];
    for (const item of library.loaded) {
      const dir = path.join(templateDemoDir(item.name, library.dir), DEMO_ASSETS_DIR);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir).sort()) {
        out.push(`${item.name}/demo/${DEMO_ASSETS_DIR}/${file}`);
      }
    }
    return out;
  }

  it('байты каждого файла зоны равны литералу теста', () => {
    const files = zoneFiles();
    expect(files).toEqual(Object.keys(EXPECTED_BYTES).sort());
    for (const relative of files) {
      const absolute = path.join(library.dir, relative);
      expect(sha256File(absolute), relative).toBe(EXPECTED_BYTES[relative]);
    }
  });

  it('сирот нет: каждый файл зоны назван `demo.json` своей папки', () => {
    for (const item of library.loaded) {
      const demo = demoOf(item);
      const dir = path.join(templateDemoDir(item.name, library.dir), DEMO_ASSETS_DIR);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      expect(demo, `${item.name}: есть \`demo/assets/\`, но нет \`demo.json\``).not.toBeNull();
      const named = new Set(
        [...(demo?.assets ?? []), ...(demo?.fonts ?? [])].map((entry) =>
          path.basename(entry.file),
        ),
      );
      for (const file of readdirSync(dir)) {
        expect(named.has(file), `${item.name}/demo/assets/${file} — сирота`).toBe(true);
      }
    }
  });
});
