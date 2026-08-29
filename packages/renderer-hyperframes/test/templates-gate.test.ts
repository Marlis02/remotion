// **ЖИВОЙ ГЕЙТ V13 НА ЧЕТЫРЁХ ВИЗУАЛЬНЫХ ШАБЛОНАХ `H-06`: `draftHalf`, N = 3.**
//
// ═══ ТРЕБУЕТ БРАУЗЕРА, ffmpeg И СИСТЕМНОГО ШРИФТА. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у `render.test.ts`, `isolation-render.test.ts` и `gate-render.test.ts`
// (решение владельца `H-01`, §4 п. 2): тест либо зелёный, либо красный, но не «пропущен».
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ И ЧЕГО ЗДЕСЬ НЕТ. Доказывается, что каждая реализация РИСУЕТ и что
// три прогона дают один файл на этой машине. Записи гейта в репозиторий эта сессия НЕ КЛАДЁТ:
// их ставит владелец командой `vpe template gate` (решение владельца 5, RM1), а `runRoot`
// здесь — свежий `mkdtemp`, то есть всё, что гейт произвёл, остаётся во временном каталоге.
//
// `bed@1` ЗДЕСЬ НЕТ, И ЭТО РЕЗУЛЬТАТ, А НЕ ПРОПУСК. Он аудио-домена: в `RenderIR.clips` не
// попадает по построению, а его реализация — ОТКАЗ (решение владельца, развилка «б», вариант
// б3). Гейт на нём даёт `error`, и это проверено отдельным тестом ниже: «гейта не было» —
// честный исход, а PASS на чёрных кадрах был бы ложно-зелёным (долг №164).
//
// **`kenburns@1` СНИМАЕТСЯ НА СМЕШАННОМ ЗАПРОСЕ** — `still@1` под ним (поправка владельца П2).
// Основание: шаблон объявляет `declareAssets` пустым и двигает слой НИЖЕ себя (решение
// владельца `TS-01`, вопрос 5). Запрос из одних `kenburns@1` не имеет под собой слоя, и гейт
// на нём измерял бы пустое движение; вырожденность проверена отдельным тестом — она обязана
// давать `error`. Охранник команды `E-00` («каждый клип запроса зовёт названный шаблон») такой
// смешанный запрос сегодня не пропустит — долг заведён с адресом `E-00`, решение о смягчении
// владелец принимает при `E-00fix`, ДО своих ручных гейтов.
//
// ТАЙМАУТ ВЗЯТ ПО ИЗМЕРЕНИЮ, А НЕ С ПОТОЛКА: `gate-render.test.ts` на этой машине даёт
// `runGate(N=3, 6 кадров, 270×480)` за 5.6 с. Здесь кадров вдвое больше и слои тяжелее,
// поэтому 300 000 мс — запас ×50 к измеренному, а не догадка.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSegmentArtifact, framemd5Of } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import type { SegmentRenderRequest } from '../src/contract.js';
import { createGateMedia } from '../src/gate-media.js';
import { formatGateOutcome, runGate, type GateMedia } from '../src/gate.js';
import { rendererTemplates } from '../src/templates/index.js';
import { FIXTURE_PARAMS, makeTemplateFixture, readyRequest } from './fixture.js';

/** Кадров в сегменте. Двенадцать — 0.4 с при 30 fps: движение видно, прогон дёшев. */
const FRAMES = 12;
const TIMEOUT = 300_000;

/** Часы ЖИВОГО прогона — настоящие: в таблице гейта стоит `wallMs`. */
const realClock = (): (() => number) => () => performance.now();

/**
 * Профиль энкодера — полный (`codec`, `crf`, `gopSize`, `encoder.*`), потому что `sha256`
 * записи описывает ЗАКОДИРОВАННЫЙ файл. Числа — `render.draft.yaml` фикстуры, кроме
 * `imageFormat`: там он `jpeg`, а рендерер его не выражает (№154 на профиле `draft`; долг
 * заведён с адресом `L-01`). Здесь `png`, как и в профиле гейта `gate-profiles/draftHalf.yaml`.
 */
const DRAFT_PIXELS = {
  browserGpu: false,
  imageFormat: 'png',
  scale: 0.25,
  colorSpace: 'bt709',
  pixelFormat: 'yuv420p',
  codec: 'h264',
  crf: 23,
  gopSize: 30,
  encoder: { threads: 1, preset: 'medium', tune: 'none', rcLookahead: 40, aqMode: 1, psy: 1, bitexact: true },
} as unknown as Parameters<typeof buildSegmentArtifact>[0]['pixelProfile'];

function gateMedia(
  fps: SegmentRenderRequest['compileProfile']['fps'],
  pixelProfile = DRAFT_PIXELS,
): GateMedia {
  return createGateMedia({
    buildSegmentArtifact,
    framemd5Of,
    pixelProfile,
    fps: fps as unknown as Parameters<typeof buildSegmentArtifact>[0]['fps'],
  });
}

