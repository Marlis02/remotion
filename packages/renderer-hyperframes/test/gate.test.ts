// ГЕЙТ V13 БЕЗ БРАУЗЕРА: классы результата, N из схемы, запись и то, что она открывает сборку.
//
// ═══ ЭТОТ ФАЙЛ БРАУЗЕРА НЕ ТРЕБУЕТ ═══ Живой гейт — `gate-render.test.ts` (машина владельца).
// Здесь подменены ДВА входа, и оба подменяются значением, а не «если не нашлось»:
//   • `render` — функция, возвращающая заранее заданный ответ (образец `spawnRenderer`);
//   • `media` — порт кодирования: фейк отдаёт заданные `sha256`/`framemd5` (образец `pcmSource`
//     из `CP-05`).
// Настоящей склейкой порта с `buildSegmentArtifact` занят браузерный тест — здесь проверяется
// ЛОГИКА гейта: то, что нельзя проверить прогоном, потому что расхождение по требованию не
// воспроизводится.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GATE_RUNS,
  GateRecordSchema,
  assertBuildMayStart,
  createRegistry,
  still1,
  type AnyTemplateSpec,
  type GateRecord,
} from '@vpe/templates-spec';

import type { RenderResponse, SegmentRenderRequest } from '../src/contract.js';
import { runGate, formatGateOutcome, type GateInput, type GateMedia, type GateOutcome } from '../src/gate.js';
import { FRAME_PATTERN, FRAME_START_NUMBER } from '../src/run.js';
import { makeFixture } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';

const FRAMES = 12;
/** Отпечаток этой «машины» в тестах — форма настоящая (64 hex), значение синтетическое. */
const FP = 'a'.repeat(64);
const FP_OTHER = 'b'.repeat(64);
const NOW = '2026-08-28T12:00:00Z';

const hex = (seed: string): string => seed.repeat(64).slice(0, 64);

/** Покадровые строки `framemd5`: одна на кадр, форма — как у ffmpeg. */
function framemd5Lines(perFrame: readonly string[]): string[] {
  return perFrame.map((md5, i) => `0,${String(i).padStart(11, ' ')}, ${String(i)}, 1, 388800, ${md5}`);
}

/** Кадры прогона: все одинаковые, кроме перечисленных — там свой хэш. */
function frames(run: number, differing: readonly number[] = []): string[] {
  return Array.from({ length: FRAMES }, (_, i) =>
    differing.includes(i) ? hex(`d${String(run)}${String(i)}`).slice(0, 32) : hex(`c${String(i)}`).slice(0, 32),
  );
}

interface FakeRun {
  readonly sha256: string;
  /** Покадровые хэши; из них считается и свёрнутый `framemd5`. */
  readonly perFrame: readonly string[];
  readonly browserLaunchLine?: string | null;
  readonly frameCount?: number;
  readonly engineFingerprint?: string | null;
  readonly engineCompositionHash?: string | null;
  /** Отказ рендера вместо ответа. */
  readonly failure?: RenderResponse & { ok: false };
}

/**
 * Свёртка покадровых хэшей в один дайджест — роль `SegmentArtifact.framemd5Sha256`.
 *
 * Считается ТОЙ ЖЕ функцией, что в `media` (`sha256` строк кадров), а не «первыми символами»:
 * фейк, теряющий различие кадров, сделал бы тест FAIL ложно-зелёным.
 */
const rollUp = (perFrame: readonly string[]): string =>
  createHash('sha256').update(perFrame.join('\n')).digest('hex');

interface Harness {
  readonly input: GateInput;
  readonly calls: { count: number };
}

