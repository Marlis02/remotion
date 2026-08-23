// `asset-record/1` — provenance по файлу на ассет (ADR-0005 §1, §9a, §9b).
// Формат — JSON (`assets/records/<sha256>.json`), а не YAML: файл пишет CLI.

import { z } from 'zod';

import { sha256Hex } from './common.js';
import { identifier } from './marks.js';

/**
 * Форматы шрифта, которые умеет встроить компилятор.
 *
 * ПЕРЕЧЕНЬ, А НЕ СВОБОДНАЯ СТРОКА — в отличие от `status` и `providerId` рядом, и причина
 * обратная их причине. `FACT` (SP-3c §4): компилятор встраивает локальный шрифт `data URI`
 * ДО запуска браузера, а байты приходят из CAS **без имени файла** (`.store/ab/cd/<sha256>`)
 * — MIME-тип брать больше неоткуда, кроме этого поля. Незнакомое значение здесь не «новый
 * законный вход», как незнакомый провайдер, а молча битый `data URI` в готовом ролике.
 */
const FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2'] as const;

/** Та же пометка идентификатора, что у `identifier()`: enum сам по себе её не несёт (P17). */
const fontFormat = (): z.ZodEnum<Record<(typeof FONT_FORMATS)[number], (typeof FONT_FORMATS)[number]>> =>
  z.enum(FONT_FORMATS).meta({ vpeIdentifier: true });

/**
 * Собственные свойства файла. Три ветки — по числу видов ассетов в фикстуре: изображение,
 * звук, шрифт.
 *
 * ТРЕТЬЯ ВЕТКА ПОЯВИЛАСЬ В `M-02` («шрифт канала как ассет», V10, решение владельца 4),
 * вместе с первой настоящей записью `fonts/records/<sha256>.json` — как и было обещано на
 * этом месте. Состав полей минимален и каждое поле отвечает на свой вопрос:
 *
 * * `family` + `subfamily` (`name`-таблица, nameID 1 и 2) — чем шрифт зовётся. Без второго
 *   поля запись не отличает Bold от Regular ничем, кроме sha, а «DejaVu Sans **Bold**»
 *   обязано быть записано словами: выбор шрифта канала — `UNKNOWN` за владельцем
 *   (`docs/DEBTS.md` №13), и молчаливым он стать не должен;
 * * `format` — см. `FONT_FORMATS` выше;
 * * `fsType` (`OS/2`) — **разрешение на встраивание**, то есть единственное действие, которое
 *   конвейер со шрифтом совершает. Поле обязательное: запись шрифта без него не читается.
 *
 * ГРАНИЦА, ПРОВЕДЁННАЯ ЯВНО (решение владельца, `M-02`): **`fsType` схема ЗАПИСЫВАЕТ, но не
 * судит.** Правило «значение допускает встраивание» принадлежит Policy Guard (`CP-06`), а не
 * форме записи: схема, отвергающая `fsType` по значению, вшила бы политику в формат — и
 * ассет, законный для другого сценария использования, стал бы нечитаемым файлом. Диапазон
 * `0…0xFFFF` — это ФОРМА (в OpenType поле объявлено как `uint16`), а не суждение о правах.
 *
 * ЧЕГО В ВЕТКЕ НЕТ И ПОЧЕМУ. Лицензии как отдельного поля: она живёт в `provenance`
 * (`work`/`reproduction`) — там же, где у всех остальных ассетов. Второй словарь лицензий
 * в одной записи разъехался бы с первым при первой правке — тот же довод, по которому в
 * репозитории нет второй копии ни перечня видов блоба, ни регулярки якоря. `unitsPerEm`,
 * `numGlyphs`, версии: они интринсики, но их не читает никто — ни движок, ни Guard;
 * `width`/`height` соседней ветки читает укладка кадра, а этих — никто.
 */
const IntrinsicSchema = z.union([
  z.object({ width: z.int().positive(), height: z.int().positive() }).strict(),
  z.object({ durationSamples: z.int().positive(), sampleRate: z.int().positive() }).strict(),
  z
    .object({
      family: identifier(),
      subfamily: identifier(),
      format: fontFormat(),
      fsType: z.int().min(0).max(0xffff),
    })
    .strict(),
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
