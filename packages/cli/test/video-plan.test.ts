// **РАЗВОРОТ `params` ШАБЛОНА `video@1` В ПЛАН СТАДИИ** (`VID-02a`, 2026-09-11). Без браузера
// и без ffmpeg: предмет — чистый перевод долей в пиксели и его согласие с браузерной половиной.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { videoRectAtFrame } from '@vpe/media';

import {
  VIDEO_DEFAULTS,
  videoFrameOfSecond,
  videoHolesOf,
  videoPlanOf,
  videoRectAt,
  videoRectOf,
  videoWindowRect,
  VideoPlanError,
  type VideoRectOut,
} from '../src/build-stages/video-plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPL = path.resolve(
  HERE,
  '../../renderer-hyperframes/src/templates/video@1/impl.ts',
);

/** Паспорт пробного видео: 24 fps, 157 кадров, 16:9 — ГОРИЗОНТАЛЬНОЕ, как в дефекте. */
const VIDEO = { fps: { num: 24, den: 1 }, frames: 157, width: 1920, height: 1080 };
const irOf = (clips: unknown[]): Parameters<typeof videoPlanOf>[0]['ir'] =>
  ({ segmentId: 'seg:x', segmentDurationInFrames: 30, clips, captions: [] }) as never;

const clip = (params: Record<string, unknown>, id = 'r:0001'): unknown => ({
  clipId: id,
  track: 'visual',
  z: 20,
  frames: { frameStart: 0, frameEnd: 30 },
  template: 'video@1',
  params,
  assets: [{ sha256: 'a'.repeat(64), role: 'video' }],
  fonts: [],
  seeds: {},
});

const planOf = (params: Record<string, unknown>, scale = 1): ReturnType<typeof videoPlanOf> =>
  videoPlanOf({
    ir: irOf([clip(params)]),
    width: 1080,
    height: 1920,
    scale,
    fps: { num: 30, den: 1 },
    videoOf: () => ({ path: '/store/clip.mp4', intrinsic: VIDEO }),
  });

describe('**ОКНО ДЕРЖИТ ПРОПОРЦИЮ ВИДЕО** — дефект `VID-02a`, увиденный владельцем', () => {
  // Прежний тест сверял ГРЕПОМ умолчания геометрии по обе стороны границы: браузер считал
  // прямоугольник сам, и разъезд двух наборов чисел дал бы дыру не там, где видео. Он снят
  // вместе с причиной: с `VID-02c` прямоугольник считает ОДИН разворот плана и присылает
  // браузеру готовым (`videoHolesOf`). Сверять стало нечего — сверяется результат.
  const source = readFileSync(IMPL, 'utf8');

  it.each(['DEFAULT_FRAME', 'DEFAULT_CORNER', 'DEFAULT_SIZE', 'DEFAULT_MARGIN'])(
    'в браузерной реализации НЕ ОСТАЛОСЬ константы `%s`',
    (name) => {
      expect(
        source.includes(`const ${name}`),
        `в \`impl.ts\` снова завелась константа \`${name}\`. Умолчания геометрии живут в ОДНОМ ` +
          'месте — `video-plan.ts`; второй набор разъедется с ним на первой правке, и увидеть ' +
          'это можно будет только глазами на готовом ролике',
      ).toBe(false);
    },
  );

  it('браузер ЧИТАЕТ прямоугольник, а не считает: план приезжает через `__VPE_MANIFEST`', () => {
    expect(source).toContain('__VPE_MANIFEST.videoHoles');
  });

  it('умолчания геометрии никуда не делись — они в `VIDEO_DEFAULTS` и ровно те же', () => {
    expect({ frame: VIDEO_DEFAULTS.frame, corner: VIDEO_DEFAULTS.corner }).toEqual({
      frame: 'full',
      corner: 'tr',
    });
    expect({ size: VIDEO_DEFAULTS.size, margin: VIDEO_DEFAULTS.margin }).toEqual({
      size: 0.34,
      margin: 0.05,
    });
  });
});

