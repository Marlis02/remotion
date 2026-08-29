// **ОХРАННИК ДОЛГА №182: ПРИ `scale < 1` КОМПОЗИЦИЯ ЗАПОЛНЯЕТ КАДР ЦЕЛИКОМ.**
//
// ═══ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у прочих браузерных файлов (решение владельца `H-01`, §4 п. 2): тест
// либо зелёный, либо красный, но не «пропущен».
//
// ЧТО БЫЛО НЕ ТАК. Масштаб профиля раскрывался ДВАЖДЫ: его применял сам рендерер (он и обязан
// — размер выхода он берёт из `data-width`/`data-height` корня) и ещё раз мы, трансформой
// `#root { transform: scale(...) }`. `FACT` (`FIX-01`, зонд на `solid@1`): при `scale: 0.5`
// кадр выходил 540×960, а содержимое занимало 270×480 — левую верхнюю четверть, остальное
// чёрное. Гейты при этом были ЗЕЛЁНЫЕ и оставались осмысленными (гейт мерит СОВПАДЕНИЕ
// прогонов, а кривая картинка воспроизводится не хуже верной) — то есть без этого файла
// дефект не краснел нигде.
//
// **ФОРМА АССЕРТА — ДОЛЯ НЕЧЁРНЫХ ПИКСЕЛЕЙ ПО ЧЕТЫРЁМ КВАДРАНТАМ, И ЭТО ВЫБОР ПО ЦЕНЕ**
// (владелец оставил выбор). PSNR и bbox из [`where.ts`](../src/where.ts) сравнивают две
// картинки — а здесь сравнивать не с чем: ЭТАЛОНА верного кадра не существует, его никто
// никогда не рендерил. Квадранты же отвечают ровно на тот вопрос, которым дефект и описан:
// «занят ли кадр целиком». Они ловят и сжатие в угол (`100/0/0/0`), и сдвиг (нули в двух
// квадрантах), и не требуют ничего, кроме уже существующего декодера.
//
// ВТОРОГО PNG-ДЕКОДЕРА НЕ ЗАВОДИТСЯ: `decodeRgb` — тот же, которым `where` считает PSNR
// (решение владельца `H-04`: декод PNG вызовом ffmpeg, а ffmpeg тут уже требуется preflight'ом
// `renderSegment`).
//
// **ПОЧЕМУ `solid@1`, А НЕ НАСТОЯЩИЙ ШАБЛОН.** Предмет здесь — ГЕОМЕТРИЯ КОМПОЗИЦИИ, а не
// шаблон: дефект воспроизводился и на синтетическом `solid@1` (`H-01`), то есть существовал
// до реализаций `H-06`. Сплошная заливка во весь слой — единственный вход, на котором
// «кадр занят целиком» есть НАБЛЮДАЕМАЯ величина, а не следствие содержимого картинки.

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { decodeRgb, pngSize } from '../src/where.js';
import { makeTemplateFixture, readyRequest } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';

/** Два кадра: предмет — геометрия одного кадра, а не движение. */
const FRAMES = 2;
/** Измерено (`FIX-01`): рендер 2 кадров 1080×1920 на этой машине — 2–3 с. Запас ×100. */
const TIMEOUT = 300_000;

const realClock = (): (() => number) => () => performance.now();

/** Доли НЕЧЁРНЫХ пикселей по квадрантам: `[ЛВ, ПВ, ЛН, ПН]`, проценты с одним знаком. */
export function litSharesByQuadrant(
  rgb: Uint8Array,
  width: number,
  height: number,
): [number, number, number, number] {
  const lit = [0, 0, 0, 0];
  const all = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const k = (y * 2 < height ? 0 : 2) + (x * 2 < width ? 0 : 1);
      all[k] = (all[k] ?? 0) + 1;
      if ((rgb[i] ?? 0) !== 0 || (rgb[i + 1] ?? 0) !== 0 || (rgb[i + 2] ?? 0) !== 0) {
        lit[k] = (lit[k] ?? 0) + 1;
      }
    }
  }
  const pct = lit.map((v, k) => Math.round((v / (all[k] ?? 1)) * 1000) / 10);
  return [pct[0] ?? 0, pct[1] ?? 0, pct[2] ?? 0, pct[3] ?? 0];
}

interface Shot {
  readonly width: number;
  readonly height: number;
  readonly quadrants: readonly [number, number, number, number];
}

/** Один рендер сплошной заливки на заданном `scale` и разбор первого кадра. */
async function shoot(scale: number): Promise<Shot> {
  const fixture = makeTemplateFixture(
    [{ template: 'solid@1', params: { color: '#204080' }, z: 0 }],
    { frames: FRAMES, scale },
  );
  const request = await readyRequest(fixture.request, TEST_REGISTRY);
  const response = await renderSegment(request, {
    clock: realClock(),
    registry: TEST_REGISTRY,
    parentEnv: process.env,
    gate: { mode: 'skip', why: 'проба геометрии №182: гейт здесь не снимается' },
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
  const rgb = await decodeRgb(file);
  return { width: size.width, height: size.height, quadrants: litSharesByQuadrant(rgb, size.width, size.height) };
}

describe('**№182** — масштаб раскрывается ОДИН раз: кадр занят целиком', () => {
  it(
    '`scale: 0.5` — геометрия 540×960 и все четыре квадранта заполнены',
    async () => {
      const shot = await shoot(0.5);
      // Геометрия выхода — та, что объявлена профилем: `scale` из кадра не исчез, он
      // применён РОВНО ОДИН раз. Без этой половины ассерта «кадр заполнен» прошло бы и на
      // композиции, которая масштаб потеряла вовсе.
      expect([shot.width, shot.height]).toEqual([540, 960]);
      // Ровно то число, которое до правки читалось `100 / 0 / 0 / 0`.
      expect(shot.quadrants, `квадранты: ${shot.quadrants.join(' / ')}`).toEqual([100, 100, 100, 100]);
    },
    TIMEOUT,
  );

  it(
    '`scale: 1` — 1080×1920 и те же четыре сотни: полный профиль правкой не задет',
    async () => {
      const shot = await shoot(1);
      expect([shot.width, shot.height]).toEqual([1080, 1920]);
      expect(shot.quadrants, `квадранты: ${shot.quadrants.join(' / ')}`).toEqual([100, 100, 100, 100]);
    },
    TIMEOUT,
  );

  it('ОХРАННИК СРАБАТЫВАЕТ: прибор отличает заполненный кадр от сжатого в угол', () => {
    // Проба — та самая картинка, которую давал дефект: содержимое в левой верхней четверти.
    const w = 4;
    const h = 4;
    const squeezed = new Uint8Array(w * h * 3);
    for (let y = 0; y < h / 2; y++) {
      for (let x = 0; x < w / 2; x++) squeezed[(y * w + x) * 3] = 32;
    }
    expect(litSharesByQuadrant(squeezed, w, h)).toEqual([100, 0, 0, 0]);
    // И обратный контроль: сплошная заливка даёт четыре сотни, то есть прибор не всегда «0».
    expect(litSharesByQuadrant(new Uint8Array(w * h * 3).fill(32), w, h)).toEqual([100, 100, 100, 100]);
  });
});
