// **КАДРЫ СЕГМЕНТОВ УДАЛЯЮТСЯ ПОСЛЕ ЭНКОДА (долг №288), А `--keep-frames` ИХ ОСТАВЛЯЕТ.**
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Предмет здесь — не картинка и не байты, а ДИСК: измерено
// (`SP-VID-DUR`, 2026-09-12) — десятиминутный ролик на `draftHalf` оставлял в
// `build/tmp/segments/*/frames` **12 ГБ**, двадцатиминутный `final` оставил бы около 96 ГБ.
// Утверждение «после сборки кадров нет» не принадлежит ни одному из существующих файлов:
// `build.test.ts` про раскладку и байты, `cache-segment.test.ts` про ключ.
//
// **АС4 ПРОВЕРЯЕТСЯ ЗДЕСЬ ЖЕ, И ЭТО ГЛАВНОЕ УТВЕРЖДЕНИЕ ФАЙЛА.** Уборка обязана быть слепа к
// содержимому: `sha256` каждого сегмента в прогоне С флагом и БЕЗ него — один и тот же.
// Иначе «мы сэкономили диск» означало бы «мы поменяли ролик».
//
// Браузера здесь нет: рендерер подменён и кладёт настоящие PNG, как в `build.test.ts`. Ниже
// по течению всё живое — `encodeSegment`, `ffprobe`, `framemd5`, конкат и мукс.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FRAME_PATTERN, FRAME_START_NUMBER, type RenderResponse } from '@vpe/renderer-hyperframes';

import { build, type BuildDeps } from '../src/build.js';
import type { BuildArgs } from '../src/argv.js';

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

/** Шаблоны короткой прозы фикстуры — те же, что у `build.test.ts`. */
const USED = ['still@1'];

/** Подменённый рендерер: настоящие PNG в каталог кадров запроса. */
function frameRenderer(): NonNullable<BuildDeps['render']> {
  const png = makePng();
  return (request) => {
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

interface Ran {
  readonly code: number;
  readonly out: string;
  readonly buildDir: string;
}

async function runBuild(project: TestProject, keepFrames: boolean, buildDir: string): Promise<Ran> {
  let out = '';
  const args: BuildArgs = {
    command: 'build',
    projectDir: project.projectDir,
    profileId: 'final',
    profilePath: null,
    allowTts: true,
    now: '2026-09-12T00:00:00.000Z',
    buildDir,
    writeRoot: null,
    storeDir: project.storeDir,
    gatesDir: project.gatesDir,
    // Кэш ВЫКЛЮЧЕН обоим прогонам: второй иначе взял бы байты первого, и равенство `sha256`
    // стало бы тавтологией — сравнивались бы не два рендера, а один файл с собой.
    noCache: true,
    keepFrames,
  };
  const deps: BuildDeps = {
    now: () => '2026-09-12T00:00:00.000Z',
    clock: () => 0,
    randomBytes: countingRandom(),
    out: (text) => (out += text),
    env: {},
    render: frameRenderer(),
    fingerprint: () => TEST_FINGERPRINT,
  };
  const code = await build(args, deps);
  return { code, out, buildDir };
}

/**
 * Сколько PNG лежит под `build/tmp` — РЕКУРСИВНО, а не по известным именам каталогов.
 *
 * ПОЧЕМУ ОБХОДОМ. Уборка сносит ВЕСЬ `tmpDir` сегмента, поэтому каталогов, по которым можно
 * было бы «посмотреть, сколько кадров осталось», после неё нет вовсе — и перечисление
 * `tmp/segments/*` дало бы пустой список, то есть ЗЕЛЁНЫЙ ответ и при уборке, и при сборке,
 * которая кадров не клала совсем. Обход же отвечает на настоящий вопрос: «есть ли под `tmp`
 * хоть один кадр». Он же ловит `frames-video` (вторую копию кадров, `VID-02a`), которую
 * перечисление по имени `frames` пропустило бы.
 */
function pngsUnderTmp(buildDir: string): readonly string[] {
  const root = path.join(buildDir, 'tmp');
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, name.name);
      if (name.isDirectory()) walk(abs);
      else if (name.name.endsWith('.png')) out.push(path.relative(root, abs));
    }
  };
  walk(root);
  return out.sort();
}

/** `sha256` сегментов из отчёта сборки — то, что уборка не имеет права сдвинуть. */
function segmentShas(buildDir: string): readonly string[] {
  const record = JSON.parse(
    readFileSync(path.join(buildDir, 'reports/build-record.json'), 'utf8'),
  ) as { segments: readonly { sha256: string }[] };
  return record.segments.map((s) => s.sha256);
}

describe('№288: кадры сегментов после энкода', () => {
  it('умолчание — кадров в `build/tmp` НЕТ, а `--keep-frames` их оставляет; `sha256` тот же', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);

    // ── (1) ПРОГОН С ФЛАГОМ — ПЕРВЫМ, и это не порядок ради порядка ────────
    // Он даёт ЭТАЛОН: сколько кадров сборка вообще кладёт под `tmp`. Без него утверждение
    // «после уборки кадров нет» было бы зелёным и у сборки, которая их не клала ни одного.
    const kept = await runBuild(project, true, path.join(project.root, 'build-kept'));
    expect(kept.code, kept.out).toBe(0);
    const keptPngs = pngsUnderTmp(kept.buildDir);
    expect(
      keptPngs.length,
      '`--keep-frames` не оставил под `tmp` ни одного кадра — мерить уборку нечем',
    ).toBeGreaterThan(0);
    expect(segmentShas(kept.buildDir).length, 'сегментов в сборке ноль').toBeGreaterThan(0);

    // ── (2) обычная сборка того же проекта: кадров быть не должно НИ ОДНОГО ─
    const clean = await runBuild(project, false, path.join(project.root, 'build-clean'));
    expect(clean.code, clean.out).toBe(0);
    expect(
      pngsUnderTmp(clean.buildDir),
      `кадры остались под \`tmp\` после энкода: их там ${String(keptPngs.length)} с флагом, ` +
        'и столько же без него — уборка не сработала',
    ).toEqual([]);

    // ── (3) АС4 не задет: удаление производного не трогает произведение ─────
    expect(segmentShas(kept.buildDir), 'уборка кадров сдвинула байты сегмента').toEqual(
      segmentShas(clean.buildDir),
    );
  }, 180_000);
});
