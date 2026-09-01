// **AC4 БЕЗ РЕНДЕРА** (`F-01`): разбор `vpe verify ac4`, чтение `framemd5` и правило шва.
//
// Браузера, диска и ffmpeg здесь нет ни в одном тесте: предмет — ФОРМА команды и три чистые
// функции, на которых стоит сверка. Живые прогоны лежат отдельно (`ac4-fixture.test.ts`,
// `ac4b-context.test.ts`), потому что стоят минут, а эти вопросы — миллисекунд.

import { describe, expect, it } from 'vitest';

import {
  AC4_GATE_SKIP_WHY,
  AC4_PROFILE_ID,
  CliError,
  EXIT,
  firstDifference,
  frameHashes,
  isGateProfile,
  parseArgv,
  seamMismatch,
} from '../src/index.js';

/** Отказ разбора: правило `argv` и код выхода 2 — «мы говорим на разных языках». */
function refusal(argv: readonly string[]): CliError {
  try {
    parseArgv(argv);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error(`ожидался отказ на: ${argv.join(' ')}`);
}

describe('`vpe verify ac4` — разбор', () => {
  it('полная форма разбирается во все поля', () => {
    expect(
      parseArgv([
        'verify',
        'ac4',
        '--project',
        '/tmp/p',
        '--profile',
        '/tmp/render.ac4.yaml',
        '--run-root',
        '/tmp/runs',
        '--store-dir',
        '/tmp/store',
        '--allow-tts',
        '--now',
        '2026-09-01T00:00:00.000Z',
      ]),
    ).toEqual({
      command: 'verify ac4',
      projectDir: '/tmp/p',
      profilePath: '/tmp/render.ac4.yaml',
      runRoot: '/tmp/runs',
      storeDir: '/tmp/store',
      allowTts: true,
      now: '2026-09-01T00:00:00.000Z',
    });
  });

  it('короткая форма: всё, кроме проекта, — умолчания проекта', () => {
    expect(parseArgv(['verify', 'ac4', '--project', '/tmp/p'])).toEqual({
      command: 'verify ac4',
      projectDir: '/tmp/p',
      profilePath: null,
      runRoot: null,
      storeDir: null,
      allowTts: false,
      now: null,
    });
  });

  it('`--project` обязателен: проверять нечего', () => {
    const error = refusal(['verify', 'ac4']);
    expect(error.rule).toBe('argv');
    expect(error.exitCode).toBe(EXIT.input);
    expect(error.message).toContain('`--project` обязателен');
  });

  it('подкоманда закрыта списком из одного имени', () => {
    expect(refusal(['verify', 'ac2']).message).toContain('Есть одна — `ac4`');
    expect(refusal(['verify']).message).toContain('Есть одна — `ac4`');
  });

  it('неизвестный флаг — отказ, а не игнор', () => {
    expect(refusal(['verify', 'ac4', '--project', '/tmp/p', '--full']).message).toContain(
      'неизвестный флаг `--full`',
    );
  });
});

describe('**`vpe build --profile ac4` НЕВЫРАЗИМ** — и отказ называет законный вход', () => {
  it('сборка на профиле AC4 одиночной командой не собирается', () => {
    const error = refusal(['build', '--project', '/tmp/p', '--profile', 'ac4']);
    expect(error.exitCode).toBe(EXIT.input);
    // Пара гейта — два имени, и третье не «опечатка», а неверное представление о профиле.
    expect(error.message).toContain('не профиль гейта');
    // Отказ обязан вести КУДА-ТО: иначе автор, которому нужен AC4, просто не найдёт входа.
    expect(error.message).toContain('vpe verify ac4');
    // И обязан называть цену обхода: сборка на этом профиле прошла бы мимо R12.
    expect(error.message).toContain('R12');
  });

  it('`ac4` — профиль сборки, но НЕ пара гейта', () => {
    expect(isGateProfile('final')).toBe(true);
    expect(isGateProfile('draftHalf')).toBe(true);
    expect(isGateProfile(AC4_PROFILE_ID)).toBe(false);
  });

  it('причина прохода мимо гейта — ТЕКСТ решения владельца, а не пустая строка', () => {
    // `mode: 'skip'` требует непустого `why` (ADR-0008), и это единственная защита от
    // «прохода по умолчанию»: причина обязана быть читаемой в выводе прогона.
    expect(AC4_GATE_SKIP_WHY.length).toBeGreaterThan(80);
    expect(AC4_GATE_SKIP_WHY).toContain('решение владельца 12');
    expect(AC4_GATE_SKIP_WHY).toContain('render.ac4.yaml');
  });
});

describe('`framemd5` — сравнивается ХЭШ кадра, а не строка (ADR-0007 §8)', () => {
  // Настоящие строки: `stream, dts, pts, duration, size, hash`. Взяты из вывода ffmpeg
  // 7.0.2 на сегменте `examples/ai-test-1` — форма не выдумана.
  const SEGMENT = [
    '0,          0,          0,        1,  3110400, 025f9cf6c81236fb0da234240342d04c',
    '0,          1,          1,        1,  3110400, f1005ac878d524633573345064a58bec',
  ];
  const IN_FINAL = [
    '0,        476,        476,        1,  3110400, 025f9cf6c81236fb0da234240342d04c',
    '0,        477,        477,        1,  3110400, f1005ac878d524633573345064a58bec',
  ];

  it('тот же кадр на другой шкале времени читается как ТОТ ЖЕ кадр', () => {
    // Ровно это и означает `-c copy`: сегмент начинается с `dts = 0`, в финале он стоит со
    // смещением. Сравнение строк целиком отвечало бы «шов сдвинул время», а спрашивают
    // другое — «декодировался ли тот же кадр».
    expect(frameHashes(SEGMENT)).toEqual(frameHashes(IN_FINAL));
    expect(frameHashes(SEGMENT)).toEqual([
      '025f9cf6c81236fb0da234240342d04c',
      'f1005ac878d524633573345064a58bec',
    ]);
  });

  it('различие КАРТИНКИ при той же шкале — расхождение', () => {
    const other = [SEGMENT[0] as string, '0,          1,          1,        1,  3110400, ffff5ac878d524633573345064a58bec'];
    expect(frameHashes(SEGMENT)).not.toEqual(frameHashes(other));
    expect(firstDifference(frameHashes(SEGMENT), frameHashes(other))).toBe(1);
  });

  it('равные списки — `null`; разная длина — индекс общей части', () => {
    expect(firstDifference(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(firstDifference(['a', 'b'], ['a'])).toBe(1);
    expect(firstDifference([], ['a'])).toBe(0);
  });
});

describe('шов `concat -c copy` — правило (долг SP-3 №5)', () => {
  it('склейка сегментов, совпавшая с финалом, — тишина', () => {
    expect(seamMismatch(['a', 'b', 'c'], [['a', 'b'], ['c']])).toBeNull();
  });

  it('перекодированный кадр на шве назван НОМЕРОМ, а не «не совпало»', () => {
    const message = seamMismatch(['a', 'b', 'x'], [['a', 'b'], ['c']]);
    expect(message).toContain('кадр 2');
    expect(message).toContain('ВТОРОЙ ЭНКОД');
    expect(message).toContain('ADR-0007 §8');
  });

  it('потерянный кадр — тоже расхождение, и оно называет обе длины', () => {
    const message = seamMismatch(['a', 'b'], [['a', 'b'], ['c']]);
    expect(message).toContain('ожидалось 3 кадров, в финале 2');
  });
});
