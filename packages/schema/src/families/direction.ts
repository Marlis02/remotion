// `direction/1` — режиссура (ADR-0002 §1: «вся параметрика живёт здесь; проза остаётся прозой»).

import { z } from 'zod';

import { AnchorPointSchema, JsonValueSchema } from './common.js';
import { identifier } from './marks.js';

/**
 * Имена треков. Шесть из ADR-0001 (`speech·music·sfx·caption·visual·effect`) плюс **седьмое,
 * директивное** — `voice` (ADR-0010 §3a-bis, решение владельца 1 RM1). Запись с `track: voice`
 * НЕ порождает клип Timeline: она питает SpeechPlan. Смешивать её со `speech` (дорожкой
 * Timeline, на которой лежат клипы PCM) нельзя — поэтому взято новое имя, а не перегружено
 * существующее.
 */
export const DIRECTION_TRACKS = ['speech', 'music', 'sfx', 'caption', 'visual', 'effect'] as const;

/** `recordId` — 4 случайных байта, выданные CLI; вход seed'а (ADR-0007 §1). */
const recordId = (): z.ZodString =>
  identifier().regex(/^[0-9a-f]{8}$/, '`recordId` — 4 случайных байта в hex: 8 строчных символов');

const baseFields = {
  recordId: recordId(),
  at: AnchorPointSchema,
  // `until` на scope-якоре означает его конец; по умолчанию — конец scope.
  until: AnchorPointSchema.optional(),
} as const;

/** Обычная запись: шаблон с параметрами на одной из шести дорожек Timeline. */
const TemplateRecordSchema = z
  .object({
    ...baseFields,
    track: z.enum(DIRECTION_TRACKS),
    z: z.int(),
    // Грамматику `templateId` (включая допустимый префикс `local:` — Charter V3) нормирует
    // манифест шаблона, задача `TS-01`. Здесь — идентификатор, и не больше.
    template: identifier(),
    // Параметры шаблона проверяет ЕГО манифест (`TS-01`), а не это семейство: вторая копия
    // каждого шаблонного контракта здесь разъехалась бы с первой в тот же день.
    params: z.record(z.string(), JsonValueSchema),
  })
  .strict();

/**
 * Директивная запись роли голоса — ADR-0010 §3a-bis. `voiceRole` **вместо** `template`/`params`,
 * и `z` у неё нет: z-order относится к слоям картинки, а эта запись картинки не порождает.
 */
const VoiceRecordSchema = z
  .object({
    ...baseFields,
    track: z.literal('voice'),
    voiceRole: identifier(),
  })
  .strict();

const RecordSchema = z.discriminatedUnion('track', [TemplateRecordSchema, VoiceRecordSchema]);

export const DirectionSchema = z
  .object({
    schema: z.literal('direction/1'),
    records: z.array(RecordSchema),
  })
  .strict();

export type Direction = z.infer<typeof DirectionSchema>;
