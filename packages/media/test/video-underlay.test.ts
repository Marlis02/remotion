// **ОТОБРАЖЕНИЕ КАДРОВ И ФОРМА ГРАФА СТАДИИ НИЖНЕГО СЛОЯ** (`VID-02a`, 2026-09-11).
//
// Браузера здесь нет и не нужно: предмет — ЧИСТЫЕ ФУНКЦИИ плана (`videoFrameOf`, `zoomAt`,
// `loopStepsOf`) и строка аргументов (`videoUnderlayArgs`). Тот же порядок, что у
// `segmentEncodeArgs`: аргументы строятся чистой функцией, поэтому «профиль исполнен
// дословно» проверяется без единого подпроцесса.
//
// **ОЖИДАЕМЫЕ ИНДЕКСЫ ПЕРЕЧИСЛЕНЫ РУКАМИ, А НЕ ПОСЧИТАНЫ ТОЙ ЖЕ ФОРМУЛОЙ.** Тест, считающий
// ожидание тем же выражением, что и предмет, зелен всегда и не проверяет ничего. Числа ниже
// выписаны из определения «24 → 30: каждый шестой кадр повторяется» вручную.

import { describe, expect, it } from 'vitest';

import {
  loopStepsOf,
  videoFrameOf,
  videoFrameTable,
  videoUnderlayArgs,
  zoomAt,
  type VideoUnderlayPlan,
} from '../src/assemble/video-underlay.js';

/** База плана: 30 кадров канала, видео 24 fps на 157 кадров, окно во весь сегмент. */
const BASE: VideoUnderlayPlan = {
  width: 1080,
  height: 1920,
  frameCount: 30,
  fps: { num: 30, den: 1 },
  videoPath: '/store/clip.mp4',
  videoFps: { num: 24, den: 1 },
  videoFrames: 157,
  inPointFrame: 0,
  frameStart: 0,
  frameEnd: 30,
  rect: { x: 0, y: 0, width: 1080, height: 1920 },
  move: null,
  radiusPx: 0,
  loop: false,
  fit: 'cover',
  background: '#000000',
  holds: [],
  zooms: [],
};

const plan = (patch: Partial<VideoUnderlayPlan>): VideoUnderlayPlan => ({ ...BASE, ...patch });

