// **Н4 `E-02`: ДАЛЬНИЙ СЛОЙ ЗАКРЫВАЕТ КАДР НА КРАЙНИХ КАДРАХ — И ЭТО ИЗМЕРЯЕТСЯ ПИКСЕЛЯМИ.**
//
// ═══ ТРЕБУЕТ БРАУЗЕРА И ffmpeg. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у соседних браузерных файлов (решение владельца `H-01`, §4 п. 2): тест
// либо зелёный, либо красный, но не «пропущен».
//
// ЧТО ЗА ПРАВИЛО. Слой, который едет на `drift` долей кадра, обязан всё ещё закрывать кадр
// целиком. Не закрывает — на краю появляется полоса фона (`#root` чёрный), и ролик собирается
// выглядящим не так: не отказ, не предупреждение, а тёмная кромка, которую замечают уже на
// телефоне. Правило держится ОДНИМ слагаемым в формуле покрытия
// (`1 + 2 * amplitude + COVER_MARGIN`), и слагаемое легко потерять правкой «дыхания».
//
// ПОЧЕМУ УГЛЫ, А НЕ КРАЯ. Угол — единственная точка, которую пропускают ОБА возможных промаха
// сразу: недобор по горизонтали (сдвиг) и недобор по вертикали (масштаб «дыхания» меньше
// единицы). Проба по середине левого края поймала бы первый и пропустила второй.
//
// ПОЧЕМУ ПЕРВЫЙ И ПОСЛЕДНИЙ КАДР. Ход идёт из `−travel` в `+travel`: на первом кадре открыт
// ПРАВЫЙ край, на последнем — ЛЕВЫЙ. Один кадр из двух проверял бы половину правила.
//
// **ОХРАННИК ДВУСТОРОННИЙ, И ВТОРАЯ СТОРОНА — САМО НАРУШЕНИЕ Н4.** Тот же запрос рендерится
// дважды: настоящей реализацией и её КОПИЕЙ БЕЗ ЗАПАСА (формула покрытия заменена на `1`,
// то есть «слой ровно в кадр»). Первая обязана дать непустые углы, вторая — чёрные. Без
// второй половины тест был бы зелёным и от того, что параллакс не двигается вовсе, — а
// проверка «кадры различны» ниже как раз стережёт этот же промах с другой стороны.
//
// **ПОЧЕМУ `scale: 1`, А НЕ ДЕШЁВЫЙ `0.25`.** Предмет измерения — полоса шириной в проценты
// кадра; на 270×480 она вырождается в единицы пикселей, и порог перестал бы отличать
// «непокрытый край» от сглаживания. Цена — три рендера по 6 кадров 1080×1920.

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { rendererTemplates, type RendererTemplateRegistry } from '../src/templates/index.js';
import { parallax251Impl } from '../src/templates/parallax25@1.js';
import { decodeRgb, pngSize } from '../src/where.js';
import { makeTemplateFixture, readyRequest } from './fixture.js';

const FRAMES = 6;
/** Измерено `E-07` на соседнем файле: одиночный рендер 3 кадров 1080×1920 — 2–3 с. Запас ×100. */
const TIMEOUT = 300_000;

const realClock = (): (() => number) => () => performance.now();

/**
 * `params` пробы — **ДРЕЙФ НА ПОТОЛКЕ СХЕМЫ** (`drift: 0.2`).
 *
 * Не «как в демо»: демо ходит на 0.05, и полоса непокрытия при промахе была бы там 54 px —
 * видимой, но близкой к сглаживанию. На потолке схемы промах даёт 90 px у дальнего слоя, то
 * есть величину, которую нельзя списать на округление. Порог теста от этого не зависит
 * (углы либо чёрные, либо нет), но РАЗМЕР нарушения обязан быть больше шума прибора.
 *
 * `scale: 1.04` — «дыхание» включено намеренно: оно второй вход в формулу покрытия
 * (`worstScale`), и проба без него мерила бы половину правила.
 */
const PROBE_PARAMS = {
  layers: ['street', 'street-figure'],
  drift: 0.2,
  depthSpread: 2.4,
  easing: 'power2.inOut',
  scale: 1.04,
} as const;

/** Сторона квадрата пробы в углу: 8 px — заведомо внутри полосы непокрытия (90 px). */
const CORNER = 8;

/**
 * Порог «угол не чёрный» — сумма трёх каналов.
 *
 * Числа входа известны: дальний слой непрозрачен целиком, и самый тёмный его пиксель, попавший
 * в угол кадра после `object-fit: cover`, даёт примерно (54, 40, 27) — сумма 121. Фон `#root`
 * — `#000`, сумма 0. Порог 60 лежит ровно посередине по логарифму и не подогнан ни под одно из
 * двух: вдвое ниже самого тёмного законного угла и вдвое выше любого следа сглаживания.
 */
const LIT = 60;
/** Порог «угол чёрный»: сглаживание кромки даёт единицы уровней, не десятки. */
const DARK = 30;

/** Средняя сумма каналов в квадрате `CORNER × CORNER` у каждого из четырёх углов. */
function cornersOf(rgb: Uint8Array, width: number, height: number): readonly number[] {
  const at = (x0: number, y0: number): number => {
    let sum = 0;
    for (let y = y0; y < y0 + CORNER; y++) {
      for (let x = x0; x < x0 + CORNER; x++) {
        const i = (y * width + x) * 3;
        sum += (rgb[i] ?? 0) + (rgb[i + 1] ?? 0) + (rgb[i + 2] ?? 0);
      }
    }
    return sum / (CORNER * CORNER);
  };
  return [
    at(0, 0),
    at(width - CORNER, 0),
    at(0, height - CORNER),
    at(width - CORNER, height - CORNER),
  ];
}

