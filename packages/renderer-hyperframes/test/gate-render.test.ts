// ЖИВОЙ ГЕЙТ V13 НА НАСТОЯЩЕМ БРАУЗЕРЕ: `runGate(solid@1, draftHalf)`, N = 3.
//
// ═══ ЭТОТ ФАЙЛ ТРЕБУЕТ БРАУЗЕРА, ffmpeg И `unshare`/`ip`. SKIP'А ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у `render.test.ts` и `isolation-render.test.ts` (решение владельца
// `H-01`, §4 п. 2): тест либо зелёный, либо красный, но не «пропущен». Логика гейта проверена
// без браузера (`gate.test.ts`, `where.test.ts`) — здесь проверяется то, чего фейком проверить
// нельзя.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ — ровно три вещи:
//   1. гейт снимается ЭТИМ адаптером (`renderSegment`, изоляция `H-05`) и на этой машине даёт
//      класс с записью, а не «должен бы дать»;
//   2. **R12 ДЕЛОМ**: спек без записи ⇒ сборка сегмента НЕ СТАРТУЕТ; со свежей записью ⇒
//      стартует; тот же спек с чужим отпечатком ⇒ снова не стартует;
//   3. связка с долгом №164: композиция, бросившая исключение, даёт `error`, а НЕ PASS —
//      без охранника `PAGEERROR` тридцать чёрных кадров совпали бы во всех трёх прогонах и
//      гейт записал бы PASS про пустой сегмент. Это ложно-зелёный, который дороже красного.
//
// ЗДЕСЬ ЖЕ ЖИВЁТ ОБРАЗЕЦ СКЛЕЙКИ ПОРТА `GateMedia` с `@vpe/media` — то, что `E-00` обязана
// повторить у себя (в `src/` пакета этой склейки быть не может: стрелки
// `renderer-hyperframes → media` в карте ADR-0009 нет).

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSegmentArtifact, framemd5Of } from '@vpe/media';
import { assertBuildMayStart, createRegistry, still1, type AnyTemplateSpec } from '@vpe/templates-spec';

import type { SegmentRenderRequest } from '../src/contract.js';
import { formatGateOutcome, runGate, type GateMedia } from '../src/gate.js';
import { renderSegment } from '../src/run.js';
import { validateRequest } from '../src/validate.js';
import { makeFixture, withPatch } from './fixture.js';
import { SOLID_TEMPLATE, TEST_REGISTRY } from './solid.js';
import type { RendererTemplate, RendererTemplateRegistry } from '../src/templates/index.js';

const FRAMES = 6;
const TIMEOUT = 900_000;

const GATE_SKIP = {
  mode: 'skip',
  why: 'подготовка запроса к гейту: считается `bundle.hash`, рендера ещё не было',
} as const;

/**
 * Часы ЖИВОГО прогона — настоящие: в таблице гейта стоит `wallMs`, и синтетический счётчик
 * напечатал бы там выдумку. `performance.now` законен в тестах (у них своя зона в
 * `eslint.config.js`, охранник `d4-clock-boundary` смотрит на `src/**` и `bin/**`).
 */
const realClock = (): (() => number) => () => performance.now();

/** Счётчик — только там, где время не измеряется (подготовка `bundle.hash`). */
const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/**
 * Пиксельный профиль энкодера — те же числа, что у `H-01` (270×480, `bitexact`).
 *
 * ИЗМЕРЕНО (`H-04`): `encoder.bitexact: true` стоит во ВСЕХ трёх профилях фикстуры, то есть
 * FLAKY-по-контейнеру здесь не норма, а находка. Числа СИНТЕТИЧЕСКИЕ и дешёвые: настоящая пара
 * (профиль × шаблон) появляется у настоящих шаблонов (`H-06`); `profileId` гейта здесь
 * определяет N (= 3), а не геометрию.
 */
