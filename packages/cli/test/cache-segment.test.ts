// **МЕЖСБОРОЧНЫЙ КЭШ СЕГМЕНТОВ НА НАСТОЯЩЕЙ СБОРКЕ** (`CACHE-01`, долг №200).
//
// ═══ ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ `M-05` ═══
// `M-05` доказал **K3** на МЕХАНИЗМЕ (`cache-stage.test.ts`: `get` возвращает то, что принял
// `put`, либо ничего) и на стадии `voice`. Оговорка строки K3 в `docs/invariants.md` звучала
// дословно: «сборка фикстуры дважды целиком невоспроизводима — стадии `segment` не
// существует». Здесь она снимается: сборка идёт ДВАЖДЫ, холодной и прогретой, и сравниваются
// её выходные артефакты.
//
// БРАУЗЕРА ЗДЕСЬ НЕТ (у приёмной машины владельца-техлида Chrome нет): подменён ровно один
// вызов — запуск рендерера, — и он отдаёт НАСТОЯЩИЕ кадры. Всё ниже по течению настоящее:
// `encodeSegment`, `ffprobe`, `framemd5`, конкат, мукс. Приём и довод — те же, что у
// `build.test.ts`; счётчик вызовов подменённого рендерера и есть измерение «сколько
// отрендерено», и без него «кэш работает» было бы утверждением про время, а не про вызовы.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { StageCache, cacheManifestPath, cacheNamespaceDir, cacheValuePath } from '@vpe/media';
import {
  FRAME_PATTERN,
  FRAME_START_NUMBER,
  rendererTemplates,
  type RendererTemplateRegistry,
  type RenderResponse,
} from '@vpe/renderer-hyperframes';

import { build, type BuildDeps } from '../src/build.js';
import type { BuildArgs, VerifyAc4Args } from '../src/argv.js';
import { CliError } from '../src/errors.js';
import type { BuildRecord } from '../src/build-stages/record.js';
import { ac4BuildArgs } from '../src/verify-ac4.js';

import {
  TEST_FINGERPRINT,
  cleanupRoots,
  countingRandom,
  makePng,
  makeProject,
  writeGates,
  type TestProject,
} from './build-fixture.js';

afterAll(cleanupRoots);

/** Шаблоны, которые зовёт постановка ниже. Записи гейта пишутся ровно на них. */
const USED = ['kenburns@1', 'still@1'];

/**
 * Три сцены — три сегмента, и в двух РАЗНЫХ есть адресуемая запись режиссуры.
 *
 * Постановка взята у golden blast radius (`blast-radius.test.ts`) ДОСЛОВНО, и это не экономия:
 * охранник №2 ниже утверждает, что кэш промахивается ровно там, где промахивается ключ, — а
 * множество промахов ключа зафиксировано golden'ом ИМЕННО НА ЭТОЙ постановке. Возьми тест
 * другую прозу, он проверял бы совпадение с golden'ом, которого нет.
 */
const SOURCE = `schema: source-dialect/1

# chapter: main

## scene: one

[img: ledger] The word is short. [beat: a] The page is black.

## scene: two

The cellar keeps a lathe.

## scene: three

[img: ledger] The last one stands. [beat: c] It stands alone here.
`;

/** Две записи в разных сценах; правится ЧИСЛО одной — та же правка, что в golden (**K9**). */
function direction(scale: string): string {
  return `schema: direction/1

records:
  - recordId: "5d6e1130"
    at: { kind: anchor, anchor: "b:a" }
    track: visual
    z: 15
    template: "kenburns@1"
    params:
      easing: power2.inOut
      from:
        scale: 1.06
        x: -0.05
        y: 0
      to:
        scale: ${scale}
        x: 0.05
        y: 0
  - recordId: "9a1c07b2"
    at: { kind: anchor, anchor: "b:c" }
    track: visual
    z: 15
    template: "still@1"
    params:
      asset: "ledger"
      fit: cover
`;
}

/** Проект с трёхсценной постановкой и записями гейта на оба шаблона. */
function project(scale = '1.12'): TestProject {
  const made = makeProject();
  writeFileSync(path.join(made.projectDir, 'source/01-intro.md'), SOURCE, 'utf8');
  writeFileSync(path.join(made.projectDir, 'direction/01-intro.yaml'), direction(scale), 'utf8');
  writeGates(made.gatesDir, USED, ['final']);
  return made;
}

