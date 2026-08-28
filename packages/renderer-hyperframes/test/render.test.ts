// СКВОЗНОЙ ПУТЬ С НАСТОЯЩИМ БРАУЗЕРОМ: IR → каталог → HyperFrames → PNG → `media` → артефакт.
//
// ═══ ЭТОТ ФАЙЛ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. SKIP'А ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Решение владельца (`H-01`, §4 п. 2), паритет с решением `M-03` п. 9 про ffmpeg: тест либо
// зелёный, либо красный, но не «пропущен». Переменная вида `VPE_REQUIRE_BROWSER` и есть тот
// самый skip, который `M-03` запретил. Цена принята заранее: на машине без доступа к хосту
// загрузки Chrome этот файл красный по ОКРУЖЕНИЮ — и это свойство приёмки, а не тестов.
// Поэтому юнит-часть (`contract`, `materialize`, `argv`, `r2-r3`) лежит ОТДЕЛЬНЫМИ файлами:
// видно, что зелено без браузера, а что нет. Браузер ставится `pnpm --filter
// @vpe/renderer-hyperframes preflight`.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. Что путь сходится целиком и что кодирует ЕГО НАШ ffmpeg, а не
// рендерер. Равенство `framemd5` двух прогонов здесь — ДЫМ, а не гейт: гейт V13 — это N = 10
// прогонов на `final` и 3 на `draftHalf` с записью в манифест (`H-04`), и подменять его двумя
// прогонами на синтетическом шаблоне нельзя.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertNoAudioTrack,
  buildSegmentArtifact,
  readEncoderSignature,
  type SegmentArtifact,
} from '@vpe/media';

import { renderSegment } from '../src/run.js';
import { validateRequest } from '../src/validate.js';
import { makeFixture, withPatch } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';
/**
 * **R12** (`H-04`): у `renderSegment` нет умолчания «рендерить без гейта» — решение о
 * проходе принимается ЯВНО и с причиной. Здесь причина одна на файл: тест адаптера (`H-01`), а не сборка ролика: гейта V13 у синтетического `solid@1` нет и быть не может.
 */
const GATE_SKIP = { mode: 'skip', why: 'тест адаптера (`H-01`), а не сборка ролика: гейта V13 у синтетического `solid@1` нет и быть не может' } as const;


/** Полный `pixelProfile` из `fixtures/minimal/profiles/render.ac4.yaml` — для `media`. */
const AC4_PIXEL_PROFILE = {
  browserGpu: false,
  imageFormat: 'png',
  scale: 0.25,
  colorSpace: 'bt709',
  pixelFormat: 'yuv420p',
  codec: 'h264',
  crf: 18,
  gopSize: 30,
  encoder: {
    threads: 1,
    preset: 'medium',
    tune: 'none',
    rcLookahead: 40,
    aqMode: 1,
    psy: 1,
    bitexact: true,
  },
} as unknown as Parameters<typeof buildSegmentArtifact>[0]['pixelProfile'];

const FRAMES = 30;
/** Явный таймаут: тест зовёт Chrome и ffmpeg (правило сессии). */
const TIMEOUT = 300_000;

const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/** Полный прогон: материализация с верным `bundle.hash` → рендер → артефакт. */
async function renderOnce(seq: number): Promise<{ artifact: SegmentArtifact; engineHash: string | null }> {
  const fixture = makeFixture({ frames: FRAMES, withFont: true });

  // Первый прогон нужен, чтобы узнать `compositionHash`: его считает материализация, а
  // `bundle.hash` — поле ВХОДА. В настоящей сборке эту величину знает `L-01` (стадия
  // `compose`); здесь её узнаёт тест — тем же способом, каким узнает `L-01`.
  const probe = await renderSegment(fixture.request, {
    clock: fakeClock(),
    gate: GATE_SKIP,
    registry: TEST_REGISTRY,
    spawnRenderer: () => Promise.resolve(0),
  });
  if (probe.ok) throw new Error('первый прогон обязан отказать по `bundle.hash`');
  const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
  if (hash === undefined) throw new Error(probe.error.message);

  const request = validateRequest(
    withPatch(fixture.request, { bundle: { ...fixture.request.bundle, hash } }),
  );

  const response = await renderSegment(request, {
    clock: fakeClock(),
    gate: GATE_SKIP,
    registry: TEST_REGISTRY,
    parentEnv: process.env,
  });
  expect(response.ok, JSON.stringify(response, null, 2)).toBe(true);
  if (!response.ok) throw new Error('рендер не прошёл');

  expect(response.frames.frameCount).toBe(FRAMES);

  mkdirSync(path.dirname(request.outputPath), { recursive: true });
  const artifact = await buildSegmentArtifact({
    frames: response.frames,
    pixelProfile: AC4_PIXEL_PROFILE,
    fps: request.compileProfile.fps as unknown as Parameters<typeof buildSegmentArtifact>[0]['fps'],
    outputPath: path.join(path.dirname(request.outputPath), `segment-${String(seq)}.mts`),
    stats: response.stats,
  });
  return { artifact, engineHash: response.engineCompositionHash };
}

