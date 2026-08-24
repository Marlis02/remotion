// `audio-profile/1` — ADR-0006 §5, колонка `audioProfile`. Входит в ключи `audioTrack` и `final`.

import { z } from 'zod';

import { identifier } from './marks.js';

const ResamplerSchema = z
  .object({
    engine: identifier(),
    precision: z.int().positive(),
  })
  .strict();

const LoudnessSchema = z
  .object({
    // «Публикуемый» обязан быть числом, а не словом (Charter AC1). Величины отрицательные.
    targetLufs: z.number(),
    truePeakDb: z.number(),
  })
  .strict();

/** Пороги приёмки дубля (ADR-0010 §1). Значения ИЗМЕРЕНЫ в SP-2. */
const TakeAcceptanceSchema = z
  .object({
    minUniqueTimestampRatio: z.number().gt(0).lte(1),
    maxEqualRun: z.int().positive(),
    // После них — падение сборки, деления чанка НЕ происходит (M12).
    maxRetries: z.int().nonnegative(),
  })
  .strict();

/**
 * Акустический детектор границ речи T7 (ADR-0003 T7 после SP-2).
 *
 * ВНИМАНИЕ, входит в правило: константы привязаны к ПАРЕ (голос, модель) и инвалидируются
 * при смене любого из двух. Схема этого не ловит и ловить не может — это правило про
 * происхождение чисел, а не про их форму.
 */
const SpeechEdgesSchema = z
  .object({
    windowSamples: z.int().positive(),
    thresholdDbFs: z.number(),
    sides: identifier(),
  })
  .strict();

/**
 * Собственная ошибка алигнера (V12, ADR-0007 §9). `null` — законное значение файла:
 * до калибровки полка неизвестна, и **падает сборка AC5-b**, а не чтение профиля.
 * Порог AC5-b не формулируется, пока здесь `null` (Charter AC5, долг SP-2 №2).
 */
const AlignerNoiseFloorSchema = z
  .object({
    p50: z.number().nullable(),
    p95: z.number().nullable(),
    max: z.number().nullable(),
  })
  .strict();

export const AudioProfileSchema = z
  .object({
    schema: z.literal('audio-profile/1'),
    deliverySampleRate: z.int().positive(),
    codec: identifier(),
    bitrateKbps: z.int().positive(),
    resampler: ResamplerSchema,
    loudness: LoudnessSchema,
    // 3 мс при 24 кГц, внутри уже отведённого интервала (ADR-0003 T7).
    crossfadeSamples: z.int().nonnegative(),
    /**
     * Предел длины чанка в **code points** (ADR-0010 §3, `V-03`, решение владельца 2026-08-24).
     *
     * ПОЧЕМУ ЗДЕСЬ, А НЕ В `project.yaml.voice`: ADR-0010 §1 называет две записи решения о
     * делении одной фразой — «в ТЕКСТ (`[pause:]`) либо в ПРОФИЛЬ (`maxChunkChars`)», и второй
     * операнд этой пары, `takeAcceptance`, уже лежит строкой выше. Блок `project.yaml.voice` —
     * это «кто говорит» (провайдер, модель, голос, seed), а не «как режем».
     *
     * ЕДИНИЦА — CODE POINT, а не UTF-16 unit и не графема: `FACT` (SP-2, U4.2 + SP-2b.2) в них
     * считает и тарификация провайдера, и длина `alignment.characters`.
     *
     * ЧТО ЭТО ПОЛЕ НЕ ЕСТЬ: оно **не входит** в `cacheKeyView` стадии `voice` и действует на
     * ключи ЧЕРЕЗ ТЕКСТ — меняя раскрой, оно меняет `spokenChunkText`, а уже он стоит первым
     * полем `voiceKey`. Матрица мутации ключей (**K1**, задача `M-05`) обязана знать про это:
     * механическая мутация поля здесь изменит `voiceKey`, хотя самого поля в ключе нет.
     */
    maxChunkChars: z.int().positive(),
    takeAcceptance: TakeAcceptanceSchema,
    speechEdges: SpeechEdgesSchema,
    alignerId: identifier(),
    alignerNoiseFloor: AlignerNoiseFloorSchema,
    // Измеряется в SP-5 (`X-02`). Знак значим: сдвиг бывает в обе стороны.
    avOffsetCompensationSamples: z.int(),
  })
  .strict();

export type AudioProfile = z.infer<typeof AudioProfileSchema>;
