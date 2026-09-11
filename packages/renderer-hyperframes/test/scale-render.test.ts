// **ОХРАННИК №265: НА `scale < 1` КОМПОЗИЦИЯ УМЕНЬШАЕТСЯ РОВНО ОДИН РАЗ И ЦЕЛИКОМ.**
// *(бывший охранник №182; форма ассерта заменена `FIX-02`, 2026-09-11 — разбор ниже.)*
//
// ═══ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у прочих браузерных файлов (решение владельца `H-01`, §4 п. 2): тест
// либо зелёный, либо красный, но не «пропущен».
//
// ═══ ПРИШПИЛЕНО: `hyperframes@0.8.5`. ═══
// Правка, которую этот файл стережёт, стоит ПРОТИВ поведения вендора: его инжектируемый
// рантайм перезаписывает `#root.style.width/height` инлайном на `data-width`/`data-height` и
// ставит корню `overflow: hidden` (измерено `FIX-02`, `RUNTIME_IIFE` в `hyperframes/dist/cli.js`).
// Смена версии вендора может это поведение убрать — тогда покраснеет этот файл, и это СИГНАЛ,
// а не поломка теста.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// **ПОЧЕМУ ПРЕЖНЯЯ ФОРМА АССЕРТА БЫЛА НЕГОДНОЙ — ЭТО ГЛАВНОЕ, ЧТО ЗДЕСЬ НАДО ЗНАТЬ.**
//
// До `FIX-02` файл считал ДОЛЮ НЕЧЁРНЫХ ПИКСЕЛЕЙ ПО ЧЕТЫРЁМ КВАДРАНТАМ на `solid@1` и требовал
// `100 / 100 / 100 / 100`. Прибор отвечал на вопрос «занят ли кадр целиком» — и отвечал верно.
// Но настоящий вопрос другой: «занят ли кадр ТЕМ, ЧЕМ НАДО». Полноэкранная заливка даёт четыре
// сотни и тогда, когда в кадр попала ЧЕТВЕРТЬ композиции, растянутая на весь кадр, — а это и
// был дефект №265: на `draftHalf` в кадре оказывался левый верхний квадрант, субтитры (полоса
// на `bottom: 500px` от низа 1920) уходили за кадр целиком, и охранник оставался зелёным.
// Дефект прожил от `FIX-01` (2026-08-29) до `DEMO-POMPEII` (2026-09-10) и был найден ГЛАЗАМИ
// на готовом ролике, а не тестом.
//
// **ЧТО СТОИТ ВМЕСТО НЕЁ — ДВА НЕЗАВИСИМЫХ ИЗМЕРЕНИЯ.**
//   1. **АДРЕСНОЕ.** Композиция-линейка [`markers.ts`](./markers.ts) кладёт четыре цветных
//      квадрата 100×100 по углам БАЗОВОЙ композиции и полосу во всю ширину на месте субтитров.
//      На `scale: 0.5` каждый маркер обязан лежать в СВОЁМ углу ПОЛОВИННОГО кадра по
//      координатам `x·0.5` с допуском ±2 px. Такой ассерт краснеет и на обрезке (маркера нет
//      в кадре вовсе), и на двойном масштабе (маркер вдвое ближе к началу координат), и на
//      потерянном масштабе (маркер за кадром) — то есть на всех трёх формах дефекта сразу.
//   2. **СОДЕРЖАТЕЛЬНОЕ.** Кадр `scale: 0.5` сравнивается с кадром `scale: 1`, уменьшенным
//      `ffmpeg scale=540:960:flags=area`, по средней абсолютной разности яркости. Это
//      определение чернового профиля, записанное числом: черновик обязан БЫТЬ уменьшенной
//      копией полного. Прежнему прибору эталона «не существовало» — на самом деле он есть,
//      просто его надо построить, а не найти.
//
// **ПОРОГ MAD.** ИЗМЕРЕНО на исправленном дереве (`FIX-02`): **0.0000** — на линейке из
// плоских заливок при точном отношении 2:1 уменьшение `area` совпадает с браузерным
// попиксельно. Порог поставлен **0.5**, а не «ноль ×2»: ноль здесь — свойство ПЛОСКИХ цветов,
// и обещать его для содержимого с градиентами нечем, а половина уровня яркости — всё ещё на
// два порядка меньше любой настоящей ошибки кадрирования (сдвиг полосы даёт MAD в десятки).
//
// ВТОРОГО PNG-ДЕКОДЕРА НЕ ЗАВОДИТСЯ: `decodeRgb` — тот же, которым `where` считает PSNR
// (решение владельца `H-04`: декод PNG вызовом ffmpeg, а ffmpeg тут уже требуется preflight'ом
// `renderSegment`). Уменьшение эталона — тот же вызов с `-vf scale`, а не второй ресемплер.

