// **AC4-b — КОНТЕКСТНАЯ НЕЗАВИСИМОСТЬ СЕГМЕНТА** (`F-01`; **D12**, Charter AC4 rev5,
// ADR-0007 §8). Здесь же впервые проверяется **ШОВ `concat -c copy`** на кадрах РЕНДЕРЕРА
// (долг SP-3 №5): до `M-04` шва не было ни у одного спайка, а `M-04` склеивал синтетические
// кадры `lavfi` 320×240, а не выход браузера.
//
// ═══ ЧТО ИМЕННО СРАВНИВАЕТСЯ, И ПОЧЕМУ НЕ «ПЕРЕСОБРАННАЯ ОБРЕЗКА» ═══
// ADR-0007 §8 говорит «один и тот же сегмент компилируется и рендерится в ДВУХ РАЗНЫХ
// ПРОЕКТАХ (`[S]` и `[S0,S,S2]`)». ИЗМЕРЕНО (`F-01`, тест ниже): IR сегмента в этих двух
// проектах совпадает ПОЛНОСТЬЮ — клипы, титры, ассеты, шрифты, seed'ы, — кроме ОДНОГО поля
// `segmentDurationInFrames` (48 кадров в составе против 38 в одиночку). Разница не дефект и
// не «недоделанная контекстная независимость»: хвостовой gap сцены ПРИНАДЛЕЖИТ сегменту
// (ADR-0003 T6 — δ дописывается в конец хвостового gap'а; разрез `CP-03` ставится в конце
// клипа `Silence`), а у последней сцены проекта следующей сцены нет и gap'а тоже. Требовать
// от такой обрезки побайтового равенства значило бы требовать, чтобы сегмент длиной 48 кадров
// был равен сегменту длиной 38.
//
// Поэтому сравнивается то, что задача назвала дословно: **ТОТ ЖЕ IR, поданный рендеру
// ОТДЕЛЬНО и В СОСТАВЕ**. Это и есть предмет D12: выход сегмента обязан быть функцией его IR,
// а не того, что рендерилось до и после него в том же процессе. Компиляторная половина
// («соседи не меняют содержимое сегмента») проверяется первым тестом файла, и она называет
// единственное поле, которое соседи менять ВПРАВЕ.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { canonicalJson } from '@vpe/core-model';
import { LocalStore, framemd5Of, readStoreLock } from '@vpe/media';
import { loadTemplateLibrary } from '@vpe/renderer-hyperframes';

import { AC4_PROFILE_ID, frameHashes } from '../src/ac4.js';
import { build, type BuildDeps } from '../src/build.js';
import type { BuildArgs } from '../src/argv.js';
import { readProject, readRenderProfile } from '../src/build-stages/inputs.js';
import { runPipeline } from '../src/build-stages/pipeline.js';
import type { BuildRecord } from '../src/build-stages/record.js';
import { compositionIdOf, renderSegments } from '../src/build-stages/render.js';

import { cleanupRoots, countingRandom, makeProject, type TestProject } from './build-fixture.js';

afterAll(cleanupRoots);

/**
 * Три сцены: `[S0, S, S2]`. Числа кадров ИЗМЕРЕНЫ (`F-01`) и записаны здесь, потому что от них
 * зависит сама постановка: средний сегмент обязан быть НЕ первым и НЕ последним — сегмент на
 * краю ролика не имеет соседа с одной стороны, и «контекст» у него половинный.
 */
const THREE_SCENES = `schema: source-dialect/1

# chapter: main

## scene: one

[img: ledger] The word is short. [beat: a] The page is black.

## scene: two

The cellar keeps a lathe.

## scene: three

The last one stands alone here.
`;

/** Одна запись режиссуры на бите первой сцены: соседи обязаны быть НЕПУСТЫМИ. */
const THREE_DIRECTION = `schema: direction/1

records:
  - recordId: "5d6e1130"
    at: { kind: anchor, anchor: "b:a" }
    track: visual
    z: 15
    template: "still@1"
    params:
      asset: "ledger"
      fit: cover
`;

/** Тот же текст сцены `two` — и больше ничего: проект `[S]`. */
const ONE_SCENE = `schema: source-dialect/1

# chapter: main

## scene: two

The cellar keeps a lathe.
`;

const NO_DIRECTION = `schema: direction/1

records: []
`;

/** Сегмент, вокруг которого стоит вопрос: средний. */
const SUBJECT = 'seg:two';

