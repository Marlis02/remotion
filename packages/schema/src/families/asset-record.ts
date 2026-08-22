// `asset-record/1` — provenance по файлу на ассет (ADR-0005 §1, §9a, §9b).
// Формат — JSON (`assets/records/<sha256>.json`), а не YAML: файл пишет CLI.

import { z } from 'zod';

import { sha256Hex } from './common.js';
import { identifier } from './marks.js';

/**
 * Собственные свойства файла. Две ветки — по числу видов ассетов в фикстуре.
 *
 * ТРЕТЬЕЙ ВЕТКИ (шрифт) здесь НЕТ, и это записано, а не забыто: `fonts/records/` существует
 * пустым, формы записи шрифта нет ни в ADR-0005, ни в фикстуре. Она появится в `M-02`
 * («шрифт канала как ассет», V10) — вместе с первой настоящей записью, а не раньше.
 */
const IntrinsicSchema = z.union([
  z.object({ width: z.int().positive(), height: z.int().positive() }).strict(),
  z.object({ durationSamples: z.int().positive(), sampleRate: z.int().positive() }).strict(),
]);

/**
 * `status` — строка без списка допустимых значений, сознательно. Тот же довод, что у
 * `providerId` в P12: enum статусов прав протух бы раньше первого ролика, а юридическую
 * сторону закрывает `sourceSnapshot`, а не перечень.
 */
const WorkSchema = z
  .object({
    status: identifier(),
    note: z.string().optional(),
  })
  .strict();

const ReproductionSchema = z
  .object({
    status: identifier(),
    attributionRequired: z.boolean(),
    attributionText: z.string().optional(),
  })
  .strict();

const RecordingSchema = z
  .object({
    status: identifier(),
  })
  .strict();

const OriginSchema = z
  .object({
    sourceUrl: identifier().url().nullable(),
    retrievedAt: identifier(),
  })
  .strict();

/** Снимок страницы условий. `FACT` (r3 §3.4): страницы условий исчезают и меняются. */
const SourceSnapshotSchema = z
  .object({
    sha256: sha256Hex(),
    capturedAt: identifier(),
  })
  .strict();

/** ADR-0005 §9b: форма provenance AI-арта. Поля опциональны — обязательными их делает `A-01`. */
const GeneratorSchema = z
  .object({
    providerId: identifier(),
    modelId: identifier(),
    modelVersion: identifier(),
  })
  .strict();

const GenerationSchema = z
  .object({
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    seed: z.int(),
    parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    generatedAt: identifier(),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    // Раздельные статусы произведения / репродукции / записи — ADR-0005 §9a.
    work: WorkSchema,
    reproduction: ReproductionSchema,
    recording: RecordingSchema,
    origin: OriginSchema,
    sourceSnapshot: SourceSnapshotSchema.nullable(),
    c2paManifestBlob: sha256Hex().nullable(),
    generator: GeneratorSchema.optional(),
    generation: GenerationSchema.optional(),
  })
  .strict();

/** ADR-0005 §9b: цепочка прав тянется к референсу явно. */
const DerivedFromSchema = z
  .object({
    sha256: sha256Hex(),
    transform: z
      .object({
        op: identifier(),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        toolVersion: identifier(),
      })
      .strict(),
  })
  .strict();

export const AssetRecordSchema = z
  .object({
    schema: z.literal('asset-record/1'),
    sha256: sha256Hex(),
    kind: identifier(),
    intrinsic: IntrinsicSchema,
    // P11: `derivedFrom: null` — ЯВНОЕ УТВЕРЖДЕНИЕ, а не пропуск поля. Поэтому поле
    // обязательное и nullable, а не опциональное.
    derivedFrom: DerivedFromSchema.nullable(),
    provenance: ProvenanceSchema,
  })
  .strict();

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
