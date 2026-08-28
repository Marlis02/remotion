// Отпечаток на СИНТЕТИЧЕСКОЙ пробе — БЕЗ БИНАРЕЙ И БЕЗ БРАУЗЕРА.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ВООБЩЕ ВОЗМОЖЕН, И ЭТО КРИТЕРИЙ, А НЕ УДОБСТВО. У приёмки со стороны
// браузера нет: на её машине поля Chrome/ffmpeg уйдут в `absent`-ветку. Значит вычисление
// отпечатка обязано быть отделено от его сбора — иначе единственным способом проверить
// детерминизм ключа кэша был бы запуск Chrome, и охранник был бы зелёным ровно там, где
// его никто не гоняет.

import { describe, expect, it } from 'vitest';

import { RenderAdapterError } from '../src/errors.js';
import {
  assertEngineMatches,
  assertEngineProbeComplete,
  computeEngineFingerprint,
  formatEngineProbe,
  type EngineProbe,
  type ProbeValue,
} from '../src/fingerprint.js';

const present = (value: string): ProbeValue => ({ state: 'present', value });

/** Полная проба — то, на чём стоит вся арифметика этого файла. */
const full: EngineProbe = {
  probeVersion: 1,
  fields: {
    node: present('v25.6.1'),
    platform: present('linux'),
    arch: present('x64'),
    hostClass: present('local'),
    'pkg.gsap': present('3.15.0'),
    'pkg.hyperframes': present('0.8.5'),
    chrome: present('Google Chrome for Testing 152.0.7977.42'),
    ffmpeg: present('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers'),
    ffprobe: present('ffprobe version 6.1.1-3ubuntu5 Copyright (c) 2007-2023 the FFmpeg developers'),
    'launch.args': present('render -o --format png-sequence --quiet'),
    'launch.env': present(
      'HYPERFRAMES_NO_FEEDBACK=1 HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 ' +
        'HYPERFRAMES_SKIP_SKILLS=1 LC_ALL=C TZ=UTC',
    ),
  },
};

/** Проба с изменённым одним полем. */
function withField(probe: EngineProbe, key: string, value: ProbeValue): EngineProbe {
  return { ...probe, fields: { ...probe.fields, [key]: value } };
}

