// Аргументы и окружение — ФУНКЦИЯ ПРОФИЛЕЙ. БЕЗ БРАУЗЕРА.
//
// Голден-вектор стоит на массиве ЦЕЛИКОМ (образец — `assemble-args.test.ts`, `M-04`): аргументы
// и есть то, что отделяет «профиль исполнен» от «рендерер решил сам». Проверка по одному
// флагу пропустила бы и лишний аргумент, и порядок.

import { describe, expect, it } from 'vitest';

import { renderArgs, renderEnv } from '../src/argv.js';
import { RenderAdapterError } from '../src/errors.js';

const base = {
  compositionDir: '/tmp/seg/composition',
  framesDir: '/tmp/seg/frames',
  fps: { num: 30, den: 1 },
  pixelProfile: { browserGpu: false, scale: 0.25, imageFormat: 'png' },
  executionProfile: { workers: 1, segmentTimeoutMs: 600_000 },
};

describe('`renderArgs` — голден-вектор на массив целиком', () => {
  it('профиль `ac4` (workers 1, без GPU) даёт ровно эту строку', () => {
    expect(renderArgs(base)).toEqual([
      'render',
      '/tmp/seg/composition',
      '-o',
      '/tmp/seg/frames',
      '--format',
      'png-sequence',
      '--fps',
      '30',
      '--workers',
      '1',
      '--no-browser-gpu',
      '--quiet',
    ]);
  });

  it('`workers` приходит ИЗ ПРОФИЛЯ, а не литералом — проверено ТРЕМЯ значениями', () => {
    // ИЗМЕРЕНО протоколом нарушений (`H-01`, Н6): проверка одним значением `4` (числом из
    // `render.final.yaml`) оставалась ЗЕЛЁНОЙ при подставленном литерале `'4'` — то есть
    // стерегла совпадение, а не источник. Три разных значения делают совпадение невозможным.
    for (const workers of [1, 2, 7]) {
      const args = renderArgs({ ...base, executionProfile: { workers, segmentTimeoutMs: 1 } });
      expect(args[args.indexOf('--workers') + 1]).toBe(String(workers));
    }
  });

  it('`browserGpu: true` ⇒ флага `--no-browser-gpu` НЕТ', () => {
    const args = renderArgs({
      ...base,
      pixelProfile: { ...base.pixelProfile, browserGpu: true },
    });
    expect(args).not.toContain('--no-browser-gpu');
    // И ничего вместо него не подставляется: `--browser-gpu` — путь по умолчанию рендерера.
    expect(args).not.toContain('--browser-gpu');
  });

  it('формат — всегда `png-sequence`; `mp4` не появляется ни при каком профиле (**R10**)', () => {
    for (const workers of [1, 2, 4]) {
      for (const browserGpu of [true, false]) {
        const args = renderArgs({
          ...base,
          pixelProfile: { ...base.pixelProfile, browserGpu },
          executionProfile: { workers, segmentTimeoutMs: 1 },
        });
        expect(args[args.indexOf('--format') + 1]).toBe('png-sequence');
        expect(args).not.toContain('mp4');
      }
    }
  });

  it('`scale` В АРГУМЕНТЫ НЕ УЕЗЖАЕТ: он раскрыт в геометрию композиции', () => {
    // ADR-0008: `--resolution` у HyperFrames умеет только целые множители ВВЕРХ, аналога
    // `scale: 0.5` нет (`FACT` SP-3c §6.2 п. 8) — поэтому масштаб живёт в `index.html`.
    const args = renderArgs(base).join(' ');
    expect(args).not.toContain('--resolution');
    expect(args).not.toContain('0.25');
  });

  it('дробная частота — ОТКАЗ, а не округление', () => {
    try {
      renderArgs({ ...base, fps: { num: 30_000, den: 1001 } });
      throw new Error('ожидался отказ по профилю');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderAdapterError);
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('ADR-0008 профиль');
      expect(e.problems[0]?.at).toBe('compileProfile.fps');
      expect(e.problems[0]?.message).toContain('R13');
    }
  });
});

describe('`renderEnv` — четыре `HYPERFRAMES_NO_*`, `TZ`, `LC_ALL`, пути ffmpeg', () => {
  const env = renderEnv({
    parentEnv: { PATH: '/usr/bin', TZ: 'Europe/Moscow', LC_ALL: 'ru_RU.UTF-8' },
    ffmpegPath: '/usr/local/bin/ffmpeg',
    ffprobePath: '/usr/local/bin/ffprobe',
  });

  it('глушит все четыре сетевых канала CLI вне рендера (`FACT` SP-3c §4)', () => {
    expect(env['HYPERFRAMES_NO_TELEMETRY']).toBe('1');
    expect(env['HYPERFRAMES_NO_UPDATE_CHECK']).toBe('1');
    expect(env['HYPERFRAMES_NO_FEEDBACK']).toBe('1');
    expect(env['HYPERFRAMES_SKIP_SKILLS']).toBe('1');
  });

  it('ПЕРЕБИВАЕТ локаль и зону родителя, а не наследует их', () => {
    expect(env['TZ']).toBe('UTC');
    expect(env['LC_ALL']).toBe('C');
  });

  it('ffmpeg передаётся ЗНАЧЕНИЕМ: ни `ffmpeg-static`, ни надежды на `PATH`', () => {
    expect(env['HYPERFRAMES_FFMPEG_PATH']).toBe('/usr/local/bin/ffmpeg');
    expect(env['HYPERFRAMES_FFPROBE_PATH']).toBe('/usr/local/bin/ffprobe');
  });

  it('остальное окружение родителя проезжает насквозь', () => {
    expect(env['PATH']).toBe('/usr/bin');
  });
});