describe('`videoWindowRect` — таблица ожиданий на трёх пропорциях видео', () => {
  const W = 1080;
  const H = 1920;
  const spec = { frame: 'corner', corner: 'tr', size: 0.34, margin: 0.05 };
  // Ширина 1080·0.34 = 367.2 → 367 одна на все три строки: `size` — доля ШИРИНЫ кадра, и
  // смысл числа от файла не зависит. Меняется ровно высота, и она — пропорция ВИДЕО.
  it.each([
    ['16:9 (горизонтальное)', 1920 / 1080, 367, 206],
    ['9:16 (вертикальное)', 1080 / 1920, 367, 652],
    ['1:1 (квадрат)', 1, 367, 367],
  ])('%s -> окно %s x %s', (_name, aspect, width, height) => {
    const rect = videoWindowRect(spec, aspect as number, W, H);
    expect({ width: rect.width, height: rect.height }).toEqual({ width, height });
    // Правый верхний угол: отступ 1080·0.05 = 54 от правого и от верхнего края.
    expect({ x: rect.x, y: rect.y }).toEqual({ x: W - (width as number) - 54, y: 54 });
  });

  it('`fit` внутри окна врезки БОЛЬШЕ НИЧЕГО НЕ МЕНЯЕТ — пропорции совпали', () => {
    // Свойство названо вслух в шапке `videoWindowRect`: окно и видео одной формы, значит
    // `cover` нечего обрезать, а `contain` нечем дополнять. Прибор — равенство геометрий.
    const cover = videoRectOf({ frame: 'corner', fit: 'cover' }, 1920 / 1080, W, H);
    const contain = videoRectOf({ frame: 'corner', fit: 'contain' }, 1920 / 1080, W, H);
    expect(cover).toEqual(contain);
  });

  it('`frame: full` — весь кадр, и ни `size`, ни пропорция видео на него не влияют', () => {
    expect(videoRectOf({ frame: 'full', size: 0.5 }, 1920 / 1080, W, H)).toEqual({
      x: 0,
      y: 0,
      width: W,
      height: H,
    });
  });

  it('четыре угла отличаются РОВНО началом координат', () => {
    const size = { width: 367, height: 206 };
    const at = (corner: string): { x: number; y: number } => {
      const r = videoRectOf({ frame: 'corner', corner }, 1920 / 1080, W, H);
      expect({ width: r.width, height: r.height }).toEqual(size);
      return { x: r.x, y: r.y };
    };
    expect(at('tl')).toEqual({ x: 54, y: 54 });
    expect(at('tr')).toEqual({ x: 659, y: 54 });
    expect(at('bl')).toEqual({ x: 54, y: 1920 - 206 - 54 });
    expect(at('br')).toEqual({ x: 659, y: 1920 - 206 - 54 });
  });

  it('ОЧЕНЬ ВЫТЯНУТЫЙ ИСХОДНИК УЖИМАЕТСЯ ПО ВЫСОТЕ — окно не уезжает за кадр', () => {
    // 1:4 при `size: 0.6` дало бы высоту 648·4 = 2592 при кадре 1920, то есть окно за краем.
    // Высота ужимается до «кадр минус два отступа», ширина пересчитывается от неё, пропорция
    // видео остаётся точной, `size` становится верхней границей. Названо в шапке функции.
    const m = Math.round(W * 0.05);
    const rect = videoWindowRect({ ...spec, size: 0.6 }, 1 / 4, W, H);
    expect(rect.height).toBe(H - 2 * m);
    expect(rect.width).toBe(Math.round((H - 2 * m) / 4));
    expect(rect.y).toBe(m);
  });
});

describe('`videoRectAt` — переезд окна, пять кадров руками', () => {
  const geometry = {
    from: { x: 659, y: 54, width: 367, height: 206 },
    move: { startFrame: 10, durationFrames: 20, to: { x: 0, y: 0, width: 1080, height: 1920 } },
    radiusPx: 0,
  };

  it.each([
    [0, { x: 659, y: 54, width: 367, height: 206 }],
    [10, { x: 659, y: 54, width: 367, height: 206 }],
    // t = 5/20 = 0.25: 659·0.75 = 494.25 -> 494; 54·0.75 = 40.5 -> 41 (round к большему);
    // 367 + 713·0.25 = 545.25 -> 545; 206 + 1714·0.25 = 634.5 -> 635 (round к большему).
    [15, { x: 494, y: 41, width: 545, height: 635 }],
    [30, { x: 0, y: 0, width: 1080, height: 1920 }],
    [45, { x: 0, y: 0, width: 1080, height: 1920 }],
  ])('кадр %s', (frame, expected) => {
    expect(videoRectAt(geometry, frame as number)).toEqual(expected);
  });
});