function harness(
  runs: readonly FakeRun[],
  overrides: Partial<GateInput> = {},
  probes: readonly string[] = [FP, FP],
): Harness {
  const fixture = makeFixture({ frames: FRAMES });
  const runRoot = mkdtempSync(path.join(tmpdir(), 'vpe-h04-'));
  const calls = { count: 0 };
  let probeIndex = 0;

  const render = (request: SegmentRenderRequest): Promise<RenderResponse> => {
    const spec = runs[calls.count] as FakeRun;
    calls.count++;
    if (spec.failure !== undefined) return Promise.resolve(spec.failure);
    const dir = path.join(request.tmpDir, 'frames');
    mkdirSync(dir, { recursive: true });
    return Promise.resolve({
      ok: true,
      frames: {
        dir,
        pattern: FRAME_PATTERN,
        startNumber: FRAME_START_NUMBER,
        frameCount: spec.frameCount ?? FRAMES,
      },
      engineCompositionHash: spec.engineCompositionHash ?? '5c05d8c4637e8a1c',
      engineFingerprint: spec.engineFingerprint === undefined ? FP : spec.engineFingerprint,
      engineProbe: null,
      browserLaunchLine:
        spec.browserLaunchLine === undefined ? 'HeadlessChrome/152.0.7928.2, gl=swiftshader' : spec.browserLaunchLine,
      stats: { wallMs: 100 + calls.count, retries: 0, peakRssBytes: 1024 },
    });
  };

  const media: GateMedia = {
    measure: (m) => {
      const spec = runs[m.run - 1] as FakeRun;
      return Promise.resolve({
        path: m.outputPath,
        sha256: spec.sha256,
        framemd5Sha256: rollUp(spec.perFrame),
        framemd5Lines: framemd5Lines(spec.perFrame),
        frameCount: spec.frameCount ?? FRAMES,
      });
    },
  };

  return {
    calls,
    input: {
      request: fixture.request,
      runRoot,
      profileId: 'draftHalf',
      media,
      now: () => NOW,
      probeFingerprint: () => probes[Math.min(probeIndex++, probes.length - 1)] as string,
      options: { clock: () => 0, registry: TEST_REGISTRY },
      render,
      ...overrides,
    },
  };
}

/** Три одинаковых прогона — то, что обязано дать PASS. */
const identical = (n: number): FakeRun[] =>
  Array.from({ length: n }, () => ({ sha256: hex('1'), perFrame: frames(1) }));

describe('классы результата — ровно таблица ADR-0008, порядок величин framemd5 → sha256', () => {
  it('PASS: один sha256 И один framemd5 на все N — запись создана и проходит схему `TS-01`', async () => {
    const h = harness(identical(3));
    const outcome = await runGate(h.input);

    expect(outcome.class).toBe('PASS');
    if (outcome.class !== 'PASS') return;
    expect(h.calls.count).toBe(3);
    expect(outcome.record).toEqual({
      profileId: 'draftHalf',
      N: 3,
      sha256: hex('1'),
      framemd5: rollUp(frames(1)),
      date: NOW,
      engineFingerprint: FP,
      class: 'PASS',
    });
    // Запись обязана быть валидной ПО СХЕМЕ МАНИФЕСТА, а не по нашим ожиданиям: манифест —
    // единственное место, где она будет жить (**R12**).
    expect(GateRecordSchema.safeParse(outcome.record).success).toBe(true);
  });

  it('FAIL: разошёлся framemd5 (кадры 7–9 третьего прогона) — `where` позван, записи НЕТ', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      { sha256: hex('1'), perFrame: frames(1) },
      // Файл ТОТ ЖЕ sha256 — и это важно: класс определяется картинкой, а не файлом.
      { sha256: hex('1'), perFrame: frames(3, [7, 8, 9]) },
    ]);
    const outcome = await runGate(h.input);

    expect(outcome.class).toBe('FAIL');
    if (outcome.class !== 'FAIL') return;
    expect(outcome).not.toHaveProperty('record');
    expect(outcome.where).not.toBeNull();
    expect(outcome.where?.differingFrames).toEqual([7, 8, 9]);
    // «Какой слой»: клип фикстуры `r:aaaa0002` идёт с середины сегмента и накрывает 7–9.
    const worst = outcome.where?.byClip[0];
    expect(worst?.clipId).toBe('r:aaaa0002');
    expect(worst?.differing).toBe(3);
    expect(outcome.why).toContain('не версионируется');
  });

  it('FLAKY-по-контейнеру: sha256 разные, framemd5 один — класс, диагноз про контейнер, записи НЕТ', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      { sha256: hex('2'), perFrame: frames(1) },
      { sha256: hex('1'), perFrame: frames(1) },
    ]);
    const outcome = await runGate(h.input);

    expect(outcome.class).toBe('FLAKY-по-контейнеру');
    if (outcome.class !== 'FLAKY-по-контейнеру') return;
    expect(outcome).not.toHaveProperty('record');
    expect(outcome.diagnosis).toContain('КОНТЕЙНЕР');
    expect(outcome.diagnosis).toContain('bitexact');
  });

  it('ПОРЯДОК ВЕЛИЧИН: расхождение и картинки, и файла — это FAIL, а не FLAKY', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      { sha256: hex('2'), perFrame: frames(2, [4]) },
      { sha256: hex('3'), perFrame: frames(1) },
    ]);
    const outcome = await runGate(h.input);
    // Перевёрнутый порядок («сначала sha256») дал бы здесь FLAKY на разъехавшейся картинке.
    expect(outcome.class).toBe('FAIL');
  });
});