import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { rendererTemplates, type RendererTemplateRegistry } from '../src/templates/index.js';
import { decodeRgb, pngSize } from '../src/where.js';
import { FIXTURE_PARAMS, makeTemplateFixture, readyRequest } from './fixture.js';
import {
  BAND_BOTTOM,
  BAND_HEIGHT,
  MARKERS_REGISTRY,
  MARKER_COLORS,
  MARKER_SIZE,
} from './markers.js';

const pexecFile = promisify(execFile);

/** Два кадра: предмет — геометрия одного кадра, а не движение. */
const FRAMES = 2;
/** Измерено (`FIX-02`): два рендера линейки (1080×1920 и 540×960) — 4 с. Запас ×75. */
const TIMEOUT = 300_000;
/** Базовая геометрия фикстуры — она же геометрия, в которой линейка расставляет маркеры. */
const BASE_WIDTH = 1080;
const BASE_HEIGHT = 1920;
/** Допуск адресного ассерта в пикселях ВЫХОДНОГО кадра. */
const TOLERANCE_PX = 2;
/** Порог средней абсолютной разности яркости на ЛИНЕЙКЕ. Измерено 0.0000 — см. шапку. */
const MAD_LIMIT = 0.5;
/**
 * Порог MAD на ДВИЖУЩЕЙСЯ пробе (`still@1` + `kenburns@1`) — **2.0** при измеренных **0.3184**.
 *
 * Он больше нуля не «на всякий случай», а потому, что здесь сравниваются две РАЗНЫЕ
 * растеризации фотографии: контроль (одна фотография без движения) даёт 0.1947 сам по себе.
 * Разрыв между зелёным и красным при этом ×108 — измеренная поломка давала 34.41.
 */
const MAD_MOVING_LIMIT = 2;

const realClock = (): (() => number) => () => performance.now();

interface Shot {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly rgb: Buffer;
}

/** Один рендер линейки на заданном `scale` и разбор первого кадра. */
async function shoot(scale: number): Promise<Shot> {
  return shootClips([{ template: 'markers@1', params: {}, z: 0 }], MARKERS_REGISTRY, scale);
}

/**
 * **ДВИЖУЩАЯСЯ ПРОБА — ВТОРАЯ ПОЛОВИНА ОХРАННИКА, И ОНА ЗАВЕДЕНА ПО СЛУЧИВШЕМУСЯ.**
 *
 * Линейка неподвижна, а `kenburns@1` анимирует слой НИЖЕ себя через GSAP (`x`, `y`, `scale`),
 * и GSAP пишет ИНЛАЙНОВЫЙ `transform`. Первая правка `FIX-02` ставила масштаб слоя
 * `transform`'ом — на линейке она давала безупречные числа, а на каждом сегменте с движением
 * инлайн затирал её целиком, и черновой профиль показывал двукратный кроп. `FACT`
 * (`FIX-02`): MAD этой пробы **34.41** при `transform` и **0.3184** при `zoom`.
 *
 * Отсюда правило, записанное прибором: масштаб профиля обязан быть свойством, которого не
 * пишет ни один шаблон. Проба ловит нарушение независимо от того, КАКИМ свойством его
 * попробуют поставить в следующий раз.
 */
