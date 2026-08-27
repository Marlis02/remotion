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

import { z } from 'zod';

import type { TemplateManifest } from '../manifest.js';
import type { TemplateSpec } from '../spec.js';

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
  // Кривую шаблон не объявляет: ни один документ проекта её для `flash@1` не называет.
  // Список наполнится там, где пишется код шаблона (`E-*`), — вместе с кривой.
  easingIds: [],
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
  manifest,
};