const runRoot = (): string => mkdtempSync(path.join(tmpdir(), 'vpe-h06-'));

/** Клипы запроса каждого шаблона. `kenburns@1` — смешанный (поправка владельца П2). */
const CASES = [
  {
    call: 'still@1',
    clips: [{ template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true }],
    captions: false,
  },
  {
    call: 'kenburns@1',
    clips: [
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      { template: 'kenburns@1', params: FIXTURE_PARAMS.kenburns, z: 10 },
    ],
    captions: false,
  },
  {
    call: 'flash@1',
    clips: [{ template: 'flash@1', params: FIXTURE_PARAMS.flash, z: 20 }],
    captions: false,
  },
  {
    call: 'captionEmphasis@1',
    clips: [
      { template: 'captionEmphasis@1', params: FIXTURE_PARAMS.captionEmphasis, z: 30, withFont: true },
    ],
    captions: true,
  },
] as const;

describe('`H-06` — живой гейт V13 на профиле `draftHalf`, N = 3', () => {
  for (const kase of CASES) {
    it(
      `\`${kase.call}\`: три прогона дают один \`framemd5\` и один \`sha256\``,
      async () => {
        const fixture = makeTemplateFixture([...kase.clips], {
          frames: FRAMES,
          withCaptions: kase.captions,
        });
        const request = await readyRequest(fixture.request);

        const outcome = await runGate({
          request,
          runRoot: runRoot(),
          profileId: 'draftHalf',
          media: gateMedia(request.compileProfile.fps),
          now: () => '2026-08-29T00:00:00Z',
          options: { clock: realClock(), registry: rendererTemplates, parentEnv: process.env },
        });

        // Печать — то, что увидит автор шаблона, и она же источник `wallMs` для манифестов.
        console.log(`\n=== ${kase.call} ===\n${formatGateOutcome(outcome)}`);

        expect(outcome.class, formatGateOutcome(outcome)).toBe('PASS');
        if (outcome.class !== 'PASS') return;

        expect(outcome.runs).toHaveLength(3);
        expect(outcome.record.N).toBe(3);
        expect(outcome.record.profileId).toBe('draftHalf');
        expect(outcome.record.engineFingerprint).toMatch(/^[0-9a-f]{64}$/u);
        // Все три прогона мерили ОДНО окружение — иначе это не гейт пары.
        expect(new Set(outcome.runs.map((r) => r.engineFingerprint)).size).toBe(1);
        // Кадры на диске держатся только у опорного прогона (потолок 2×, а не N×).
        expect(outcome.runs.filter((r) => r.framesDir !== null)).toHaveLength(1);
        // Число кадров ИЗМЕРЕНО в готовом файле, а не взято из запроса.
        expect(new Set(outcome.runs.map((r) => r.frameCount))).toEqual(new Set([FRAMES]));
      },
      TIMEOUT,
    );
  }
});

describe('`H-06` — вырожденные входы дают `error`, а НЕ PASS на пустом (поправка владельца П1-б)', () => {
  it(
    '`bed@1`: аудио-шаблон в видео-сегменте — отказ композиции, гейта не было',
    async () => {
      const fixture = makeTemplateFixture(
        [{ template: 'bed@1', params: { asset: 'pad-loop' }, z: 0 }],
        { frames: FRAMES },
      );
      const request = await readyRequest(fixture.request);
      const outcome = await runGate({
        request,
        runRoot: runRoot(),
        profileId: 'draftHalf',
        media: gateMedia(request.compileProfile.fps),
        now: () => '2026-08-29T00:00:00Z',
        options: { clock: realClock(), registry: rendererTemplates, parentEnv: process.env },
      });

      expect(outcome.class, formatGateOutcome(outcome)).toBe('error');
      if (outcome.class !== 'error') return;
      // Без охранника `PAGEERROR` (`H-05`) здесь были бы три одинаковых набора ЧЁРНЫХ кадров,
      // то есть PASS про пустой сегмент — ровно долг №164.
      expect(outcome.why).toContain('ADR-0008 композиция');
      expect(outcome.runs).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    '`kenburns@1` БЕЗ слоя под собой — «эффекту нечего двигать», а не пустое движение',
    async () => {
      const fixture = makeTemplateFixture(
        [{ template: 'kenburns@1', params: FIXTURE_PARAMS.kenburns, z: 10 }],
        { frames: FRAMES },
      );
      const request = await readyRequest(fixture.request);
      const outcome = await runGate({
        request,
        runRoot: runRoot(),
        profileId: 'draftHalf',
        media: gateMedia(request.compileProfile.fps),
        now: () => '2026-08-29T00:00:00Z',
        options: { clock: realClock(), registry: rendererTemplates, parentEnv: process.env },
      });

      expect(outcome.class, formatGateOutcome(outcome)).toBe('error');
      if (outcome.class !== 'error') return;
      expect(outcome.why).toContain('ADR-0008 композиция');
      expect(outcome.runs).toHaveLength(0);
    },
    TIMEOUT,
  );
});