async function shootMoving(scale: number): Promise<Shot> {
  return shootClips(
    [
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      { template: 'kenburns@1', params: FIXTURE_PARAMS.kenburns, z: 10 },
    ],
    rendererTemplates,
    scale,
  );
}

async function shootClips(
  clips: Parameters<typeof makeTemplateFixture>[0],
  registry: RendererTemplateRegistry,
  scale: number,
): Promise<Shot> {
  const fixture = makeTemplateFixture(clips, { frames: FRAMES, scale });
  const request = await readyRequest(fixture.request, registry);
  const response = await renderSegment(request, {
    clock: realClock(),
    registry,
    parentEnv: process.env,
    gate: { mode: 'skip', why: 'проба геометрии №265: гейт здесь не снимается' },
  });
  if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);
  expect(response.frames.frameCount).toBe(FRAMES);

  const first = readdirSync(response.frames.dir)
    .filter((n) => n.endsWith('.png'))
    .sort()[0];
  if (first === undefined) throw new Error('кадров на диске нет');
  const file = path.join(response.frames.dir, first);
  const size = pngSize(file);
  if (size === null) throw new Error(`PNG не прочитан: ${file}`);
  return { file, width: size.width, height: size.height, rgb: await decodeRgb(file) };
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Прямоугольник пикселей заданного цвета.
 *
 * Допуск по каналу — 40 уровней: после уменьшения край маркера смешивается с фоном, и точное
 * равенство ловило бы только середину. Цвета линейки разнесены на 255, поэтому спутать
 * соседей допуск не может.
 */
export function boxOfColor(
  rgb: Uint8Array,
  width: number,
  height: number,
  [r, g, b]: readonly [number, number, number],
  tolerance = 40,
): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const near =
        Math.abs((rgb[i] ?? 0) - r) <= tolerance &&
        Math.abs((rgb[i + 1] ?? 0) - g) <= tolerance &&
        Math.abs((rgb[i + 2] ?? 0) - b) <= tolerance;
      if (!near) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Средняя абсолютная разность яркости `BT.601` двух буферов `rgb24` одного размера. */
export function madLuma(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`длины буферов различны: ${String(a.length)} ≠ ${String(b.length)}`);
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const ya = 0.299 * (a[i] ?? 0) + 0.587 * (a[i + 1] ?? 0) + 0.114 * (a[i + 2] ?? 0);
    const yb = 0.299 * (b[i] ?? 0) + 0.587 * (b[i + 1] ?? 0) + 0.114 * (b[i + 2] ?? 0);
    sum += Math.abs(ya - yb);
  }
  return sum / (a.length / 3);
}

/** Декод PNG с уменьшением до заданной геометрии — ЭТАЛОН чернового кадра. */
async function decodeScaled(file: string, width: number, height: number): Promise<Buffer> {
  const { stdout } = await pexecFile(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-i', file,
      '-vf', `scale=${String(width)}:${String(height)}:flags=area`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
  );
  return Buffer.from(stdout);
}

