// **РАЗВОРОТ `params` ШАБЛОНА `video@1` В ПЛАН СТАДИИ** (`VID-02a`, 2026-09-11). Без браузера
// и без ffmpeg: предмет — чистый перевод долей в пиксели и его согласие с браузерной половиной.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  VIDEO_DEFAULTS,
  videoFrameOfSecond,
  videoPlanOf,
  videoRectOf,
  VideoPlanError,
} from '../src/build-stages/video-plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPL = path.resolve(
  HERE,
  '../../renderer-hyperframes/src/templates/video@1/impl.ts',
);

const VIDEO = { fps: { num: 24, den: 1 }, frames: 157 };
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

describe('**УМОЛЧАНИЯ ОДНИ НА ДВЕ СТОРОНЫ ГРАНИЦЫ** — иначе дыра встанет не там, где видео', () => {
  // Браузерная реализация пробивает дыру по СВОИМ числам, стадия ffmpeg кладёт видео по
  // СВОИМ. Разъедься они — получится собравшийся ролик, выглядящий не так: окно в одном
  // месте, картинка в другом. Проверка идёт по ТЕКСТУ реализации, потому что её умолчания
  // живут внутри строки `mountSource` и импортировать их нечем (это код для браузера).
  const source = readFileSync(IMPL, 'utf8');

  it.each([
    ['frame', `'${VIDEO_DEFAULTS.frame}'`],
    ['corner', `'${VIDEO_DEFAULTS.corner}'`],
    ['size', String(VIDEO_DEFAULTS.size)],
    ['margin', String(VIDEO_DEFAULTS.margin)],
  ])('умолчание `%s` совпадает с реализацией', (name, value) => {
    const line = new RegExp(`DEFAULT_${name.toUpperCase()} = ${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')};`, 'u');
    expect(
      line.test(source),
      `в \`impl.ts\` нет строки \`const DEFAULT_${name.toUpperCase()} = ${value};\`. ` +
        'Умолчания геометрии обязаны совпадать по обе стороны границы: браузер пробивает дыру ' +
        'по своим числам, ffmpeg кладёт видео по своим',
    ).toBe(true);
  });
});

describe('`videoRectOf` — доли кадра в пиксели', () => {
  it('`frame: full` — весь кадр, и ручки угла на него не влияют', () => {
    expect(videoRectOf({ frame: 'full', size: 0.5 }, 1080, 1920)).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    });
  });

  it('`corner: tr` — правый верхний угол; ширина от `size`, высота по пропорциям КАДРА', () => {
    // 1080·0.34 = 367.2 → 367; высота 367·1920/1080 = 652.4 → 652; отступ 1080·0.05 = 54.
    expect(videoRectOf({ frame: 'corner', corner: 'tr' }, 1080, 1920)).toEqual({
      x: 1080 - 367 - 54,
      y: 54,
      width: 367,
      height: 652,
    });
  });

  it('четыре угла отличаются РОВНО началом координат', () => {
    const size = { width: 367, height: 652 };
    const at = (corner: string): { x: number; y: number } => {
      const r = videoRectOf({ frame: 'corner', corner }, 1080, 1920);
      expect({ width: r.width, height: r.height }).toEqual(size);
      return { x: r.x, y: r.y };
    };
    expect(at('tl')).toEqual({ x: 54, y: 54 });
    expect(at('tr')).toEqual({ x: 659, y: 54 });
    expect(at('bl')).toEqual({ x: 54, y: 1920 - 652 - 54 });
    expect(at('br')).toEqual({ x: 659, y: 1920 - 652 - 54 });
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
    expect(half?.rect).toEqual({ x: 330, y: 27, width: 184, height: 326 });
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