/** Подменённый рендерер: настоящие PNG в каталог кадров плюс счётчик вызовов. */
function frameRenderer(calls: { count: number }): NonNullable<BuildDeps['render']> {
  const png = makePng();
  return (request) => {
    calls.count += 1;
    const dir = path.join(request.tmpDir, 'frames');
    mkdirSync(dir, { recursive: true });
    const frameCount = Number(request.ir.segmentDurationInFrames);
    for (let i = 0; i < frameCount; i += 1) {
      const name = `frame_${String(FRAME_START_NUMBER + i).padStart(6, '0')}.png`;
      writeFileSync(path.join(dir, name), png);
    }
    const response: RenderResponse = {
      ok: true,
      frames: { dir, pattern: FRAME_PATTERN, startNumber: FRAME_START_NUMBER, frameCount },
      engineCompositionHash: null,
      engineFingerprint: null,
      engineProbe: null,
      browserLaunchLine: null,
      stats: { wallMs: 1, retries: 0, peakRssBytes: 1 },
    };
    return Promise.resolve(response);
  };
}

interface RunOptions {
  readonly buildDir: string;
  readonly noCache?: boolean;
  readonly templates?: RendererTemplateRegistry;
}

interface Ran {
  readonly out: string;
  readonly calls: number;
  readonly record: BuildRecord;
}

async function runBuild(made: TestProject, options: RunOptions): Promise<Ran> {
  let out = '';
  const calls = { count: 0 };
  const args: BuildArgs = {
    command: 'build',
    projectDir: made.projectDir,
    profileId: 'final',
    profilePath: null,
    allowTts: true,
    now: '2026-09-09T00:00:00.000Z',
    buildDir: options.buildDir,
    writeRoot: null,
    storeDir: made.storeDir,
    gatesDir: made.gatesDir,
    noCache: options.noCache ?? false,
  };
  const deps: BuildDeps = {
    now: () => '2026-09-09T00:00:00.000Z',
    clock: () => 0,
    randomBytes: countingRandom(),
    out: (text) => (out += text),
    env: {},
    render: frameRenderer(calls),
    fingerprint: () => TEST_FINGERPRINT,
    ...(options.templates === undefined ? {} : { templates: options.templates }),
  };
  await build(args, deps);
  const record = JSON.parse(
    readFileSync(path.join(options.buildDir, 'reports/build-record.json'), 'utf8'),
  ) as BuildRecord;
  return { out, calls: calls.count, record };
}

/** Каталог пространства имён кэша сегментов ЭТОГО проекта (корень записи — корень проекта). */
function segmentNamespace(made: TestProject): string {
  return cacheNamespaceDir(made.projectDir, { stage: 'segment', profileId: 'final' });
}

/** Ключи манифеста стадии `segment` в байтовом порядке — их множество и есть предмет `CACHE-02`. */
function manifestKeys(made: TestProject): readonly string[] {
  const manifest = JSON.parse(
    readFileSync(cacheManifestPath(made.projectDir, { stage: 'segment', profileId: 'final' }), 'utf8'),
  ) as { entries: { key: string }[] };
  return manifest.entries.map((entry) => entry.key).sort();
}

