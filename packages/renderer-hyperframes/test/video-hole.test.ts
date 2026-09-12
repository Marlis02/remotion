// **ДЫРА `video@1` ЖИВЁТ ТОЛЬКО В ОКНЕ КЛИПА И ТОЛЬКО ТАМ, ГДЕ ЕЁ ЗАКАЗАЛИ** (`VID-02c`,
// 2026-09-12; долги №271, №268, №269).
//
// ═══ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у прочих браузерных файлов (решение владельца `H-01`, §4 п. 2).
//
// **ЧТО ЗДЕСЬ ИЗМЕРЯЕТСЯ И ПОЧЕМУ ЭТО НЕЛЬЗЯ ПРОВЕРИТЬ ЧТЕНИЕМ КОДА.** До `VID-02c` правило
// `clip-path` ставилось ОДИН РАЗ на монтировании и жило весь сегмент: клип видео на кадрах
// 20…39 пробивал дыру и на кадре 0, и на кадре 59. Сегодня это было не видно — вне окна стадия
// ffmpeg видео не кладёт, и в дыре виден фон композиции, — но на сегменте, где под видео едет
// фотография, вне окна была бы ЧЁРНАЯ ДЫРА В НИКУДА поверх картинки. Доказать, что её больше
// нет, можно только одним способом: взять кадр вне окна и посмотреть на пиксель.
//
// **АЛЬФА, А НЕ ЦВЕТ.** Дыра — это `alpha = 0`, и `decodeRgb` (которым меряют PSNR и геометрию)
// альфу отбрасывает по определению. Поэтому здесь свой разбор кадра в `rgba` — тем же ffmpeg,
// тем же вызовом, что и `decodeRgb`, но с другим `-pix_fmt`. Второго ДЕКОДЕРА не заводится:
// заводится второй ФОРМАТ ВЫХОДА у того же.

import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

import type { VideoHolePlanInput } from '../src/contract.js';
import { renderSegment } from '../src/run.js';
import { rendererTemplates } from '../src/templates/index.js';
import { pngSize } from '../src/where.js';
import { FIXTURE_PARAMS, makeTemplateFixture, readyRequest } from './fixture.js';

const pexecFile = promisify(execFile);

/** Измерено: 60 кадров 270×480 в браузере — около трёх секунд. Запас ×100. */
const TIMEOUT = 300_000;
const FRAMES = 60;
/** Окно клипа видео: `[20, 40)`. Вне него дыры быть не должно. */
const CLIP_FROM = 20;
const CLIP_TO = 40;
/** Окно врезки в БАЗОВЫХ координатах композиции 1080×1920 — как его считает разворот плана. */
const RECT = { x: 659, y: 54, width: 367, height: 206 };
const RADIUS = 48;

const realClock = (): (() => number) => () => performance.now();

interface Shot {
  readonly width: number;
  readonly height: number;
  /** Кадры сегмента в порядке номера; каждый — сырые RGBA-байты. */
  readonly frames: readonly Buffer[];
}

/** Разбор PNG в RGBA. Тот же ffmpeg, что у `decodeRgb`, другой `-pix_fmt` (см. шапку). */
async function decodeRgba(file: string): Promise<Buffer> {
  const { stdout } = await pexecFile(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 28 },
  );
  return stdout;
}

async function shoot(holes: readonly VideoHolePlanInput[]): Promise<Shot> {
  const fixture = makeTemplateFixture(
    [
      // ПОД ВИДЕО ОБЯЗАНА ЛЕЖАТЬ НЕПРОЗРАЧНАЯ КАРТИНКА, иначе «дыры нет» и «под дырой пусто»
      // неразличимы: оба дают альфу 0. `still@1` кладёт узор на весь кадр.
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      {
        template: 'video@1',
        // `params` видео — литералом: `FIXTURE_PARAMS` читает случаи гейта шести шаблонов, а
        // геометрию окна этот тест задаёт САМ планом дыры (см. `RECT`). Совпадение их между
        // собой здесь и проверяется — держать его ещё и через случай гейта незачем.
        params: { asset: 'clip', frame: 'corner', corner: 'tr' },
        z: 20,
        withVideo: true,
        window: { frameStart: CLIP_FROM, frameEnd: CLIP_TO },
      },
    ],
    { frames: FRAMES, scale: 0.25, videoHoles: holes },
  );
  const request = await readyRequest(fixture.request);
  const response = await renderSegment(request, {
    clock: realClock(),
    registry: rendererTemplates,
    parentEnv: process.env,
    gate: { mode: 'skip', why: 'охранник дыры `VID-02c`: гейт здесь не снимается' },
  });
  if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);
  const names = readdirSync(response.frames.dir).filter((n) => n.endsWith('.png')).sort();
  expect(names).toHaveLength(FRAMES);
  const first = names[0];
  if (first === undefined) throw new Error('кадров на диске нет');
  const size = pngSize(path.join(response.frames.dir, first));
  if (size === null) throw new Error('PNG не прочитан');
  const frames: Buffer[] = [];
  for (const name of names) frames.push(await decodeRgba(path.join(response.frames.dir, name)));
  return { width: size.width, height: size.height, frames };
}