function write(project: TestProject, source: string, direction: string): TestProject {
  writeFileSync(path.join(project.projectDir, 'source/01-intro.md'), source, 'utf8');
  writeFileSync(path.join(project.projectDir, 'direction/01-intro.yaml'), direction, 'utf8');
  return project;
}

/** Стадии до рендера — то же тело, что зовёт `vpe build`, и ни строкой меньше. */
async function compile(project: TestProject, buildDir: string): Promise<Awaited<ReturnType<typeof runPipeline>>> {
  const read = readProject({
    projectDir: project.projectDir,
    buildDir,
    takesRoot: null,
    storeDir: project.storeDir,
  });
  return runPipeline({
    project: read,
    registry: loadTemplateLibrary().registry,
    lock: readStoreLock(path.join(read.layout.projectRoot, 'store.lock')),
    now: '2026-09-01T00:00:00.000Z',
    randomBytes: countingRandom(),
    allowTts: true,
    runtime: {},
    secrets: () => undefined,
  });
}

describe('**D12** — сегмент не зависит от соседей', () => {
  it('компиляция: IR сегмента в `[S0,S,S2]` и в `[S]` различается РОВНО длиной', async () => {
    const full = write(makeProject(), THREE_SCENES, THREE_DIRECTION);
    const alone = write(makeProject(), ONE_SCENE, NO_DIRECTION);

    const inContext = await compile(full, path.join(full.root, 'b-full'));
    const standalone = await compile(alone, path.join(alone.root, 'b-alone'));

    const a = inContext.ir.segments.find((segment) => segment.segmentId === SUBJECT);
    const b = standalone.ir.segments.find((segment) => segment.segmentId === SUBJECT);
    expect(a, 'сегмент `seg:two` не собрался в проекте из трёх сцен').toBeDefined();
    expect(b, 'сегмент `seg:two` не собрался в проекте из одной сцены').toBeDefined();
    // Сегмент СРЕДНИЙ: постановка ломается молча, если сегментация склеит сцены иначе.
    expect(inContext.ir.segments.map((segment) => segment.segmentId)).toEqual([
      'seg:one',
      SUBJECT,
      'seg:three',
    ]);

    // Всё, кроме длины, обязано совпасть ПОБАЙТОВО в канонической форме: титры, их токены,
    // клипы, ассеты, шрифты. Сравнение через `canonicalJson` — той же функцией, которой IR
    // кладётся на диск, а не своим обходом полей.
    const withoutDuration = (segment: NonNullable<typeof a>): string =>
      canonicalJson({ ...segment, segmentDurationInFrames: 0 });
    expect(
      withoutDuration(a as NonNullable<typeof a>),
      'соседи изменили СОДЕРЖИМОЕ сегмента, а не только его хвост: это нарушение **D12** — ' +
        'seed, титр или клип оказался функцией того, что стоит рядом',
    ).toBe(withoutDuration(b as NonNullable<typeof b>));

    // ЕДИНСТВЕННОЕ поле, которое соседи менять ВПРАВЕ, — и оно называется числами (`F-01`).
    expect(Number(a?.segmentDurationInFrames)).toBe(48);
    expect(Number(b?.segmentDurationInFrames)).toBe(38);
  }, 120_000);

  it(
    'рендер: тот же IR в составе и отдельно даёт ПОБАЙТОВО равный сегмент; шов не перекодирует',
    async () => {
      const project = write(makeProject(), THREE_SCENES, THREE_DIRECTION);

      // ── (1) сборка целиком: три сегмента подряд в ОДНОМ прогоне ──────────
      let out = '';
      const deps: BuildDeps = {
        now: () => '2026-09-01T00:00:00.000Z',
        clock: () => performance.now(),
        randomBytes: countingRandom(),
        out: (text) => (out += text),
        env: process.env,
      };
      const args: BuildArgs = {
        command: 'build',
        projectDir: project.projectDir,
        // Профиль AC4: гейта V13 на нём нет (решение владельца 12), поэтому тест не зависит
        // от записей гейта этой машины — предмет здесь другой.
        profileId: AC4_PROFILE_ID,
        profilePath: null,
        allowTts: true,
        now: '2026-09-01T00:00:00.000Z',
        buildDir: path.join(project.root, 'build-full'),
        writeRoot: null,
        storeDir: project.storeDir,
        gatesDir: null,
      };
      expect(await build(args, deps), out).toBe(0);

      const record = JSON.parse(
        readFileSync(path.join(project.root, 'build-full/reports/build-record.json'), 'utf8'),
      ) as BuildRecord;
      const index = record.segments.findIndex((segment) => segment.segmentId === SUBJECT);
      expect(index, 'средний сегмент пропал из сборки').toBe(1);

      // ── (2) ТОТ ЖЕ IR — рендер В ОДИНОЧКУ, в свой каталог ────────────────
      const read = readProject({
        projectDir: project.projectDir,
        buildDir: path.join(project.root, 'build-alone'),
        takesRoot: null,
        storeDir: project.storeDir,
      });
      const compiled = await compile(project, path.join(project.root, 'b-ir'));
      const ir = compiled.ir.segments[index];
      expect(ir?.segmentId).toBe(SUBJECT);

      const buildDir = path.join(project.root, 'build-alone');
      const layout = {
        buildDir,
        segmentsDir: path.join(buildDir, 'segments'),
        tmpDir: path.join(buildDir, 'tmp'),
      };
      mkdirSync(layout.segmentsDir, { recursive: true });
      const library = loadTemplateLibrary();
      const alone = await renderSegments({
        segments: [ir as NonNullable<typeof ir>],
        layout,
        compileProfile: {
          fps: read.compileProfile.fps,
          width: read.project.width,
          height: read.project.height,
        },
        renderProfile: readRenderProfile(read.layout.projectRoot, read.project, AC4_PROFILE_ID, []),
        store: new LocalStore(read.layout.storeDir),
        specs: library.registry,
        profileId: AC4_PROFILE_ID,
        deps,
        out: (text) => (out += text),
      });

      // ── (3) сравнение ────────────────────────────────────────────────────
      // `bundleHash` — вход рендера: разошёлся он, и сравнивать байты уже нечего, потому что
      // рендерились РАЗНЫЕ каталоги композиции. Проверяется ПЕРВЫМ по той же причине, по
      // которой это делает сам гейт (`gate.ts`).
      expect(alone[0]?.bundleHash, 'каталог композиции собрался другим').toBe(
        record.segments[index]?.bundleHash,
      );

      const inContextFile = path.join(
        project.root,
        'build-full/segments',
        `${String(index).padStart(4, '0')}-${compositionIdOf(SUBJECT)}.mts`,
      );
      const aloneFile = alone[0]?.artifact.path ?? '';
      expect(
        readFileSync(aloneFile).equals(readFileSync(inContextFile)),
        `сегмент \`${SUBJECT}\`, отрендеренный отдельно (${aloneFile}), не побайтово равен ` +
          `себе же в составе ролика (${inContextFile}). Это **D12**: выход сегмента обязан ` +
          'быть функцией его IR, а не того, что рендерилось рядом в том же процессе',
      ).toBe(true);
      // Та же величина, но названная тем именем, каким её знает `BuildRecord` и гейт.
      expect(alone[0]?.artifact.sha256).toBe(record.segments[index]?.sha256);
      expect(alone[0]?.artifact.framemd5Sha256).toBe(record.segments[index]?.framemd5Sha256);

      // ── (4) ШОВ `concat -c copy` на кадрах РЕНДЕРЕРА (долг SP-3 №5) ──────
      // Финал склеен из трёх сегментов демуксером без перекодирования — значит его кадры
      // обязаны декодироваться в те же хэши, что и кадры сегментов по отдельности
      // (ADR-0007 §8). Сравниваются ХЭШИ, а не строки `framemd5`: `pts`/`dts` у сегмента
      // свои, и это не расхождение картинки (см. `frameHashes`).
      const final = record.final;
      expect(final).not.toBeNull();
      const finalFrames = frameHashes(
        (await framemd5Of({ path: path.join(project.root, 'build-full', final?.file ?? '') })).lines,
      );
      const perSegment: string[] = [];
      for (const [i, segment] of record.segments.entries()) {
        const file = path.join(
          project.root,
          'build-full/segments',
          `${String(i).padStart(4, '0')}-${compositionIdOf(segment.segmentId)}.mts`,
        );
        perSegment.push(...frameHashes((await framemd5Of({ path: file })).lines));
      }
      expect(
        finalFrames,
        'кадры финала не равны склейке кадров сегментов: на шве `concat -c copy` произошёл ' +
          'ВТОРОЙ ЭНКОД (ADR-0007 §8, долг SP-3 №5)',
      ).toEqual(perSegment);
      expect(finalFrames.length).toBe(
        record.segments.reduce((sum, segment) => sum + segment.frameCount, 0),
      );
    },
    45 * 60 * 1000,
  );
});
