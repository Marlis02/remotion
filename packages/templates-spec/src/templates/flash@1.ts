// `flash@1` — короткая вспышка на дорожке `effect`.
//
// НОРМА `params` — `fixtures/minimal/direction/01-intro.yaml`, запись `7b20de44`:
// `strengthPct: 35`, `durationSamples: 4800` (0.2 с при 24 кГц).
//
// **ЗДЕСЬ ТОЛЬКО СХЕМА `durationSamples`, И ЭТО ГРАНИЦА ДОЛГА №119.** Долг говорит:
// «длительность клипа режиссуры без `until` берётся из области, а не из объявленного
// параметра шаблона», и наблюдаемое следствие измерено `CP-01`: `flash@1` несёт
// `durationSamples: 4800` (0.2 с), а клип получает 281 880 сэмплов (11.7 с) — до конца
// `sc:intro`. Контракт, которого не хватало, теперь есть: параметр объявлен и типизирован.
// **Кто его читает — компилятор, и это `CP-06`, а не эта задача.** Здесь нет ни строки,
// которая бы что-то делала с длительностью клипа: `templates-spec` Timeline не видит.
//
// ПОЧЕМУ `durationSamples`, А НЕ КАДРЫ. `Duration` абсолютна и разрешена (V1 запрещает
// абсолютную форму только у `kind: anchor`), а единица авторского слоя — сэмпл (ADR-0003 T1).
// Комментарий в самой фикстуре говорит ровно это.

import { asSamples, type Samples } from '@vpe/core-model';
import { z } from 'zod';

import type { EasingId } from '../easing.js';
import type { TemplateManifest } from '../manifest.js';
import type { TemplateSpec } from '../spec.js';

/**
 * Кривая затухания вспышки — членство в реестре **D5** закрыто ТИПОМ, на компиляции.
 *
 * `satisfies EasingId` — тот же приём, что у `kenburns@1` (`TS-02`): кривая вне реестра
 * становится ошибкой `tsc`, а не отказом в рантайме. В `params` она НЕ едет: автор её не
 * выбирает — форма затухания есть свойство эффекта, а не места, куда его поставили (ровно то
 * же рассуждение, по которому `declareDuration` есть только у этого шаблона).
 */
const FLASH_EASE = 'power3.out' as const satisfies EasingId;

const ParamsSchema = z
  .object({
    /** Сила вспышки в процентах. Целое: доли процента — точность, которой никто не решал. */
    strengthPct: z.int().positive().max(100),
    /**
     * Длительность вспышки в сэмплах — **положительное целое**.
     *
     * Ноль запрещён: вспышка нулевой длины не является вспышкой, а T4 («интервалы
     * полуоткрыты») пустых интервалов не знает.
     */
    durationSamples: z.int().positive(),
  })
  .strict();

/** Разобранные `params` шаблона `flash@1`. */
export type FlashParams = z.infer<typeof ParamsSchema>;

const manifest: TemplateManifest = {
  templateId: 'flash',
  templateVersion: 1,
  declaredAssets: [],
  declaredFonts: [],
  gates: [],
  // `INFERENCE`: твин прозрачности на полноэкранном слое, собственной геометрии нет.
  // Не измерялся ни одним спайком; заменяется измерением при `E-00`.
  msPerFrameBudget: 1,
  // ~~Кривую шаблон не объявляет: ни один документ проекта её для `flash@1` не называет.
  // Список наполнится там, где пишется код шаблона (`E-*`), — вместе с кривой.~~
  // *(изменено: `H-06`, 2026-08-29 — код шаблона написан, кривая появилась.)*
  //
  // `power3.out` — быстрый подъём и медленный спад, то есть форма ЗАТУХАНИЯ вспышки. `none`
  // (линейная) дала бы равномерное угасание, которого вспышки не имеют. Членство в реестре
  // **D5** закрыто типом на стороне реализации (`satisfies EasingId`,
  // `renderer-hyperframes/src/templates/flash@1.ts`); сверку «объявлено = использовано» ставит
  // юнит `renderer-hyperframes/test/templates.test.ts`: каждый easing-литерал реализации обязан
  // быть в `easingIds` её спека. Два места — потому что пакеты разные (**M6**: этот пакет
  // рендерера не видит), и без охранника они разъехались бы молча.
  easingIds: [FLASH_EASE],
  needsAudioFeatures: false,
  purposes: [],
};

/** `flash@1` — контракт шаблона фикстуры. */
export const flash1: TemplateSpec<FlashParams> = {
  templateId: 'flash',
  templateVersion: 1,
  paramsSchema: ParamsSchema,
  declareAssets: () => [],
  declareFonts: () => [],
  // ЕДИНСТВЕННЫЙ ИЗ ПЯТИ, КТО ОБЪЯВЛЯЕТ ДЛИТЕЛЬНОСТЬ (`CP-07`, долг №119). У `still@1`,
  // `kenburns@1`, `captionEmphasis@1` и `bed@1` длительность задаёт АВТОР (`until` либо
  // область), и метода у них нет вовсе — это различимо в контракте, а не выражено `null`.
  // Вспышка — наоборот: её длина есть свойство эффекта, а не места, куда его поставили.
  declareDuration: (params): Samples => asSamples(params.durationSamples),
  manifest,
};
