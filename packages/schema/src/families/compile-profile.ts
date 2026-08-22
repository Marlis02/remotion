// `compile-profile/1` — ЧАСТЬ ПРОИЗВЕДЕНИЯ (ADR-0006 §5). Только намерение человека,
// вычисляемых полей нет (M9, P10).
//
// НАХОДКА, ЗАПИСАННАЯ ЗДЕСЬ, А НЕ ЗАМОЛЧАННАЯ (`S-02`, 2026-08-22): поле
// `templateRegistryVersion` содержит в имени `version`, то есть **именной** тест K6
// («в схемах профилей нет полей версий/хэшей/checksum») на этом семействе покраснел бы.
// Правило K6 при этом НЕ нарушено: реестр шаблонов — намерение автора, а не измеренное
// окружение, и поле названо в ADR-0006 §5 поимённо, в колонке `compileProfile`. Поэтому
// K6-тест `R-02` оставлен как есть — на `render-profile/1`, — а не расширен с исключением.
// Разбор — `docs/impl/S-02/report.md`; решение о форме K6 за владельцем.

import { z } from 'zod';

import { FpsSchema } from './common.js';
import { identifier } from './marks.js';

/** Зона интерфейса YouTube Shorts, px. */
const SafeAreasSchema = z
  .object({
    top: z.int().nonnegative(),
    bottom: z.int().nonnegative(),
    left: z.int().nonnegative(),
    right: z.int().nonnegative(),
  })
  .strict();

const CaptionsSchema = z
  .object({
    tokensPerGroupMin: z.int().positive(),
    tokensPerGroupMax: z.int().positive(),
    // Группы не сдвигаются; минимум достигается числом токенов (M6, ADR-0003 «Субтитры»).
    minGroupDurationFrames: z.int().positive(),
  })
  .strict()
  .superRefine((captions, ctx) => {
    if (captions.tokensPerGroupMin > captions.tokensPerGroupMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['tokensPerGroupMax'],
        message: '`tokensPerGroupMax` не может быть меньше `tokensPerGroupMin`',
      });
    }
  });

export const CompileProfileSchema = z
  .object({
    schema: z.literal('compile-profile/1'),
    fps: FpsSchema,
    width: z.int().positive(),
    height: z.int().positive(),
    projectSampleRate: z.int().positive(),
    templateRegistryVersion: identifier(),
    safeAreas: SafeAreasSchema,
    // Дефолтная тишина движка (ADR-0003 T8, находка C4).
    defaultParagraphGapSamples: z.int().nonnegative(),
    // T8 — ИНВАРИАНТ КОРРЕКТНОСТИ, а не настройка: `defaultSceneGapSamples > 0`.
    // При нуле ни одна граница сцены не является кандидатом на разрез ⇒ один сегмент
    // на ролик, и вся сегментация перестаёт существовать молча.
    defaultSceneGapSamples: z.int().positive(),
    defaultChapterGapSamples: z.int().nonnegative(),
    // Слишком мелкие сегменты — оверхед старта Chrome (M10, ADR-0008 «Бюджет AC2»).
    minSegmentDurationFrames: z.int().positive(),
    // ADR-0003 T9 / PG-E1: Short длиннее минуты с claimed-музыкой теряет монетизацию.
    maxDurationFrames: z.int().positive(),
    captions: CaptionsSchema,
  })
  .strict();

export type CompileProfile = z.infer<typeof CompileProfileSchema>;