describe('`computeEngineFingerprint` — чистая функция пробы', () => {
  it('два вызова на ОДНОЙ пробе дают одну строку', () => {
    const a = computeEngineFingerprint(full);
    const b = computeEngineFingerprint(full);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.canonical).toBe(b.canonical);
  });

  it('строка — 64 строчных hex (`blake3` из `@vpe/core-model`, а не вторая реализация)', () => {
    expect(computeEngineFingerprint(full).fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('смена ЛЮБОГО поля даёт другую строку — по полю на утверждение', () => {
    const base = computeEngineFingerprint(full).fingerprint;
    const seen = new Set<string>([base]);
    for (const key of Object.keys(full.fields)) {
      const moved = computeEngineFingerprint(
        withField(full, key, present(`${String(full.fields[key])}-иначе-${key}`)),
      ).fingerprint;
      expect(moved, `поле \`${key}\` не двигает отпечаток`).not.toBe(base);
      // Ни одно поле не «съедается» другим: 11 полей — 11 разных строк плюс исходная.
      expect(seen.has(moved), `поле \`${key}\` дало уже встречавшуюся строку`).toBe(false);
      seen.add(moved);
    }
    expect(seen.size).toBe(Object.keys(full.fields).length + 1);
  });

  it('перестановка ключей пробы — ТА ЖЕ строка (каноничность, а не порядок вставки)', () => {
    const reversed: Record<string, ProbeValue> = {};
    for (const key of Object.keys(full.fields).reverse()) {
      const value = full.fields[key];
      if (value !== undefined) reversed[key] = value;
    }
    const shuffled: EngineProbe = { probeVersion: 1, fields: reversed };
    // Порядок вставки действительно другой — иначе тест стерёг бы пустое место.
    expect(Object.keys(shuffled.fields)).not.toEqual(Object.keys(full.fields));
    expect(computeEngineFingerprint(shuffled).fingerprint).toBe(
      computeEngineFingerprint(full).fingerprint,
    );
  });

  it('`probeVersion` входит в отпечаток: смена формы — смена строки', () => {
    const other = { ...full, probeVersion: 2 } as unknown as EngineProbe;
    expect(computeEngineFingerprint(other).fingerprint).not.toBe(
      computeEngineFingerprint(full).fingerprint,
    );
  });

  it('`absent` и `present` с тем же текстом — РАЗНЫЕ входы', () => {
    const asAbsent = withField(full, 'chrome', { state: 'absent', reason: 'нет' });
    const asPresent = withField(full, 'chrome', present('нет'));
    expect(computeEngineFingerprint(asAbsent).fingerprint).not.toBe(
      computeEngineFingerprint(asPresent).fingerprint,
    );
  });
});

describe('`absent`-Chrome: отпечаток СЧИТАЕТСЯ, сборка — НЕТ', () => {
  // Текст причины — ФИКСТУРА теста, а не продакшн-строка: проверяется, что причина ЛЮБОГО
  // поля доезжает до отказа. Формулировка обновлена `H-05fix` вслед за резолвером — прежняя
  // («`hyperframes browser path` не вернул пути») описывала механизм, которого больше нет.
  const noChrome = withField(full, 'chrome', {
    state: 'absent',
    reason: 'в `$HOME/.cache/hyperframes/chrome/chrome-headless-shell` нет установки браузера',
  });

  it('отпечаток на неполной пробе считается — иначе функцию нельзя проверить без браузера', () => {
    expect(computeEngineFingerprint(noChrome).fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('`assertEngineMatches` на ней ПАДАЕТ, даже если запись совпадает с фактом', () => {
    expect(() => {
      assertEngineMatches(noChrome, noChrome);
    }).toThrow(RenderAdapterError);
  });

  it('падение перечисляет ВСЕ неизмеренные поля и несёт причину каждого', () => {
    const nothing = withField(
      withField(noChrome, 'ffmpeg', { state: 'absent', reason: 'не найден по `PATH`' }),
      'ffprobe',
      { state: 'absent', reason: 'не найден по `PATH`' },
    );
    try {
      assertEngineProbeComplete(nothing);
      expect.unreachable('проба неполна — обязано было упасть');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R14');
      expect(e.problems.map((p) => p.at)).toEqual([
        'engineFingerprint.chrome',
        'engineFingerprint.ffmpeg',
        'engineFingerprint.ffprobe',
      ]);
      expect(e.problems[0]?.message).toContain('нет установки браузера');
      expect(e.problems[1]?.message).toContain('PATH');
    }
  });

  it('полная проба — тишина', () => {
    expect(() => {
      assertEngineProbeComplete(full);
    }).not.toThrow();
  });
});

describe('`assertEngineMatches` — R14 падением, а не предупреждением', () => {
  it('равенство — тишина', () => {
    expect(() => {
      assertEngineMatches(full, full);
    }).not.toThrow();
  });

  it('`recorded === null` — тишина: сверять не с чем, но полнота проверена', () => {
    expect(() => {
      assertEngineMatches(null, full);
    }).not.toThrow();
    expect(() => {
      assertEngineMatches(null, withField(full, 'chrome', { state: 'absent', reason: 'нет' }));
    }).toThrow(RenderAdapterError);
  });

  it('одно расхождение — падение с ИМЕНЕМ поля и обоими значениями', () => {
    const actual = withField(full, 'chrome', present('Google Chrome for Testing 152.0.7928.2'));
    try {
      assertEngineMatches(full, actual);
      expect.unreachable('версии Chrome разные — обязано было упасть');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R14');
      expect(e.problems).toHaveLength(1);
      expect(e.problems[0]?.at).toBe('engineFingerprint.chrome');
      expect(e.problems[0]?.message).toContain('152.0.7977.42');
      expect(e.problems[0]?.message).toContain('152.0.7928.2');
    }
  });

  it('расхождений несколько — в списке ВСЕ, а не первое', () => {
    const actual = withField(
      withField(full, 'pkg.gsap', present('3.16.0')),
      'ffmpeg',
      present('ffmpeg version 7.0.2-static'),
    );
    try {
      assertEngineMatches(full, actual);
      expect.unreachable('обязано было упасть');
    } catch (err) {
      expect((err as RenderAdapterError).problems.map((p) => p.at).sort()).toEqual([
        'engineFingerprint.ffmpeg',
        'engineFingerprint.pkg.gsap',
      ]);
    }
  });

  it('запись со СТАРЫМ (меньшим) набором полей — «состав изменился», а не тихое пересечение', () => {
    // Ровно тот случай, ради которого проверка отдельная: пересечение полей СОВПАДАЕТ.
    const older: EngineProbe = { probeVersion: 1, fields: { ...full.fields } };
    const trimmed = { ...older, fields: { ...older.fields } };
    delete (trimmed.fields as Record<string, ProbeValue>)['launch.env'];
    try {
      assertEngineMatches(trimmed, full);
      expect.unreachable('состав отпечатка изменился — обязано было упасть');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R14');
      expect(e.message).toContain('состав отпечатка изменился');
      expect(e.problems.map((p) => p.at)).toEqual(['engineFingerprint.launch.env']);
    }
  });

  it('в записи есть поле, которого больше нет в пробе, — тоже «состав изменился»', () => {
    const extra = withField(full, 'pkg.three', present('0.180.0'));
    try {
      assertEngineMatches(extra, full);
      expect.unreachable('обязано было упасть');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.message).toContain('состав отпечатка изменился');
      expect(e.problems.map((p) => p.at)).toEqual(['engineFingerprint.pkg.three']);
    }
  });

  it('другая `probeVersion` — отдельная ошибка формы, а не сравнение значений', () => {
    const older = { ...full, probeVersion: 0 } as unknown as EngineProbe;
    try {
      assertEngineMatches(older, full);
      expect.unreachable('обязано было упасть');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.problems.map((p) => p.at)).toEqual(['engineFingerprint.probeVersion']);
    }
  });
});

describe('`formatEngineProbe` — таблица для отчёта сборки', () => {
  it('перечисляет все поля в каноническом порядке и печатает причину отсутствия', () => {
    const dump = formatEngineProbe(
      withField(full, 'chrome', { state: 'absent', reason: 'браузер не скачан' }),
    );
    const rows = dump.split('\n');
    expect(rows[0]).toBe('probeVersion  1');
    expect(rows.slice(1).map((r) => r.split(/\s{2,}/u)[0])).toEqual(
      Object.keys(full.fields).sort(),
    );
    expect(dump).toContain('<нет: браузер не скачан>');
    expect(dump).toContain('6.1.1-3ubuntu5');
  });
});