describe('`videoHolesOf` — таблица ступеней для браузера', () => {
  const holesOf = (params: Record<string, unknown>): ReturnType<typeof videoHolesOf> =>
    videoHolesOf({
      ir: irOf([clip(params)]),
      width: 1080,
      height: 1920,
      scale: 1,
      fps: { num: 30, den: 1 },
      videoOf: () => ({ path: '/store/clip.mp4', intrinsic: VIDEO }),
    });

  it('неподвижное окно — РОВНО ОДНА ступень: цена покадровой дыры равна прежней статической', () => {
    const holes = holesOf({ asset: 'clip', frame: 'corner', corner: 'tr' });
    expect(holes).toHaveLength(1);
    expect(holes[0]?.steps).toHaveLength(1);
    expect(holes[0]?.steps[0]).toEqual({ frame: 0, x: 659, y: 54, width: 367, height: 206 });
    expect({ frameStart: holes[0]?.frameStart, frameEnd: holes[0]?.frameEnd }).toEqual({
      frameStart: 0,
      frameEnd: 30,
    });
  });

  it('**СТАДИЯ И РАНТАЙМ ДАЮТ ОДИН ПРЯМОУГОЛЬНИК** — пять кадров переезда', () => {
    const params = {
      asset: 'clip',
      frame: 'corner',
      corner: 'tr',
      // Переезд обязан УСПЕТЬ внутри окна клипа `[0, 30)`: вне окна дыры нет вовсе, и
      // сравнивать там нечего — таблица ступеней кончается вместе с окном.
      move: { startFrame: 5, durationFrames: 20, to: { frame: 'full' } },
    };
    const plan = planOf(params);
    const hole = holesOf(params)[0];
    expect(hole).toBeDefined();
    const runtimeAt = (n: number): VideoRectOut => {
      let found = hole?.steps[0] as VideoRectOut;
      for (const step of hole?.steps ?? []) if (step.frame <= n) found = step;
      return { x: found.x, y: found.y, width: found.width, height: found.height };
    };
    for (const n of [0, 5, 15, 25, 29]) {
      expect(runtimeAt(n), `кадр ${String(n)}`).toEqual(
        videoRectAtFrame(plan as NonNullable<typeof plan>, n),
      );
    }
  });

  it('`radius` доезжает до плана дыры в БАЗОВЫХ пикселях', () => {
    expect(holesOf({ asset: 'clip', frame: 'corner', radius: 24 })[0]?.radiusPx).toBe(24);
  });
});

describe('`videoPlanOf` — план сегмента', () => {
  it('сегмент БЕЗ `video@1` даёт `null`: стадия не зовётся вовсе, и цена её ноль', () => {
    const ir = irOf([{ ...(clip({}) as object), template: 'still@1' }]);
    expect(
      videoPlanOf({ ir, width: 1080, height: 1920, scale: 1, fps: { num: 30, den: 1 }, videoOf: () => undefined }),
    ).toBeNull();
  });

  it('`scale` профиля уменьшает И холст, И прямоугольник — иначе дыра разъедется вдвое', () => {
    const full = planOf({ asset: 'clip', frame: 'corner', corner: 'tr' }, 1);
    const half = planOf({ asset: 'clip', frame: 'corner', corner: 'tr' }, 0.5);
    expect([full?.width, full?.height]).toEqual([1080, 1920]);
    expect([half?.width, half?.height]).toEqual([540, 960]);
    // 16:9 в углу: ширина 367 -> 184 на половине, высота 206 -> 103 (пропорция ВИДЕО).
    expect(half?.rect).toEqual({ x: 330, y: 27, width: 184, height: 103 });
  });

  it('секунды паузы переводятся в кадры ВИДЕО округлением вниз', () => {
    expect(videoFrameOfSecond(2, { num: 24, den: 1 })).toBe(48);
    expect(videoFrameOfSecond(1.99, { num: 24, den: 1 })).toBe(47);
    expect(videoFrameOfSecond(0, { num: 24, den: 1 })).toBe(0);
  });

  it('умолчания доезжают до плана: `fit: cover`, чёрный фон, точка входа 0', () => {
    const p = planOf({ asset: 'clip' });
    expect(p?.fit).toBe('cover');
    expect(p?.background).toBe('#000000');
    expect(p?.inPointFrame).toBe(0);
  });

  it('**ДВА КЛИПА `video@1` В СЕГМЕНТЕ — ОТКАЗ**, называющий оба, а не первый попавшийся', () => {
    const ir = irOf([clip({ asset: 'clip' }, 'r:0001'), clip({ asset: 'clip' }, 'r:0002')]);
    expect(() =>
      videoPlanOf({
        ir,
        width: 1080,
        height: 1920,
        scale: 1,
        fps: { num: 30, den: 1 },
        videoOf: () => ({ path: '/store/clip.mp4', intrinsic: VIDEO }),
      }),
    ).toThrow(/r:0001, r:0002/u);
  });

  it('нет паспорта видео — отказ с адресом клипа, а не план на выдуманной частоте', () => {
    expect(() =>
      videoPlanOf({
        ir: irOf([clip({ asset: 'clip' })]),
        width: 1080,
        height: 1920,
        scale: 1,
        fps: { num: 30, den: 1 },
        videoOf: () => undefined,
      }),
    ).toThrow(VideoPlanError);
  });
});