const PIXEL_PROFILE = {
  browserGpu: false,
  imageFormat: 'png',
  scale: 0.25,
  colorSpace: 'bt709',
  pixelFormat: 'yuv420p',
  codec: 'h264',
  crf: 18,
  gopSize: 30,
  encoder: { threads: 1, preset: 'medium', tune: 'none', rcLookahead: 40, aqMode: 1, psy: 1, bitexact: true },
} as unknown as Parameters<typeof buildSegmentArtifact>[0]['pixelProfile'];

/**
 * **ОБРАЗЕЦ СКЛЕЙКИ ПОРТА** (обязанность вызывающего — `E-00`).
 *
 * `buildSegmentArtifact` даёт обе величины ADR-0008 (`sha256` файла и свёрнутый `framemd5`),
 * `framemd5Of` — ПОКАДРОВЫЕ строки, без которых `where` не назвал бы ни одного кадра.
 */
function gateMedia(fps: SegmentRenderRequest['compileProfile']['fps']): GateMedia {
  return {
    measure: async ({ frames, outputPath, stats }) => {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      const artifact = await buildSegmentArtifact({
        frames,
        pixelProfile: PIXEL_PROFILE,
        fps: fps as unknown as Parameters<typeof buildSegmentArtifact>[0]['fps'],
        outputPath,
        stats,
      });
      const md5 = await framemd5Of({ path: artifact.path });
      return {
        path: artifact.path,
        sha256: artifact.sha256,
        framemd5Sha256: artifact.framemd5Sha256,
        framemd5Lines: md5.lines,
        frameCount: artifact.frameCount,
      };
    },
  };
}

/** Запрос с ВЕРНЫМ `bundle.hash` — тот же приём, что в `render.test.ts`. */
async function ready(template = 'solid@1', registry: RendererTemplateRegistry = TEST_REGISTRY): Promise<SegmentRenderRequest> {
  const fixture = makeFixture({ frames: FRAMES, template });
  const probe = await renderSegment(fixture.request, {
    clock: fakeClock(),
    gate: GATE_SKIP,
    registry,
    spawnRenderer: () => Promise.resolve(0),
  });
  if (probe.ok) throw new Error('ожидался отказ по `bundle.hash`');
  const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
  if (hash === undefined) throw new Error(probe.error.message);
  return validateRequest(withPatch(fixture.request, { bundle: { ...fixture.request.bundle, hash } }));
}

const runRoot = (): string => mkdtempSync(path.join(tmpdir(), 'vpe-gate-'));