describe('N — из схемы манифеста, а не литералом гейта', () => {
  it('`final` — 10 прогонов, `draftHalf` — 3, и обе величины взяты из `GATE_RUNS`', async () => {
    const finalRun = harness(identical(10), { profileId: 'final' });
    const outcome = await runGate(finalRun.input);
    expect(finalRun.calls.count).toBe(GATE_RUNS.final);
    expect(outcome.class === 'PASS' && outcome.record.N).toBe(10);

    const draft = harness(identical(3));
    await runGate(draft.input);
    expect(draft.calls.count).toBe(GATE_RUNS.draftHalf);
  });

  it('`ac4` парой гейта не является — отказ ДО прогонов', async () => {
    const h = harness(identical(3), { profileId: 'ac4' });
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('error');
    expect(h.calls.count).toBe(0);
    if (outcome.class !== 'error') return;
    expect(outcome.why).toContain('ПОЛНЫМ ПРОГОНОМ ФИКСТУРНОГО ПРОЕКТА');
  });
});

describe('`error` — «гейта не было»: это не класс результата и не FAIL', () => {
  it('`bundle.hash` разошёлся с каталогом композиции — ошибка материализации, не FLAKY', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      {
        sha256: hex('1'),
        perFrame: frames(1),
        failure: {
          ok: false,
          error: {
            rule: 'R2',
            message: '`bundle.hash` запроса — `aaa`, а каталог композиции имеет `bbb`',
            details: [{ rule: 'R2', at: 'bundle.hash', message: 'вход рендера не определяется запросом' }],
          },
        },
      },
      { sha256: hex('1'), perFrame: frames(1) },
    ]);
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('error');
    if (outcome.class !== 'error') return;
    expect(outcome.why).toContain('ошибка материализации');
    expect(outcome.why).not.toContain('FLAKY-по-контейнеру');
  });

  it('проба ПОСЛЕ не совпала с пробой ДО — «окружение уехало во время гейта»', async () => {
    const h = harness(identical(3), {}, [FP, FP_OTHER]);
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('error');
    if (outcome.class !== 'error') return;
    expect(outcome.why).toContain('окружение уехало');
    // Прогоны ВСЕ состоялись — и всё равно это не результат: пара не была постоянной.
    expect(h.calls.count).toBe(3);
  });

  it('число кадров разошлось между прогонами — `error`, а не расхождение картинки', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      { sha256: hex('1'), perFrame: frames(1), frameCount: FRAMES - 1 },
      { sha256: hex('1'), perFrame: frames(1) },
    ]);
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('error');
    if (outcome.class !== 'error') return;
    expect(outcome.why).toContain('число кадров разошлось');
  });

  it('отпечаток прогонов не совпал с пробой гейта — запись цитировала бы чужое окружение', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1), engineFingerprint: FP_OTHER },
      { sha256: hex('1'), perFrame: frames(1), engineFingerprint: FP_OTHER },
      { sha256: hex('1'), perFrame: frames(1), engineFingerprint: FP_OTHER },
    ]);
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('error');
  });
});

