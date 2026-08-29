// **ЖИВОЙ ГЕЙТ V13 НА ПРОФИЛЕ `final`: `kenburns@1`, N = 10.** Один на всю задачу.
//
// ═══ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ. ЭТО ДОЛГИЙ ТЕСТ ═══
// Отдельным файлом от `templates-gate.test.ts` намеренно: там четыре дешёвых прогона на
// `draftHalf`, здесь один дорогой на полном разрешении, и смешивать их значило бы платить
// цену `final` каждый раз, когда хочется проверить `draftHalf`.
//
// ПОЧЕМУ ИМЕННО `kenburns@1` (решение владельца, развилка «в», вариант в1). Он единственный из
// пяти, кто ДВИГАЕТ пиксели. `FACT` (SP-3e §1.1, таблица ADR-0008 строка 8): моушн-композиция
// на софтверном пути — та самая пара, которая гейт ПРОВАЛИЛА: 4 варианта из 10 при `w=4` и
// 3 из 3 при `w=1`. Статичная картинка на этом месте почти ничего не проверяла бы: гейт мерит
// воспроизводимость, а воспроизводить нечего там, где ничего не меняется.
//
// ЧТО ЭТОТ ТЕСТ ДОКАЗЫВАЕТ СВЕРХ ГЕЙТА — **профиль `final` после правки №154**. До правки он
// нёс `imageFormat: jpeg`, который адаптер отказывает, то есть на нём не рендерилось НИЧЕГО.
// Правка сделана `H-03` (коммит `2e10ecd`), но живого прогона на `final` с тех пор не было ни
// одного: `H-03` мерил окружение, а не кадры. Здесь он есть.
//
// ЧИСЛА ЭНКОДЕРА — ИЗ `fixtures/minimal/profiles/render.final.yaml` ДОСЛОВНО. Выдумывать их
// нельзя: `FACT` (SP-3 блок D) двойной энкод даёт побайтово равный mp4 при `threads=1` и при
// `threads=4`, но МЕЖДУ СОБОЙ эти битстримы различны — то есть выдуманный энкодер дал бы
// `sha256` про другой файл (то же основание, что у третьего входа команды `E-00` §5).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSegmentArtifact, framemd5Of } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import { createGateMedia } from '../src/gate-media.js';
import { formatGateOutcome, runGate } from '../src/gate.js';
import { rendererTemplates } from '../src/templates/index.js';
import { FIXTURE_PARAMS, makeTemplateFixture, readyRequest } from './fixture.js';

/**
 * Шесть кадров, а не двенадцать: `final` — это 1080×1920, то есть в шестнадцать раз больше
 * пикселей на кадр, и N = 10 вместо 3. Шести хватает: наезд 12 % за шесть кадров меняет
 * КАЖДЫЙ кадр, а гейт мерит совпадение прогонов между собой, а не длину ролика.
 */
const FRAMES = 6;

/**
 * ТАЙМАУТ ПО ИЗМЕРЕНИЮ, А НЕ С ПОТОЛКА. Измерено на этой машине: `templates-gate.test.ts`
 * (N = 3, 12 кадров, 270×480) — весь файл из шести тестов за 161 с, один гейт ≈ 40 с.
 * Здесь прогонов втрое больше, пикселей на кадр в шестнадцать раз больше, кадров вдвое
 * меньше ⇒ `INFERENCE` 2–5 минут. 900 000 мс — запас, а не ожидание.
 */
const TIMEOUT = 900_000;

const realClock = (): (() => number) => () => performance.now();

/** `pixelProfile` энкодера — числа `render.final.yaml` (после правки №154: `png`, без `jpegQuality`). */
const FINAL_PIXELS = {
  browserGpu: false,
  imageFormat: 'png',
  scale: 1,
  colorSpace: 'bt709',
  pixelFormat: 'yuv420p',
  codec: 'h264',
  crf: 18,
  gopSize: 30,
  encoder: { threads: 4, preset: 'medium', tune: 'none', rcLookahead: 40, aqMode: 1, psy: 1, bitexact: true },
} as unknown as Parameters<typeof buildSegmentArtifact>[0]['pixelProfile'];

describe('`H-06` — живой гейт V13 на профиле `final`, N = 10', () => {
  it(
    '`kenburns@1` на полном разрешении: десять прогонов дают один файл',
    async () => {
      const fixture = makeTemplateFixture(
        [
          { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
          { template: 'kenburns@1', params: FIXTURE_PARAMS.kenburns, z: 10 },
        ],
        // `scale: 1` и `workers: 4` — то, чем `final` отличается от `draftHalf`.
        { frames: FRAMES, scale: 1, workers: 4 },
      );
      const request = await readyRequest(fixture.request);
      // Профиль исполнен, а не заявлен: адаптер читает ровно эти три поля (**K4**).
      expect(request.pixelProfile.scale).toBe(1);
      expect(request.pixelProfile.imageFormat).toBe('png');

      const outcome = await runGate({
        request,
        runRoot: mkdtempSync(path.join(tmpdir(), 'vpe-h06-final-')),
        profileId: 'final',
        media: createGateMedia({
          buildSegmentArtifact,
          framemd5Of,
          pixelProfile: FINAL_PIXELS,
          fps: request.compileProfile.fps as unknown as Parameters<typeof buildSegmentArtifact>[0]['fps'],
        }),
        now: () => '2026-08-29T00:00:00Z',
        options: { clock: realClock(), registry: rendererTemplates, parentEnv: process.env },
      });

      console.log(`\n=== kenburns@1 · final · N=10 ===\n${formatGateOutcome(outcome)}`);

      expect(outcome.class, formatGateOutcome(outcome)).toBe('PASS');
      if (outcome.class !== 'PASS') return;

      // N берётся из схемы (`GATE_RUNS`), а не из литерала теста: десятка здесь — проверка
      // того, что профиль назван верно, а не повтор константы.
      expect(outcome.runs).toHaveLength(10);
      expect(outcome.record.N).toBe(10);
      expect(outcome.record.profileId).toBe('final');
      expect(outcome.record.engineFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      expect(new Set(outcome.runs.map((r) => r.engineFingerprint)).size).toBe(1);
      expect(new Set(outcome.runs.map((r) => r.frameCount))).toEqual(new Set([FRAMES]));
      // Обе величины ADR-0008 — по одной на десять прогонов.
      expect(new Set(outcome.runs.map((r) => r.framemd5Sha256)).size).toBe(1);
      expect(new Set(outcome.runs.map((r) => r.sha256)).size).toBe(1);
    },
    TIMEOUT,
  );
});
