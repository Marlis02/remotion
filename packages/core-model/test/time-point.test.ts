// `C-01` — `TimePoint` / `Duration` (ADR-0001, «Типы времени в авторском слое»).
//
// ЗДЕСЬ ЖИВУТ ТИП-ТЕСТЫ. Они проверяются НЕ на прогоне, а на `pnpm typecheck`: если форма
// в `@vpe/schema` разъедется с формой в модели, красным станет сборка, а не тест. Ради этого
// `packages/core-model/tsconfig.json` включает каталог `test/` (тот же приём, что в `schema`).
// Рантайм-утверждения ниже нужны, чтобы факт проверки был виден в отчёте прогона.

import { asSamples, asSha256, type CompileProfile, type Direction } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import {
  TimeModelError,
  assertRealizable,
  type Duration,
  type Fps,
  type TimePoint,
} from '../src/index.js';

/** `true`, если `A` присваивается в `B`; иначе `never` — и объявление ниже не компилируется. */
type Assignable<A, B> = [A] extends [B] ? true : never;

/** Форма `at`/`until` в семействе `direction/1` — вариант `anchor` без `nudgeSamples`. */
type AnchorPointFromSchema = Direction['records'][number]['at'];

// Схема сужена намеренно (Charter V1: «только якорь»), но обязана оставаться ПОДМНОЖЕСТВОМ
// суммы ADR-0001. Иначе компилятор молча пропустит два разных представления одной величины.
const schemaAnchorIsTimePoint: Assignable<AnchorPointFromSchema, TimePoint> = true;

// `fps` модели и `fps` профиля — одна и та же величина; вторая копия формы разъехалась бы
// с первой в тот же день (та же причина, по которой `direction/1 → params` не дублирует
// контракты шаблонов, `S-02` §3).
const profileFpsIsModelFps: Assignable<CompileProfile['fps'], Fps> = true;
const modelFpsIsProfileFps: Assignable<Fps, CompileProfile['fps']> = true;

const ASSET = asSha256('a'.repeat(64));

describe('ADR-0001 — формы типов совпадают со схемой, а не дублируют её иначе', () => {
  it('`direction/1 → at` присваивается в `TimePoint`', () => {
    expect(schemaAnchorIsTimePoint).toBe(true);
    // И то же самое значением, а не только типом.
    const fromSchema: AnchorPointFromSchema = { kind: 'anchor', anchor: 'b:reveal' };
    const asTimePoint: TimePoint = fromSchema;
    expect(asTimePoint.kind).toBe('anchor');
  });

  it('`compile-profile/1 → fps` и `Fps` модели — один и тот же тип в обе стороны', () => {
    expect(profileFpsIsModelFps).toBe(true);
    expect(modelFpsIsProfileFps).toBe(true);
  });
});

describe('ADR-0001 — три варианта `TimePoint`, `Duration`, отказ от `gridPoint`', () => {
  it('вариант `anchor`: абсолютной формы нет, есть только поправка', () => {
    const bare: TimePoint = { kind: 'anchor', anchor: 'b:reveal' };
    const nudged: TimePoint = { kind: 'anchor', anchor: 'sc:intro', nudgeSamples: asSamples(2880) };
    expect(() => { assertRealizable(bare); }).not.toThrow();
    expect(() => { assertRealizable(nudged); }).not.toThrow();
  });

  it('вариант `mediaTime`: абсолютен и разрешён (in-point музыки)', () => {
    const point: TimePoint = { kind: 'mediaTime', asset: ASSET, offsetSamples: asSamples(48000) };
    expect(() => { assertRealizable(point); }).not.toThrow();
  });

  it('вариант `gridPoint` отвергается с сообщением про v1', () => {
    const point: TimePoint = { kind: 'gridPoint', asset: ASSET, gridId: 'beats', index: 7 };
    expect(() => { assertRealizable(point); }).toThrow(TimeModelError);
    expect(() => { assertRealizable(point); }).toThrow(/сетки ассетов не реализованы в v1/);
    expect(() => { assertRealizable(point); }).toThrow(/beats/);
    let caught: unknown;
    try {
      assertRealizable(point);
    } catch (error) {
      caught = error;
    }
    expect((caught as TimeModelError).rule).toBe('ADR-0001 gridPoint');
  });

  it('`assertRealizable` СУЖАЕТ тип, а не только бросает', () => {
    // После ассерта в типе остаются ровно два варианта, поэтому ветка `else` обращается
    // к `offsetSamples` без проверки на `gridPoint` — и это компилируется.
    // Параметр функции, а не `const`: у константы поток управления и так знает вариант.
    const describe_ = (point: TimePoint): string => {
      assertRealizable(point);
      return point.kind === 'anchor' ? point.anchor : String(point.offsetSamples);
    };
    expect(describe_({ kind: 'anchor', anchor: 'b:reveal' })).toBe('b:reveal');
    expect(describe_({ kind: 'mediaTime', asset: ASSET, offsetSamples: asSamples(96000) })).toBe('96000');
    expect(() => describe_({ kind: 'gridPoint', asset: ASSET, gridId: 'beats', index: 1 })).toThrow(
      /не реализованы в v1/,
    );
  });

  it('`Duration` — сэмплы, и только они', () => {
    const fade: Duration = { samples: asSamples(720) };
    expect(fade.samples).toBe(720);
  });

  it('в API нет секунд: ни одно имя публичной поверхности их не называет', async () => {
    const surface = Object.keys((await import('../src/index.js')) as Record<string, unknown>);
    const offenders = surface.filter((name) => /second|seconds|Seconds|toSec|inSec/.test(name));
    expect(offenders, 'ADR-0003 T1: секунды не хранятся нигде и в API не появляются').toEqual([]);
    expect(surface).toContain('msToSamples');
  });
});