describe('строка запуска браузера между прогонами (долг №161)', () => {
  it('две разных строки `Browser launched` при одной картинке — FLAKY с причиной, не PASS', async () => {
    const h = harness([
      { sha256: hex('1'), perFrame: frames(1) },
      { sha256: hex('1'), perFrame: frames(1), browserLaunchLine: 'HeadlessChrome/152.0.9999.9, gl=angle' },
      { sha256: hex('1'), perFrame: frames(1) },
    ]);
    const outcome = await runGate(h.input);
    expect(outcome.class).toBe('FLAKY-по-контейнеру');
    if (outcome.class !== 'FLAKY-по-контейнеру') return;
    expect(outcome.diagnosis).toContain('№161');
    expect(outcome.diagnosis).toContain('gl=angle');
  });
});

describe('запись гейта открывает сборку — и только своей паре (**R12**)', () => {
  /** Спек фикстуры с подставленной записью: манифест — данные, и запись живёт в них. */
  const specWith = (gates: readonly GateRecord[]): AnyTemplateSpec => ({
    ...still1,
    // `[...gates]` — копия, а не каст: `TemplateManifest.gates` объявлен изменяемым массивом
    // (так его вывела zod-схема), и снимать `readonly` утверждением типа здесь значило бы
    // прятать за кастом различие, которое тест обязан соблюдать.
    manifest: { ...still1.manifest, gates: [...gates] },
  });

  it('PASS → `assertBuildMayStart` пускает; чужой отпечаток — не пускает', async () => {
    const outcome = await runGate(harness(identical(3)).input);
    expect(outcome.class).toBe('PASS');
    if (outcome.class !== 'PASS') return;

    const registry = createRegistry([specWith([outcome.record])]);
    const name = `${still1.templateId}@${String(still1.templateVersion)}`;

    expect(() =>
      assertBuildMayStart(registry, [name], { profileId: 'draftHalf', engineFingerprint: FP }),
    ).not.toThrow();

    // Тот же профиль, другая машина — сборка не стартует: запись описывает ПАРУ.
    expect(() =>
      assertBuildMayStart(registry, [name], { profileId: 'draftHalf', engineFingerprint: FP_OTHER }),
    ).toThrow(/другом окружении/u);

    // Та же машина, другой профиль — тоже не стартует.
    expect(() =>
      assertBuildMayStart(registry, [name], { profileId: 'final', engineFingerprint: FP }),
    ).toThrow(/записи гейта для профиля/u);

    // Без записи вовсе — не стартует (это и есть критерий готовности `H-04`).
    expect(() =>
      assertBuildMayStart(createRegistry([specWith([])]), [name], {
        profileId: 'draftHalf',
        engineFingerprint: FP,
      }),
    ).toThrow(/записей нет ни одной/u);
  });
});

describe('печать исхода — то, что `E-00` покажет автору', () => {
  it('PASS печатает таблицу прогонов, обе величины и запись целиком', async () => {
    const outcome: GateOutcome = await runGate(harness(identical(3)).input);
    const text = formatGateOutcome(outcome);
    expect(text).toContain('ГЕЙТ: PASS');
    expect(text).toContain('порядок проверки: framemd5 → sha256');
    expect(text).toContain('engineFingerprint: ' + FP);
    expect(text).toContain('НЕ означает «рендерер детерминирован»');
    expect(text.split('\n').filter((l) => /^\s+\d+ \|/u.test(l))).toHaveLength(3);
  });

  it('FAIL печатает `where` человекочитаемо — с клипом, а не с процентами', async () => {
    const outcome = await runGate(
      harness([
        { sha256: hex('1'), perFrame: frames(1) },
        { sha256: hex('1'), perFrame: frames(2, [7, 8, 9]) },
        { sha256: hex('1'), perFrame: frames(1) },
      ]).input,
    );
    const text = formatGateOutcome(outcome);
    expect(text).toContain('ГЕЙТ: FAIL');
    expect(text).toContain('r:aaaa0002');
    expect(text).toContain('отрезки: 7–9');
  });
});