describe('**№265** — масштаб раскрывается ОДИН раз и на ВСЮ композицию', () => {
  let half: Shot;
  let full: Shot;

  beforeAll(async () => {
    full = await shoot(1);
    half = await shoot(0.5);
  }, TIMEOUT);

  it('`scale: 0.5` — геометрия 540×960', () => {
    expect([half.width, half.height]).toEqual([BASE_WIDTH / 2, BASE_HEIGHT / 2]);
  });

  it('`scale: 1` — геометрия 1080×1920: полный профиль правкой не задет', () => {
    expect([full.width, full.height]).toEqual([BASE_WIDTH, BASE_HEIGHT]);
  });

  // Ожидаемое положение маркера в кадре — координата базовой композиции, умноженная на `scale`.
  // Ни одного числа «из наблюдения» здесь нет: все четыре угла и полоса считаются из констант
  // линейки, поэтому подогнать тест под кривой кадр нечем.
  const corners = [
    ['ЛВ', MARKER_COLORS.topLeft, 0, 0],
    ['ПВ', MARKER_COLORS.topRight, BASE_WIDTH - MARKER_SIZE, 0],
    ['ЛН', MARKER_COLORS.bottomLeft, 0, BASE_HEIGHT - MARKER_SIZE],
    ['ПН', MARKER_COLORS.bottomRight, BASE_WIDTH - MARKER_SIZE, BASE_HEIGHT - MARKER_SIZE],
  ] as const;

  for (const [name, color, baseX, baseY] of corners) {
    it(`\`scale: 0.5\` — угловой маркер ${name} лежит в своём углу половинного кадра`, () => {
      const box = boxOfColor(half.rgb, half.width, half.height, color);
      expect(box, `маркер ${name} в кадре не найден вовсе — композиция обрезана`).not.toBeNull();
      if (box === null) return;
      const near = (got: number, want: number): void => {
        expect(Math.abs(got - want), `${name}: получено ${String(got)}, ожидалось ${String(want)}`)
          .toBeLessThanOrEqual(TOLERANCE_PX);
      };
      near(box.x0, baseX * 0.5);
      near(box.y0, baseY * 0.5);
      near(box.width, MARKER_SIZE * 0.5);
      near(box.height, MARKER_SIZE * 0.5);
    });
  }

  it('`scale: 0.5` — полоса субтитров видна и стоит на своей высоте', () => {
    const box = boxOfColor(half.rgb, half.width, half.height, MARKER_COLORS.band);
    expect(box, 'полосы на месте субтитров в кадре нет — ровно симптом №265').not.toBeNull();
    if (box === null) return;
    expect(box.x0).toBe(0);
    expect(Math.abs(box.width - BASE_WIDTH * 0.5)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(box.height - BAND_HEIGHT * 0.5)).toBeLessThanOrEqual(TOLERANCE_PX);
    // Верхняя кромка полосы: `(1920 − 500 − 120) · 0.5 = 650`.
    expect(Math.abs(box.y0 - (BASE_HEIGHT - BAND_BOTTOM - BAND_HEIGHT) * 0.5))
      .toBeLessThanOrEqual(TOLERANCE_PX);
    // И она в НИЖНЕЙ трети кадра — то самое, чего не было при обрезке.
    expect(box.y0).toBeGreaterThan((half.height * 2) / 3);
  });

  it(
    '`scale: 0.5` — кадр совпадает с уменьшенным кадром `scale: 1` (MAD по яркости)',
    async () => {
      const reference = await decodeScaled(full.file, half.width, half.height);
      const mad = madLuma(reference, half.rgb);
      expect(mad, `MAD по яркости = ${mad.toFixed(4)} при пороге ${String(MAD_LIMIT)}`)
        .toBeLessThan(MAD_LIMIT);
    },
    TIMEOUT,
  );

  it(
    '**ДВИЖЕНИЕ** — `still@1` + `kenburns@1` на `scale: 0.5` тоже уменьшенная копия `final`',
    async () => {
      const movingFull = await shootMoving(1);
      const movingHalf = await shootMoving(0.5);
      expect([movingHalf.width, movingHalf.height]).toEqual([BASE_WIDTH / 2, BASE_HEIGHT / 2]);
      const reference = await decodeScaled(movingFull.file, movingHalf.width, movingHalf.height);
      const mad = madLuma(reference, movingHalf.rgb);
      expect(
        mad,
        `MAD по яркости на ДВИЖУЩЕЙСЯ пробе = ${mad.toFixed(4)} при пороге ` +
          `${String(MAD_MOVING_LIMIT)}. Красное здесь означает, что масштаб профиля поставлен ` +
          'свойством, которое шаблон перебивает: GSAP пишет инлайновый `transform`, и он ' +
          'сильнее любой нашей таблицы стилей (`FIX-02`, измерено 34.41 против 0.3184)',
      ).toBeLessThan(MAD_MOVING_LIMIT);
    },
    TIMEOUT,
  );
});