describe('сквозной путь на синтетическом шаблоне `solid@1`', () => {
  it(
    'кадры → артефакт: 30 кадров, профиль исполнен, аудио нет',
    async () => {
      const { artifact, engineHash } = await renderOnce(1);

      // Число кадров ИЗМЕРЕНО в готовом файле (`ffprobe -count_packets`), а не заказано.
      expect(artifact.frameCount).toBe(FRAMES);

      // `stream` измерен, а не эхо профиля: 1080×1920 × scale 0.25 = 270×480.
      expect(artifact.stream.width).toBe(270);
      expect(artifact.stream.height).toBe(480);
      expect(artifact.stream.codec).toBe('h264');
      expect(artifact.stream.pixFmt).toBe('yuv420p');
      expect(artifact.stream.colorSpace).toBe('bt709');
      expect(artifact.stream.fpsNum).toBe(30);
      expect(artifact.stream.fpsDen).toBe(1);

      // **R5** на настоящем файле.
      await assertNoAudioTrack({ path: artifact.path });

      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(artifact.framemd5Sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(artifact.stats.wallMs).toBeGreaterThan(0);

      // `engineCompositionHash` — величина САМОГО рендерера (16 hex, `FACT` SP-3c §7), а не
      // наш `bundle.hash` (64 hex). Если рендерер её не назвал — `null`, а не выдумка.
      if (engineHash !== null) {
        expect(engineHash).not.toBe(artifact.sha256);
        expect(engineHash.length).toBeLessThan(64);
      }
    },
    TIMEOUT,
  );

  it(
    'mp4 кодирует `media`, а НЕ HyperFrames: подпись энкодера x264 на месте',
    async () => {
      const { artifact } = await renderOnce(2);
      // `FACT` (`M-04`): подпись SEI переживает `-c copy` и читается из ЭЛЕМЕНТАРНОГО потока.
      // Её наличие означает, что файл собрал libx264 нашей командной строкой; рендерер
      // отдал только PNG — контейнера он не собирал вовсе (**R10**).
      const signature = await readEncoderSignature({ path: artifact.path });
      expect(signature).toContain('x264');
      // Профиль исполнен: `crf=18` и однопоточный энкод из `render.ac4.yaml`.
      expect(signature).toContain('crf=18');
      expect(signature).toContain('threads=1');
    },
    TIMEOUT,
  );

  it(
    'ДЫМ (не гейт): два прогона дают равные `framemd5Sha256` и равный sha256',
    async () => {
      const first = await renderOnce(3);
      const second = await renderOnce(4);
      expect(second.artifact.framemd5Sha256).toBe(first.artifact.framemd5Sha256);
      expect(second.artifact.sha256).toBe(first.artifact.sha256);
      // Гейт V13 — это 10 прогонов на `final` и 3 на `draftHalf` с записью в манифест
      // (`H-04`); два прогона на синтетическом шаблоне его не заменяют и не притворяются им.
    },
    TIMEOUT,
  );
});

describe('отказы до браузера остаются отказами и с установленным браузером', () => {
  it(
    'шаблон без реализации — `V3`, и ни одного PNG не появилось',
    async () => {
      const fixture = makeFixture({ frames: 2, template: 'kenburns@1' });
      const response = await renderSegment(fixture.request, {
        clock: fakeClock(),
        gate: GATE_SKIP,
        registry: TEST_REGISTRY,
        parentEnv: process.env,
      });
      expect(response.ok).toBe(false);
      if (response.ok) return;
      expect(response.error.rule).toBe('V3');
      expect(existsSync(path.join(fixture.request.tmpDir, 'frames'))).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'каталог композиции у рендерера был именно наш: `index.html` читаем и содержит IR',
    async () => {
      const fixture = makeFixture({ frames: 2 });
      const probe = await renderSegment(fixture.request, {
        clock: fakeClock(),
        gate: GATE_SKIP,
        registry: TEST_REGISTRY,
        spawnRenderer: () => Promise.resolve(0),
        keepTmp: true,
      });
      if (probe.ok) throw new Error('ожидался отказ по `bundle.hash`');
      const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
      if (hash === undefined) throw new Error(probe.error.message);
      const request = validateRequest(
        withPatch(fixture.request, { bundle: { ...fixture.request.bundle, hash } }),
      );
      await renderSegment(request, {
        clock: fakeClock(),
        gate: GATE_SKIP,
        registry: TEST_REGISTRY,
        parentEnv: process.env,
        keepTmp: true,
      });
      const html = readFileSync(path.join(request.bundle.path, 'index.html'), 'utf8');
      expect(html).toContain('r:aaaa0001');
      expect(html).toContain('solid-fill');
    },
    TIMEOUT,
  );
});