describe('**K3** на СБОРКЕ — попадание равно промаху побайтово (`CACHE-01`, долг №200)', () => {
  it('прогретая сборка не рендерит ничего, а артефакты равны холодным до байта', async () => {
    const made = project();
    const cold = await runBuild(made, { buildDir: path.join(made.root, 'cold') });
    const warm = await runBuild(made, { buildDir: path.join(made.root, 'warm') });

    // Холодная РЕНДЕРИТ каждый сегмент, прогретая — НИ ОДНОГО. Это и есть измерение: не
    // «стало быстрее» (шумит на загруженной машине), а «адаптер не позван ни разу».
    expect(cold.calls).toBe(3);
    expect(warm.calls).toBe(0);
    expect(cold.record.segments.map((row) => row.cache)).toEqual(['miss', 'miss', 'miss']);
    expect(warm.record.segments.map((row) => row.cache)).toEqual(['hit', 'hit', 'hit']);
    expect(warm.record.cache).toEqual({ mode: 'on', segments: 3, segmentHits: 3 });

    // ПОПАДАНИЕ == ПРОМАХ: сегменты равны обеими величинами (**R8**/**R9** мерили бы одну).
    expect(warm.record.segments.map((row) => row.sha256)).toEqual(
      cold.record.segments.map((row) => row.sha256),
    );
    expect(warm.record.segments.map((row) => row.framemd5Sha256)).toEqual(
      cold.record.segments.map((row) => row.framemd5Sha256),
    );
    expect(warm.record.segments.map((row) => row.frameCount)).toEqual(
      cold.record.segments.map((row) => row.frameCount),
    );

    // И ФИНАЛ — тоже: конкат с муксом ниже по течению не знает, откуда байты сегментов.
    expect(warm.record.final?.sha256).toBe(cold.record.final?.sha256);
    expect(readFileSync(path.join(made.root, 'warm/final.mp4'))).toEqual(
      readFileSync(path.join(made.root, 'cold/final.mp4')),
    );
    expect(warm.out).toContain('кэш: попадание');
  });
});

describe('**K9** на СБОРКЕ — blast radius правки `params` равен множеству промахов кэша', () => {
  it('правка одного числа одной записи даёт РОВНО ОДИН промах и один вызов рендерера', async () => {
    const made = project('1.12');
    await runBuild(made, { buildDir: path.join(made.root, 'before') });

    // Та же правка, что в golden `blast-radius.txt`: `kenburns@1`, `to.scale` 1.12 → 1.14.
    writeFileSync(path.join(made.projectDir, 'direction/01-intro.yaml'), direction('1.14'), 'utf8');
    const after = await runBuild(made, { buildDir: path.join(made.root, 'after') });

    // Golden утверждает: промахивается `seg:one`, два других ключа равны. Кэш обязан вести
    // себя ровно так же — иначе golden охранял бы не то, что делает сборка.
    const verdicts = new Map(after.record.segments.map((row) => [row.segmentId, row.cache]));
    expect(verdicts.get('seg:one')).toBe('miss');
    expect(verdicts.get('seg:two')).toBe('hit');
    expect(verdicts.get('seg:three')).toBe('hit');
    expect(after.calls).toBe(1);
    expect(after.record.cache.segmentHits).toBe(2);
  });
});

