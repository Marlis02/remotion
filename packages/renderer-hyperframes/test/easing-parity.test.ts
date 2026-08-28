// **D5** — соответствие ИМЕНИ и КРИВОЙ. Юнит-тест, БРАУЗЕР НЕ НУЖЕН.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ ВООБЩЕ. Реестр easing (`templates-spec/src/easing.ts`) — данные: шесть
// СТРОК. Строка сама по себе ничего не обещает: `'power2.inOut'` в реестре и `power2.inOut`,
// который умеет `gsap`, — два разных факта, и второй проверить из `templates-spec` нельзя
// (`gsap` ему недоступен, **M6**). Проверяется он здесь — в единственном пакете, которому
// `gsap` виден, и по стрелке `renderer-hyperframes → templates-spec` карты ADR-0009.
//
// ПОЧЕМУ БЕЗ БРАУЗЕРА. `gsap.parseEase` — чистая функция Node-стороны: она возвращает
// `f(t) → значение`, никакого DOM не трогая. Тот же `gsap@3.15.0`, который материализация
// кладёт в композицию `vendor/gsap.min.js`, здесь импортируется как модуль — это ОДНА
// зависимость пакета, а не вторая копия библиотеки.
//
// ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ ДЛЯ `TS-02`. `INFERENCE`, записанный в
// `fixtures/minimal/direction/01-intro.yaml` решением RM2: «cubic in-out у GSAP называется
// `power2.inOut` (`power1` = quad, `power2` = cubic)». Roadmap §4.8: «сессия `TS-02` ОБЯЗАНА
// проверить это соответствие при заведении реестра — если оно окажется неверным, правится
// фикстура, а не реестр». Проверено; фикстура правки не потребовала.

import { gsap } from 'gsap';
import { describe, expect, it } from 'vitest';

import { EASING_REGISTRY } from '@vpe/templates-spec';

/**
 * Сетка сравнения — одиннадцать точек, `0, 0.1, …, 1.0`.
 *
 * Строится делением целых на 10, а не накоплением `t += 0.1`: накопление даёт `0.7999…` на
 * восьмом шаге, и тест сравнивал бы кривые в точках, которых сам не называл.
 */
const GRID = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * Допуск — **1e-12**, и число выбрано измерением, а не «на глаз».
 *
 * СВЕРХУ его прижимает шум: расхождение `parseEase('power2.inOut')` с формулой ниже на этой
 * сетке — **1.39e-17**, то есть последний бит double. Обе стороны считают ОДИН многочлен, но
 * в разном порядке умножений, и разойтись сильнее они не могут.
 *
 * СНИЗУ его держит соседняя кривая: `power1.inOut` (quad) отличается от cubic на этой же
 * сетке на **0.072** — на десять порядков больше допуска. То есть 1e-12 не различает
 * округления и уверенно различает КРИВЫЕ: подмена идентификатора соседним именем красит тест,
 * а смена версии Node — нет. Последнее утверждение этого файла проверяет само это свойство,
 * чтобы допуск не оказался «зелёным на всём».
 */
const TOLERANCE = 1e-12;

/**
 * Cubic in-out — `t < 0.5 ? 4t³ : 1 − (−2t+2)³/2`.
 *
 * Записана умножениями, без `Math.pow`: **D5** запрещает его в рендер-пути ровно потому, что
 * ECMA-262 объявляет `pow` implementation-approximated, и эталон, посчитанный им, был бы
 * эталоном с той же неопределённостью, что и проверяемое.
 */
function cubicInOut(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/** Максимум |a − b| по сетке — число, которое можно назвать в отчёте. */
function maxDeviation(a: (t: number) => number, b: (t: number) => number): number {
  return Math.max(...GRID.map((t) => Math.abs(a(t) - b(t))));
}

describe('**D5** — реестр easing разбирается тем самым `gsap`, что уходит в композицию', () => {
  it('все шесть кривых реестра РАЗБИРАЮТСЯ `parseEase`', () => {
    // Список берётся из `templates-spec` импортом, а не переписывается сюда: вторая копия
    // реестра — ровно та беда, ради которой реестр заведён одним файлом.
    expect(EASING_REGISTRY).toHaveLength(6);
    const unparsed = EASING_REGISTRY.filter((id) => typeof gsap.parseEase(id) !== 'function');
    expect(
      unparsed,
      'Имя из закрытого реестра **D5**, которого не знает `gsap@3.15.0`. Реестр называет ' +
        'кривые ПО ИМЕНИ РЕНДЕРЕРА (`FACT` SP-3c §6.2 п. 1), поэтому имя, которое рендерер не ' +
        'разбирает, — это не «опечатка в данных», а кривая, которой не существует.',
    ).toEqual([]);
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: чужое имя даёт `undefined`, а не функцию', () => {
    // Поправка владельца П3. Без этой строки проверка `typeof === 'function'` выше не показана
    // РАЗЛИЧАЮЩЕЙ: она была бы зелёной и в мире, где `parseEase` возвращает что-нибудь на
    // любую строку. ИЗМЕРЕНО: возвращает именно `undefined` и НЕ бросает.
    expect(typeof gsap.parseEase('bogus.nope')).toBe('undefined');
    // И то же самое про `spring`: в `gsap@3.15.0` такой кривой нет вовсе — запрет D5 на
    // пружину и отсутствие имени в реестре сходятся с поведением библиотеки, а не спорят с ним.
    expect(typeof gsap.parseEase('spring')).toBe('undefined');
  });

  it('`power2.inOut` ЕСТЬ cubic in-out — `INFERENCE` RM2 проверен и стал `FACT`', () => {
    const parsed = gsap.parseEase('power2.inOut');
    expect(typeof parsed).toBe('function');
    const deviation = maxDeviation(parsed, cubicInOut);
    expect(
      deviation,
      `Кривая \`power2.inOut\` разошлась с cubic in-out на ${String(deviation)} — больше ` +
        `допуска ${String(TOLERANCE)}. Это тот случай, о котором roadmap §4.8 говорит: ` +
        '«если соответствие окажется неверным, правится ФИКСТУРА, а не реестр» ' +
        '(`fixtures/minimal/direction/01-intro.yaml`, `easing: "power2.inOut"`).',
    ).toBeLessThan(TOLERANCE);
  });

  it('`none` — тождественная: `f(t) = t` на всей сетке', () => {
    const none = gsap.parseEase('none');
    expect(typeof none).toBe('function');
    expect(maxDeviation(none, (t) => t)).toBeLessThan(TOLERANCE);
  });

  it('допуск РАЗЛИЧАЮЩИЙ: соседнее имя реестра красит ту же проверку', () => {
    // `power1` = quad, `power2` = cubic — половина того самого `INFERENCE`. Если бы допуск был
    // выбран «с запасом побольше», проверка выше стала бы зелёной на подменённом
    // идентификаторе, то есть перестала бы что-либо стеречь (протокол нарушений Н3).
    const quad = gsap.parseEase('power1.inOut');
    const distance = maxDeviation(quad, cubicInOut);
    expect(distance).toBeGreaterThan(0.05);
    expect(distance / TOLERANCE).toBeGreaterThan(1e9);
  });
});