describe('гейт V13 живьём: `solid@1`, профиль `draftHalf`, N = 3', () => {
  it(
    'три прогона одной конфигурации — класс назван, обе величины измерены, запись создана при PASS',
    async () => {
      const request = await ready();
      const outcome = await runGate({
        request,
        runRoot: runRoot(),
        profileId: 'draftHalf',
        media: gateMedia(request.compileProfile.fps),
        now: () => '2026-08-28T00:00:00Z',
        options: { clock: realClock(), registry: TEST_REGISTRY, parentEnv: process.env },
      });

      // Печать — то, что увидит автор шаблона; она же уезжает в отчёт `H-04`.
      console.log(formatGateOutcome(outcome));

      expect(outcome.class, formatGateOutcome(outcome)).toBe('PASS');
      if (outcome.class !== 'PASS') return;

      expect(outcome.runs).toHaveLength(3);
      expect(outcome.record.N).toBe(3);
      expect(outcome.record.profileId).toBe('draftHalf');
      // Отпечаток — НАСТОЯЩИЙ, этой машины: 64 hex `blake3` (`H-03`), а не выдумка.
      expect(outcome.record.engineFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      expect(outcome.record.sha256).toBe(outcome.runs[0]?.sha256);
      expect(outcome.record.framemd5).toBe(outcome.runs[0]?.framemd5Sha256);
      // Все три прогона мерили ОДНО окружение — иначе это не гейт пары.
      expect(new Set(outcome.runs.map((r) => r.engineFingerprint)).size).toBe(1);
      // Кадры на диске держатся только у опорного прогона (потолок 2×, а не N×).
      expect(outcome.runs.filter((r) => r.framesDir !== null)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    '**R12 делом**: без записи сборка не стартует, с записью — стартует, с чужим отпечатком — снова нет',
    async () => {
      const request = await ready();
      const outcome = await runGate({
        request,
        runRoot: runRoot(),
        profileId: 'draftHalf',
        media: gateMedia(request.compileProfile.fps),
        now: () => '2026-08-28T00:00:00Z',
        options: { clock: realClock(), registry: TEST_REGISTRY, parentEnv: process.env },
      });
      expect(outcome.class, formatGateOutcome(outcome)).toBe('PASS');
      if (outcome.class !== 'PASS') return;

      // Спек синтетического шаблона: манифест `still1` с подставленным ИМЕНЕМ и записью —
      // настоящих спеков `solid@1` нет и не будет (он живёт только в тестах).
      const specWith = (gates: AnyTemplateSpec['manifest']['gates']): AnyTemplateSpec => ({
        ...still1,
        templateId: 'solid',
        manifest: { ...still1.manifest, templateId: 'solid', templateVersion: 1, gates },
      });
      const pair = { profileId: 'draftHalf', engineFingerprint: outcome.record.engineFingerprint } as const;

      // (а) записи нет — сборка сегмента НЕ СТАРТУЕТ (критерий готовности `H-04`).
      const withoutRecord = await renderSegment(request, {
        clock: fakeClock(),
        registry: TEST_REGISTRY,
        parentEnv: process.env,
        gate: { mode: 'require', specs: createRegistry([specWith([])]), profileId: 'draftHalf' },
      });
      expect(withoutRecord.ok).toBe(false);
      if (!withoutRecord.ok) {
        expect(withoutRecord.error.rule).toBe('R12');
        expect(withoutRecord.error.message).toContain('solid@1');
      }

      // (б) запись гейта, только что снятая ЭТИМ гейтом, — сборка стартует и доходит до кадров.
      const withRecord = await renderSegment(request, {
        clock: fakeClock(),
        registry: TEST_REGISTRY,
        parentEnv: process.env,
        gate: {
          mode: 'require',
          specs: createRegistry([specWith([outcome.record])]),
          profileId: 'draftHalf',
        },
      });
      expect(withRecord.ok, JSON.stringify(withRecord)).toBe(true);
      if (withRecord.ok) expect(withRecord.frames.frameCount).toBe(FRAMES);

      // (в) тот же спек, ЧУЖОЙ отпечаток — снова не стартует. Проверяется ПАРА, а не профиль.
      expect(() =>
        assertBuildMayStart(createRegistry([specWith([outcome.record])]), ['solid@1'], {
          ...pair,
          engineFingerprint: 'f'.repeat(64),
        }),
      ).toThrow(/другом окружении/u);
    },
    TIMEOUT,
  );

  it(
    'композиция, бросившая исключение, даёт `error`, а НЕ PASS на чёрных кадрах (долг №164)',
    async () => {
      const THROWER: RendererTemplate = Object.freeze({
        templateId: 'thrower',
        templateVersion: 1,
        mountSource: `function (host, ctx) {
          throw new Error('шаблон бросил на монтировании');
        }`,
      });
      const registry: RendererTemplateRegistry = Object.freeze({
        version: '1',
        templates: Object.freeze([SOLID_TEMPLATE, THROWER]) as readonly RendererTemplate[],
      });
      const request = await ready('thrower@1', registry);

      const outcome = await runGate({
        request,
        runRoot: runRoot(),
        profileId: 'draftHalf',
        media: gateMedia(request.compileProfile.fps),
        now: () => '2026-08-28T00:00:00Z',
        options: { clock: realClock(), registry, parentEnv: process.env },
      });

      expect(outcome.class, formatGateOutcome(outcome)).toBe('error');
      if (outcome.class !== 'error') return;
      // Без охранника `PAGEERROR` (`H-05`) здесь были бы три одинаковых набора ЧЁРНЫХ кадров,
      // то есть PASS про пустой сегмент.
      expect(outcome.why).toContain('ADR-0008 композиция');
      expect(outcome.runs).toHaveLength(0);
    },
    TIMEOUT,
  );
});