/** Альфа пикселя БАЗОВЫХ координат композиции: масштаб профиля раскрывается здесь. */
function alphaAtBase(shot: Shot, frame: number, baseX: number, baseY: number): number {
  const sx = Math.round((baseX * shot.width) / 1080);
  const sy = Math.round((baseY * shot.height) / 1920);
  const buf = shot.frames[frame];
  if (buf === undefined) throw new Error(`кадра ${String(frame)} нет`);
  return buf[(sy * shot.width + sx) * 4 + 3] ?? 0;
}

const SQUARE: readonly VideoHolePlanInput[] = [
  {
    clipId: 'r:h060002',
    frameStart: CLIP_FROM,
    frameEnd: CLIP_TO,
    radiusPx: 0,
    steps: [{ frame: CLIP_FROM, ...RECT }],
  },
];

let square: Shot;

beforeAll(async () => {
  square = await shoot(SQUARE);
}, TIMEOUT);

describe('**№271: дыра живёт ТОЛЬКО в окне клипа**', () => {
  it('внутри окна клипа середина врезки прозрачна', () => {
    const cx = RECT.x + Math.floor(RECT.width / 2);
    const cy = RECT.y + Math.floor(RECT.height / 2);
    for (const n of [CLIP_FROM, 30, CLIP_TO - 1]) {
      expect(alphaAtBase(square, n, cx, cy), `кадр ${String(n)} внутри окна: дыры нет`).toBeLessThan(16);
    }
  });

  it('ВНЕ окна клипа слои ниже ЦЕЛЫ — ни одного тронутого пикселя', () => {
    const cx = RECT.x + Math.floor(RECT.width / 2);
    const cy = RECT.y + Math.floor(RECT.height / 2);
    for (const n of [0, 10, CLIP_FROM - 1, CLIP_TO, 50, FRAMES - 1]) {
      expect(
        alphaAtBase(square, n, cx, cy),
        `кадр ${String(n)} ВНЕ окна [${String(CLIP_FROM)}, ${String(CLIP_TO)}): под видео пробита ` +
          'дыра в никуда — ровно дефект №271, из-за которого на сегменте с фотографией под ' +
          'видео был бы чёрный прямоугольник',
      ).toBeGreaterThan(200);
    }
  });

  it('снаружи врезки слой ниже цел и ВНУТРИ окна клипа', () => {
    // Иначе «дыра есть» было бы неотличимо от «слоя ниже нет вовсе».
    expect(alphaAtBase(square, 30, RECT.x - 20, RECT.y + 40)).toBeGreaterThan(200);
  });
});

describe('**№269: `radius` скругляет саму дыру**', () => {
  it(
    'угол окна НЕ прозрачен внутри радиуса, а середина окна прозрачна',
    async () => {
      const rounded = await shoot([{ ...SQUARE[0], radiusPx: RADIUS } as VideoHolePlanInput]);
      const cx = RECT.x + Math.floor(RECT.width / 2);
      const cy = RECT.y + Math.floor(RECT.height / 2);
      // Середина — по-прежнему дыра.
      expect(alphaAtBase(rounded, 30, cx, cy)).toBeLessThan(16);
      // Угол окна лежит ВНУТРИ прямоугольника, но СНАРУЖИ дуги: слой ниже там обязан уцелеть.
      // Без скругления тот же пиксель прозрачен — это и есть разница, которую вносит `radius`.
      const corner: readonly [number, number] = [RECT.x + 3, RECT.y + 3];
      expect(alphaAtBase(rounded, 30, corner[0], corner[1])).toBeGreaterThan(200);
      expect(alphaAtBase(square, 30, corner[0], corner[1])).toBeLessThan(16);
    },
    TIMEOUT,
  );
});