describe('`videoFrameOf` — отображение кадров сегмента в кадры видео', () => {
  it('24 → 30: кадры ПОВТОРЯЮТСЯ, и повтор приходится на каждый шестой', () => {
    // `floor(n · 24/30)` = `floor(n · 0.8)`. Выписано руками для первых тридцати кадров:
    // повторяются 4→4 (n=5,6 дают 4), 9 (n=11,12), 14, 19, 24 — то есть каждый шестой кадр
    // выходной последовательности показывает тот же кадр видео, что предыдущий.
    expect(videoFrameTable(plan({}))).toEqual([
      0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 12, 13, 14, 15, 16, 16, 17, 18, 19, 20,
      20, 21, 22, 23,
    ]);
  });

  it('`inPointFrame` сдвигает всю таблицу и НЕ меняет её шага', () => {
    const table = videoFrameTable(plan({ inPointFrame: 100 }));
    expect(table.slice(0, 8)).toEqual([100, 100, 101, 102, 103, 104, 104, 105]);
  });

  it('30 → 30: отображение тождественно, повторов нет вовсе', () => {
    expect(videoFrameTable(plan({ videoFps: { num: 30, den: 1 }, frameCount: 6 }))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('**конец видео раньше конца окна — держится ПОСЛЕДНИЙ кадр**, а не начинается заново', () => {
    // Видео из четырёх кадров при 24 fps: на 30 fps оно кончается на пятом кадре сегмента.
    const table = videoFrameTable(plan({ videoFrames: 4, frameCount: 10 }));
    expect(table).toEqual([0, 0, 1, 2, 3, 3, 3, 3, 3, 3]);
    // Зацикливание дало бы здесь `0, 0, 1, 2` во второй половине — и это ДРУГОЕ намерение.
    expect(table.slice(5)).not.toContain(0);
  });

  it('пауза замораживает кадр видео и съедает кадры СЕГМЕНТА', () => {
    // Пауза на кадре видео 4 (то есть на локальном кадре 5) длиной 4 кадра сегмента.
    const table = videoFrameTable(plan({ holds: [{ atVideoFrame: 4, durationFrames: 4 }] }));
    expect(table.slice(0, 14)).toEqual([0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 5, 6, 7]);
  });

  it('до начала окна показывается кадр точки входа: клип ещё не начался', () => {
    expect(videoFrameOf(plan({ frameStart: 10, inPointFrame: 7 }), 3)).toBe(7);
  });
});

describe('`zoomAt` — множитель наезда по кадру', () => {
  const zoomed = plan({
    zooms: [{ startFrame: 10, durationFrames: 10, from: 1, to: 2, centerX: 0.5, centerY: 0.5 }],
  });

  it('вне окна наезда — единица; в окне — линейно; после окна — конечное значение', () => {
    expect([0, 9, 10, 15, 20, 29].map((n) => zoomAt(zoomed, n))).toEqual([1, 1, 1, 1.5, 2, 2]);
  });
});

describe('`loopStepsOf` — паузы в шаги фильтра `loop`', () => {
  it('одна пауза: старт в локальных кадрах, счётчик на единицу меньше длины', () => {
    expect(loopStepsOf(plan({ holds: [{ atVideoFrame: 24, durationFrames: 12 }] }))).toEqual([
      { start: 30, count: 11 },
    ]);
  });

  it('две паузы: вторая сдвинута на длину первой — иначе они наложились бы', () => {
    expect(
      loopStepsOf(
        plan({
          holds: [
            { atVideoFrame: 24, durationFrames: 12 },
            { atVideoFrame: 48, durationFrames: 6 },
          ],
        }),
      ),
    ).toEqual([
      { start: 30, count: 11 },
      { start: 72, count: 5 },
    ]);
  });

  it('пауза нулевой длины шагом не становится: повторять нечего', () => {
    expect(loopStepsOf(plan({ holds: [{ atVideoFrame: 10, durationFrames: 0 }] }))).toEqual([]);
  });
});

describe('`videoUnderlayArgs` — форма графа', () => {
  const argsOf = (p: VideoUnderlayPlan): string[] =>
    videoUnderlayArgs({
      framesDirIn: '/tmp/in',
      framesDirOut: '/tmp/out',
      pattern: 'frame%06d.png',
      startNumber: 1,
      plan: p,
    });
  const filterOf = (p: VideoUnderlayPlan): string => {
    const args = argsOf(p);
    return args[args.indexOf('-filter_complex') + 1] ?? '';
  };

  it('пришпилено то, у чего есть зависящее от сборки умолчание', () => {
    const args = argsOf(plan({}));
    // Ресемплер и его округление; частота кадров браузера; режим частоты выхода.
    expect(args).toContain('-sws_flags');
    expect(args[args.indexOf('-sws_flags') + 1]).toBe('lanczos+accurate_rnd+full_chroma_int');
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough');
    // Выход — PNG без потерь: **R10** остаётся верным буквально, энкод по-прежнему ОДИН.
    expect(args[args.indexOf('-c:v') + 1]).toBe('png');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('rgba');
    // Число кадров — величина ПЛАНА, а не следствие поведения фильтров.
    expect(args[args.indexOf('-frames:v') + 1]).toBe('30');
  });

  it('**СИКА ПО ВРЕМЕНИ НЕТ НИ ОДНОГО**: точка входа берётся по кадрам', () => {
    const args = argsOf(plan({ inPointFrame: 42 }));
    expect(args).not.toContain('-ss');
    expect(filterOf(plan({ inPointFrame: 42 }))).toContain('trim=start_frame=42');
  });

  it('`cover` кадрирует, `contain` вписывает и красит поля цветом `bg`', () => {
    expect(filterOf(plan({}))).toContain('force_original_aspect_ratio=increase');
    const contain = filterOf(plan({ fit: 'contain', background: '#101020' }));
    expect(contain).toContain('force_original_aspect_ratio=decrease');
    expect(contain).toContain(':#101020');
  });

  it('нижний слой доводится до ПОЛНОГО кадра `pad`ом, а графика ложится поверх без смещения', () => {
    const filter = filterOf(plan({ rect: { x: 659, y: 54, width: 368, height: 652 } }));
    expect(filter).toContain('pad=1080:1920:659:54:color=0x00000000');
    expect(filter).toContain('overlay=x=0:y=0');
    // `shortest` обязателен: без него бесконечный вход даёт бесконечный выход (SP-VID).
    expect(filter).toContain('shortest=1');
  });

  it('суперсэмплинг ×2 включается ТОЛЬКО при наезде — за неподвижное видео платить незачем', () => {
    expect(filterOf(plan({}))).not.toContain('scale=2160:3840');
    const zoomFilter = filterOf(
      plan({
        zooms: [{ startFrame: 0, durationFrames: 10, from: 1, to: 2, centerX: 0.5, centerY: 0.5 }],
      }),
    );
    expect(zoomFilter).toContain('scale=2160:3840');
    expect(zoomFilter).toContain('eval=frame');
  });

  it('пауза даёт `loop` И перенумерацию времён: без неё выход короче плана на кадр', () => {
    const filter = filterOf(plan({ holds: [{ atVideoFrame: 24, durationFrames: 12 }] }));
    expect(filter).toContain('loop=loop=11:size=1:start=30');
    expect(filter).toContain('setpts=N/(30/1)/TB');
  });

  it('длина нижнего слоя отсекается ЧИСЛОМ плана, а не поведением фильтров', () => {
    expect(filterOf(plan({ frameCount: 113 }))).toContain('trim=end_frame=113');
  });

  it('план не числами — отказ с именем правила, а не тихий кадр', () => {
    expect(() => argsOf(plan({ frameCount: 0 }))).toThrow(/VID-02a форма плана/u);
    expect(() => argsOf(plan({ background: 'black' }))).toThrow(/rrggbb/u);
    expect(() => argsOf(plan({ videoFrames: 0 }))).toThrow(/videoFrames/u);
  });
});
