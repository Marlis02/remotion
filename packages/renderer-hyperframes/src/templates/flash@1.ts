// Реализация `flash@1` — короткая вспышка на дорожке `effect`. Спек:
// `templates-spec/src/templates/flash@1.ts`.
//
// **ОКНО БЕРЁТСЯ ИЗ `ctx.frames`, А НЕ ИЗ `params.durationSamples`** — и это не небрежность, а
// граница долга №119, названная спеком дословно: «Кто его читает — компилятор, и это `CP-06`,
// а не эта задача». Наблюдаемое следствие уже измерено (`CP-01`): запись несёт
// `durationSamples: 4800` (0.2 с), а клип получает 281 880 сэмплов (11.7 с) — до конца
// `sc:intro`. Пока `CP-06` не научил компилятор укорачивать клип, вспышка длится столько,
// сколько ей отвели окном. Перевести сэмплы в кадры здесь нечем: `sampleRate` в `ctx` нет и
// не будет — это величина авторского слоя (ADR-0003 T1), а не рендера.
//
// КРИВАЯ ПОЯВИЛАСЬ ЗДЕСЬ, КАК И ОБЕЩАЛ СПЕК: «Список наполнится там, где пишется код шаблона
// (`E-*`), — вместе с кривой». Выбрана `power3.out` — быстрый подъём и медленный спад, то
// есть форма затухания вспышки; `none` (линейная) дала бы равномерное угасание, которого
// вспышки не имеют. Имя добавлено в `easingIds` манифеста той же правкой: манифест обязан
// объявлять то, что шаблон использует, иначе объявление и поведение разъедутся молча.
//
// МЕТОД ПРОВЕРКИ ЧЛЕНСТВА — ТИП, А НЕ ПРОВЕРКА В РАНТАЙМЕ. `satisfies EasingId` закрывает
// кривую реестром **D5** на КОМПИЛЯЦИИ (`TS-02`, критерий готовности «кривая вне реестра —
// ошибка компиляции»). Юнит `test/templates.test.ts` дублирует это по тексту `mountSource` —
// там, где `tsc` уже не смотрит, потому что текст есть строка.
//
// БЕЛЫЙ ПОЛНОЭКРАННЫЙ СЛОЙ, СОБСТВЕННОЙ ГЕОМЕТРИИ НЕТ — ровно то, что записал спек в
// обосновании `msPerFrameBudget`: «твин прозрачности на полноэкранном слое».

import { canonicalJson } from '@vpe/core-model';
import type { EasingId } from '@vpe/templates-spec';

import type { RendererTemplate } from './index.js';

/**
 * Кривая затухания вспышки — членство в реестре **D5** закрыто типом.
 *
 * Та же строка стоит в `easingIds` манифеста спека. Два места — потому что пакеты разные
 * (**M6**: `templates-spec` не видит рендерера), и охранник сверки — юнит `templates.test.ts`:
 * каждый easing-литерал реализации обязан быть объявлен манифестом её спека.
 */
const FLASH_EASE = 'power3.out' as const satisfies EasingId;

/** Цвет вспышки. Белый — единственный, который ни один документ проекта не оспаривал. */
const FLASH_COLOR = '#ffffff';

const FLASH_MOUNT = `function (host, ctx) {
        var fill = document.createElement('div');
        fill.className = 'flash-fill';
        fill.style.position = 'absolute';
        fill.style.inset = '0';
        fill.style.background = ${canonicalJson(FLASH_COLOR)};
        fill.style.opacity = '0';
        host.appendChild(fill);

        // Сила — доля, а не проценты: схема спека держит целые проценты (точность, которой
        // никто не решал), CSS держит долю.
        var peak = ctx.params.strengthPct / 100;
        var at = ctx.toSeconds(ctx.frames.frameStart);
        var span = ctx.toSeconds(ctx.frames.frameEnd - ctx.frames.frameStart);

        ctx.timeline.fromTo(
          fill,
          {opacity: peak},
          {opacity: 0, duration: span, ease: ${canonicalJson(FLASH_EASE)}},
          at
        );
        // Полуоткрытый интервал T4: на кадре end вспышки уже нет. Твин к нулю приходит сам,
        // но явный set делает конец окна ВЫРАЖЕННЫМ, а не следствием арифметики кривой.
        ctx.timeline.set(fill, {opacity: 0}, ctx.toSeconds(ctx.frames.frameEnd));
      }`;

/** `flash@1` — реализация шаблона фикстуры; единственный, кто объявляет длительность. */
export const flash1Impl: RendererTemplate = Object.freeze({
  templateId: 'flash',
  templateVersion: 1,
  mountSource: FLASH_MOUNT,
});
