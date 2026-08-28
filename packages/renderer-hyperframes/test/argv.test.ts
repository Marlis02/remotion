// Аргументы и окружение — ФУНКЦИЯ ПРОФИЛЕЙ. БЕЗ БРАУЗЕРА.
//
// Голден-вектор стоит на массиве ЦЕЛИКОМ (образец — `assemble-args.test.ts`, `M-04`): аргументы
// и есть то, что отделяет «профиль исполнен» от «рендерер решил сам». Проверка по одному
// флагу пропустила бы и лишний аргумент, и порядок.

import { describe, expect, it } from 'vitest';

import { FIXED_RENDER_ARGS, FIXED_RENDER_ENV, renderArgs, renderEnv } from '../src/argv.js';
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

// ── H-03: фиксированная часть строки запуска — слагаемое `engineFingerprint` ──────────────
//
// Константы обязаны быть НЕ МЁРТВЫМИ и НЕ РАСХОДЯЩИМИСЯ с реальной строкой запуска. Иначе
// отпечаток нёс бы «наши флаги», которых рендерер не получает, — то есть измерял бы намерение
// автора константы, а не запуск. Проверяется в обе стороны: всё фиксированное присутствует в
// выводе, и в выводе нет фиксированных токенов сверх перечня.
describe('`FIXED_RENDER_ARGS`/`FIXED_RENDER_ENV` — вход отпечатка (`H-03`)', () => {
  it('все фиксированные токены присутствуют в реальном выводе `renderArgs`', () => {
    const args = renderArgs(base);
    for (const token of FIXED_RENDER_ARGS) expect(args).toContain(token);
  });

  it('строка запуска разлагается на ТРИ названные группы, и четвёртой нет', () => {
    // ИЗМЕРЕНИЕ по вычитанию: два входа, различающиеся ВСЕМИ профильными полями и путями.
    // Общее у них — это (1) наши пришпиленные значения и (2) ИМЕНА профильных флагов.
    // Разница — (3) значения профилей и пути машины. Тест держит границу между группами:
    // токен, переехавший из (3) в (1), — это профильное значение, уехавшее в отпечаток
    // (запрет M9), а переехавший из (1) в (3) — пришпиленное значение, выпавшее из ключа.
    const a = renderArgs(base);
    const b = renderArgs({
      compositionDir: '/other/composition',
      framesDir: '/other/frames',
      fps: { num: 60, den: 1 },
      pixelProfile: { browserGpu: true, scale: 1, imageFormat: 'png' },
      executionProfile: { workers: 9, segmentTimeoutMs: 1 },
    });
    /** Имена флагов, ЗНАЧЕНИЕ которых берётся из профиля. В отпечаток не входят вместе с ним. */
    const PROFILE_FLAG_NAMES = ['--fps', '--workers'];
    const common = a.filter((token) => b.includes(token)).sort();
    expect(common).toEqual([...FIXED_RENDER_ARGS, ...PROFILE_FLAG_NAMES].sort());

    // Группа (3) — ровно значения профилей и два пути, ни одного лишнего токена.
    const varying = a.filter((token) => !common.includes(token));
    expect(varying.sort()).toEqual(
      ['/tmp/seg/composition', '/tmp/seg/frames', '1', '30', '--no-browser-gpu'].sort(),
    );
  });

  it('`renderEnv` строится ИЗ `FIXED_RENDER_ENV`: разъехаться они не могут', () => {
    const env = renderEnv({ parentEnv: {}, ffmpegPath: '/a', ffprobePath: '/b' });
    for (const [key, value] of Object.entries(FIXED_RENDER_ENV)) expect(env[key]).toBe(value);
  });

  it('пути ffmpeg/ffprobe в фиксированную часть НЕ входят (машинный шум)', () => {
    expect(Object.keys(FIXED_RENDER_ENV)).not.toContain('HYPERFRAMES_FFMPEG_PATH');
    expect(Object.keys(FIXED_RENDER_ENV)).not.toContain('HYPERFRAMES_FFPROBE_PATH');
  });

  it('профильные флаги в фиксированную часть НЕ входят (M9 + K1)', () => {
    for (const flag of ['--fps', '--workers', '--no-browser-gpu']) {
      expect(FIXED_RENDER_ARGS).not.toContain(flag);
    }
  });
});