describe('ПРАВКА КОДА ШАБЛОНА ПОВЕРХ СТАРОГО КЭША — обычный промах, а не отказ K3 (`CACHE-02`)', () => {
  // ═══ ЧТО ЗДЕСЬ ПЕРЕПИСАНО И ПОЧЕМУ ═══
  // ~~`промах по композиции` — ключ есть, а `bundleHash` записи не равен `bundle.hash`.~~
  // *(изменено: `CACHE-02`, 2026-09-11.)* Вердикта больше нет, и это не переименование:
  // `bundle.hash` СТАЛ ВХОДОМ `segmentKey` (`views/segment.json`), поэтому другой код шаблона
  // даёт другой КЛЮЧ. Симптом, который лечит правка, владелец ловил каждый день: старая
  // ветка спрашивала композицию только на ЧТЕНИИ, а `put` после пересчёта шёл ТЕМ ЖЕ ключом
  // с ДРУГИМИ байтами — и падал **K3** «два разных выхода при одном ключе». То есть правка
  // шаблона роняла сборку, и лечилась она только `rm -rf .cache`.
  //
  // ПОДМЕНА — РЕАЛИЗАЦИИ, А НЕ ЗАПИСИ В МАНИФЕСТЕ: правится текст `mountSource`, то есть
  // ровно то, что меняет автор шаблона, и `bundle.hash` двигается сам, материализацией.
  const patchedTemplates = (): RendererTemplateRegistry => ({
    version: rendererTemplates.version,
    templates: rendererTemplates.templates.map((template) =>
      template.templateId === 'still' ? { ...template, mountSource: `${template.mountSource} ` } : template,
    ),
  });

  it('сборка ПРОХОДИТ поверх старого кэша: промах и рендер, ни одного отказа', async () => {
    const made = project();
    const cold = await runBuild(made, { buildDir: path.join(made.root, 'cold') });
    expect(cold.calls).toBe(3);

    const edited = await runBuild(made, {
      buildDir: path.join(made.root, 'edited'),
      templates: patchedTemplates(),
    });

    // ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗАДАЧИ: сборка ЗАВЕРШИЛАСЬ. До `CACHE-02` она падала здесь.
    expect(edited.record.final?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    // Вердикт — ОБЫЧНЫЙ промах, своим словом и без второго имени.
    expect(edited.out).toContain('кэш: промах');
    expect(edited.out).not.toContain('промах по композиции');
    expect(edited.calls).toBeGreaterThan(0);
    expect(edited.record.segments.some((row) => row.cache === 'miss')).toBe(true);
  });

  it('старые записи ОСТАЛИСЬ рядом с новыми: другой код — другой ключ, а не перезапись', async () => {
    // Вторая половина того же утверждения, и без неё первая была бы верна и у молчаливой
    // перезаписи: «промах» напечатался бы, а старая запись исчезла бы под тем же ключом.
    const made = project();
    await runBuild(made, { buildDir: path.join(made.root, 'cold') });
    const before = manifestKeys(made);

    await runBuild(made, { buildDir: path.join(made.root, 'edited'), templates: patchedTemplates() });
    const after = manifestKeys(made);

    // Сегментов три, шаблон подменён у одного (`still@1` стоит в сцене `three`) — но каталог
    // композиции материализуется на КАЖДЫЙ сегмент из ОДНОГО реестра, поэтому `bundle.hash`
    // двигается у всех трёх. Утверждение поэтому не про число, а про ВКЛЮЧЕНИЕ: ни один
    // старый ключ не потерян, и появились новые.
    for (const key of before) expect(after, `ключ ${key} исчез`).toContain(key);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('K3 всё ещё ловит НАСТОЯЩУЮ неполноту: два выхода под одним ключом — отказ', async () => {
    // Контроль осмысленности двух тестов выше: они были бы зелёными и у кэша, который
    // перестал проверять что-либо вовсе. Здесь `put` зовётся напрямую — ТЕМ ЖЕ ключом с
    // ДРУГИМИ байтами, — и обязан отказать. Это ровно то, ради чего **K3** существует:
    // «вход неполон, какая-то величина влияет на результат и не входит в `cacheKeyView`».
    const made = project();
    await runBuild(made, { buildDir: path.join(made.root, 'cold') });

    const address = { stage: 'segment', profileId: 'final' } as const;
    const manifest = JSON.parse(readFileSync(cacheManifestPath(made.projectDir, address), 'utf8')) as {
      entries: { key: string }[];
    };
    const key = manifest.entries[0]?.key ?? '';
    const cache = new StageCache(made.projectDir, address, { verify: true });

    await expect(cache.put(key, new TextEncoder().encode('другие байты'))).rejects.toThrow(
      /два разных выхода при одном ключе/u,
    );
  });
});

describe('`--no-cache` — кэш не спрашивается и не пополняется ни одной записью', () => {
  it('все строки `off`, рендерер зовётся на каждом сегменте, `.cache/` не появляется', async () => {
    const made = project();
    const ran = await runBuild(made, { buildDir: path.join(made.root, 'nocache'), noCache: true });

    expect(ran.calls).toBe(3);
    expect(ran.record.segments.map((row) => row.cache)).toEqual(['off', 'off', 'off']);
    expect(ran.record.cache).toEqual({ mode: 'off', segments: 3, segmentHits: 0 });
    expect(ran.out).toContain('кэш: выключен');
    // ОБЕ стадии выключены одним флагом: каталога `.cache` нет вовсе — ни `segment`, ни `voice`.
    expect(existsSync(path.join(made.projectDir, '.cache'))).toBe(false);

    // И повторный прогон с флагом рендерит столько же: выключенный кэш не «прогревается».
    const again = await runBuild(made, { buildDir: path.join(made.root, 'nocache-2'), noCache: true });
    expect(again.calls).toBe(3);
  });
});

describe('порча кэша — ОТКАЗ СБОРКИ с адресом, а не тихий пересчёт (**K3**)', () => {
  it('подменённый байт значения роняет сборку и советует удалить пространство имён', async () => {
    const made = project();
    await runBuild(made, { buildDir: path.join(made.root, 'cold') });

    // Та же длина, другое содержимое: размер молчит, sha256 — нет. Стадия `segment` идёт с
    // `verify: true` (решение владельца `CACHE-01` вопрос 1), поэтому подмена ловится.
    const manifest = JSON.parse(
      readFileSync(cacheManifestPath(made.projectDir, { stage: 'segment', profileId: 'final' }), 'utf8'),
    ) as { entries: { key: string }[] };
    const key = manifest.entries[0]?.key ?? '';
    const valuePath = cacheValuePath(made.projectDir, { stage: 'segment', profileId: 'final' }, key);
    const bytes = new Uint8Array(readFileSync(valuePath));
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    writeFileSync(valuePath, bytes);

    const failed = await runBuild(made, { buildDir: path.join(made.root, 'poisoned') }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(CliError);
    expect((failed as CliError).rule).toBe('K3');
    expect((failed as CliError).message).toContain('rm -rf');
    expect((failed as CliError).message).toContain(segmentNamespace(made));
  });

  it('запись манифеста без `framemd5Sha256` — тоже отказ: достроить её нечем', async () => {
    const made = project();
    await runBuild(made, { buildDir: path.join(made.root, 'cold') });

    const manifestPath = cacheManifestPath(made.projectDir, { stage: 'segment', profileId: 'final' });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      stage: string;
      entries: Record<string, unknown>[];
    };
    for (const entry of manifest.entries) delete entry['framemd5Sha256'];
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    const failed = await runBuild(made, { buildDir: path.join(made.root, 'incomplete') }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(CliError);
    expect((failed as CliError).message).toContain('framemd5Sha256');
  });
});

describe('`vpe verify ac4` — ОБА прогона идут без кэша (долг №239)', () => {
  it('аргументы обоих прогонов несут `noCache: true` — проверено без браузера и без сборки', () => {
    const args: VerifyAc4Args = {
      command: 'verify ac4',
      projectDir: '/тут/проект',
      profilePath: null,
      runRoot: '/тут/прогоны',
      storeDir: null,
      allowTts: false,
      now: '2026-09-09T00:00:00.000Z',
    };
    const first = ac4BuildArgs(args, '/тут/прогоны/run-1', args.now as string);
    const second = ac4BuildArgs(args, '/тут/прогоны/run-2', args.now as string);

    // ВТОРОЙ — по смыслу критерия: прогретый кэш ответил бы «да» на вопрос «те же ли байты у
    // кэша», а спрашивается «те же ли кадры у РЕНДЕРЕРА».
    expect(second.noCache).toBe(true);
    // ПЕРВЫЙ — ради симметрии: сравниваются два прогона, и они обязаны идти одним путём.
    expect(first.noCache).toBe(true);
    expect(first.buildDir).not.toBe(second.buildDir);
  });
});

describe('манифест кэша — что в нём лежит рядом с ключом', () => {
  it('у записи сегмента есть `bundleHash`, `framemd5Sha256`, `frameCount` и `segmentId`', async () => {
    const made = project();
    const cold = await runBuild(made, { buildDir: path.join(made.root, 'cold') });

    const manifest = JSON.parse(
      readFileSync(cacheManifestPath(made.projectDir, { stage: 'segment', profileId: 'final' }), 'utf8'),
    ) as {
      stage: string;
      entries: {
        key: string;
        sha256: string;
        size: number;
        frameCount?: number;
        bundleHash?: string;
        framemd5Sha256?: string;
        segmentId?: string;
      }[];
    };
    expect(manifest.stage).toBe('segment');
    expect(manifest.entries).toHaveLength(3);
    for (const entry of manifest.entries) {
      expect(entry.bundleHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry.framemd5Sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry.frameCount).toBeGreaterThan(0);
      expect(entry.segmentId).toMatch(/^seg:/u);
    }
    // Значения адресуются ключом и лежат в двухуровневой раскладке CAS — файлов ровно три.
    const files = readdirSync(segmentNamespace(made), { recursive: true }) as string[];
    expect(files.filter((name) => String(name).endsWith(manifest.entries[0]?.key ?? ''))).toHaveLength(1);

    // Записи манифеста описывают ровно те сегменты, что легли в `BuildRecord`.
    expect([...manifest.entries.map((entry) => entry.segmentId)].sort()).toEqual(
      [...cold.record.segments.map((row) => row.segmentId)].sort(),
    );
  });
});