interface Probe {
  /** Углы ПЕРВОГО кадра окна и ПОСЛЕДНЕГО — четыре числа на кадр. */
  readonly first: readonly number[];
  readonly last: readonly number[];
  /** Кадры различны: параллакс действительно двигался, а не стоял. */
  readonly moved: boolean;
}

/** Один рендер параллакса на полном разрешении; реестр подаётся, чтобы подменить реализацию. */
async function measure(registry: RendererTemplateRegistry, why: string): Promise<Probe> {
  const fixture = makeTemplateFixture(
    [{ template: 'parallax25@1', params: PROBE_PARAMS, z: 10, withLayers: 2 }],
    { frames: FRAMES, scale: 1, workers: 1 },
  );
  const request = await readyRequest(fixture.request, registry);
  const response = await renderSegment(request, {
    clock: realClock(),
    registry,
    parentEnv: process.env,
    gate: { mode: 'skip', why },
  });
  if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);

  const names = readdirSync(response.frames.dir)
    .filter((n) => n.endsWith('.png'))
    .sort();
  const firstName = names[0];
  const lastName = names[names.length - 1];
  if (firstName === undefined || lastName === undefined) throw new Error('кадров на диске нет');

  const read = async (name: string): Promise<{ rgb: Buffer; w: number; h: number }> => {
    const file = path.join(response.frames.dir, name);
    const size = pngSize(file);
    if (size === null) throw new Error(`PNG не прочитан: ${file}`);
    return { rgb: await decodeRgb(file), w: size.width, h: size.height };
  };
  const a = await read(firstName);
  const b = await read(lastName);

  return {
    first: cornersOf(a.rgb, a.w, a.h),
    last: cornersOf(b.rgb, b.w, b.h),
    moved: !a.rgb.equals(b.rgb),
  };
}

/**
 * Реализация БЕЗ ЗАПАСА — нарушение Н4, собранное из настоящего текста заменой одной строки.
 *
 * Копия, а не отдельный «сломанный шаблон», написанный руками: рукописная копия разошлась бы с
 * оригиналом на первой же правке, и «нарушение» перестало бы быть нарушением ИМЕННО ЭТОГО
 * правила. Замена проверяется на попадание — иначе тест ниже был бы зелёным, меряя настоящую
 * реализацию дважды.
 */
const COVER_LINE = 'var cover = (1 + 2 * amplitude + 0.02) / worstScale * extraZoom;';
const BROKEN_LINE = 'var cover = 1 * extraZoom;';

function brokenRegistry(): RendererTemplateRegistry {
  const source = parallax251Impl.mountSource;
  if (!source.includes(COVER_LINE)) {
    throw new Error(
      `формула покрытия в реализации не найдена дословно (\`${COVER_LINE}\`). Проба Н4 ` +
        'собирается ЗАМЕНОЙ строки настоящего текста; не найдя её, она рендерила бы ' +
        'настоящую реализацию дважды и была бы зелёной ни о чём',
    );
  }
  return {
    version: rendererTemplates.version,
    templates: [{ ...parallax251Impl, mountSource: source.replace(COVER_LINE, BROKEN_LINE) }],
  };
}

describe('**Н4** `E-02` — запас покрытия: углы крайних кадров непусты', () => {
  it(
    'штатная реализация закрывает углы, копия без запаса — нет, и кадры при этом движутся',
    async () => {
      const ok = await measure(rendererTemplates, 'проба Н4 `E-02`: покрытие кадра слоями');
      const bad = await measure(brokenRegistry(), 'проба Н4 `E-02`: та же сцена БЕЗ запаса');

      const show = (p: Probe, name: string): string =>
        `${name}: первый ${p.first.map((v) => v.toFixed(1)).join('/')}, ` +
        `последний ${p.last.map((v) => v.toFixed(1)).join('/')}, движение ${String(p.moved)}`;
      const where = `${show(ok, 'штатная')}; ${show(bad, 'без запаса')}`;
      // Печать — та же, что у живого гейта: числа прибора обязаны быть видны автору шаблона,
      // а не только в тексте упавшего ассерта. Из неё же берутся величины отчёта.
      console.log(`\n=== Н4 · покрытие кадра ===\n${where}`);

      // 0. МЕРИЛИ НЕ СТОЯЧУЮ КАРТИНКУ. Без движения запас не нужен вовсе, и утверждение 1
      //    стало бы зелёным ни о чём — ровно ложно-зелёный долга №164.
      expect(ok.moved, where).toBe(true);
      expect(bad.moved, where).toBe(true);

      // 1. ШТАТНАЯ РЕАЛИЗАЦИЯ: ВОСЕМЬ УГЛОВ ИЗ ВОСЬМИ ЗАКРЫТЫ.
      for (const value of [...ok.first, ...ok.last]) {
        expect(value, where).toBeGreaterThan(LIT);
      }

      // 2. НАРУШЕНИЕ Н4: без запаса хотя бы один угол на каждом из крайних кадров — ЧЁРНЫЙ.
      //    «Хотя бы один», а не «все четыре»: сдвиг открывает ОДИН край, а какой именно —
      //    свойство знака, а не правила. Требовать все четыре значило бы описать промах, а не
      //    правило, и тест сломался бы от смены направления хода.
      expect(Math.min(...bad.first), where).toBeLessThan(DARK);
      expect(Math.min(...bad.last), where).toBeLessThan(DARK);
    },
    TIMEOUT,
  );
});
