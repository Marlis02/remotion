// `bed@1` — музыкальная подложка. **Шаблон АУДИО-домена: кадров он не рисует.**
//
// НОРМА `params` — `fixtures/minimal/direction/01-intro.yaml`, запись `c81a05f7`:
// `asset: "pad-loop"`, `inPoint: {kind: mediaTime, asset: "pad-loop", offsetSamples: 96000}`,
// `gainDb: -18`, `duckUnderSpeechDb: -6`.
//
// **`msPerFrameBudget: 0` — ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (`TS-01`, поправка П1), А НЕ ПРОПУСК.**
// Критерий `E-00` («шаблон без `msPerFrameBudget` не регистрируется») исполняется: поле
// обязательно, его отсутствие — отказ реестра. Но требовать «> 0» у шаблона, который не
// рисует ни одного кадра, значило бы писать фикцию — число, которого никто не мерил и не мог
// измерить. Правило «> 0 у ВИЗУАЛЬНОГО шаблона» остаётся ожиданием и проверяется там, где
// известен трек записи (`CP-06`/`E-00`); реестр трека не видит. Долг заведён с этой
// формулировкой: «ноль у аудио-шаблона законен; охранника „визуальный шаблон с нулевым
// бюджетом“ нет».
//
// **`inPoint.asset` ОБЯЗАН СОВПАДАТЬ С `asset`, И ЭТО ПРОВЕРЯЕТ СХЕМА.** In-point — «точка
// внутри ассета» (ADR-0001, V1), а ассет у этого шаблона ровно один: тот, который он играет.
// Пара с разными alias'ами означала бы либо второй ассет, которого шаблон не объявляет, либо
// смещение внутрь чужого файла. Проверка здесь избавляет от второй роли ассета — и от
// вопроса, какой из двух alias'ов кладётся в `SegmentRenderRequest.assets`.
//
// **МУЗЫКА В v1 НЕ МИКШИРУЕТСЯ, И ЭТОТ КОНТРАКТ ЭТОГО НЕ МЕНЯЕТ.** Долг №141: дорожка v1 =
// речь + тишины движка, клипы аудио-домена лежат в `AudioPlan.music[]` как есть и посчитаны
// полем `unmixedClips`. Что делают `inPoint`/`gainDb`/`duckUnderSpeechDb` — вопрос микса,
// то есть `X-02`; здесь они объявлены и типизированы, не более.

import { z } from 'zod';

import type { TemplateManifest } from '../manifest.js';
import { aliasRef, decibels, MediaTimePointParamSchema } from '../params.js';
import type { AssetRef } from '../refs.js';
import type { TemplateSpec } from '../spec.js';

const ParamsSchema = z
  .object({
    /** Alias каталога. Роль ассета = имя ЭТОГО поля (ADR-0002 §4). */
    asset: aliasRef(),
    /**
     * In-point внутри той же подложки — **только `mediaTime`** (ADR-0001, V1: «точки внутри
     * ассета выражаются явным типом `MediaTime`»). `anchor` здесь был бы позицией на РЕЧИ, а
     * `gridPoint` не реализуется в v1 вовсе — и оба невыразимы, потому что их нет в типе.
     */
    inPoint: MediaTimePointParamSchema,
    /** Уровень подложки. */
    gainDb: decibels(),
    /** Насколько подложка уходит под речь. Механика — `X-02`. */
    duckUnderSpeechDb: decibels(),
  })
  .strict()
  .superRefine((params, ctx) => {
    if (params.inPoint.asset !== params.asset) {
      ctx.addIssue({
        code: 'custom',
        path: ['inPoint', 'asset'],
        message:
          `in-point указывает на \`${params.inPoint.asset}\`, а подложка — \`${params.asset}\`. ` +
          'In-point есть точка ВНУТРИ ассета (ADR-0001, V1), а ассет у `bed@1` ровно один: ' +
          'разные alias\'ы означали бы второй ассет, которого шаблон не объявляет',
      });
    }
  });

/** Разобранные `params` шаблона `bed@1`. */
export type BedParams = z.infer<typeof ParamsSchema>;

const manifest: TemplateManifest = {
  templateId: 'bed',
  templateVersion: 1,
  // Один ассет и одна роль — имя параметра, который его держит (ADR-0002 §4). `inPoint.asset`
  // второй роли не порождает: схема требует, чтобы он был тем же самым alias'ом.
  declaredAssets: ['asset'],
  declaredFonts: [],
  gates: [],
  // Аудио-домен: кадров не рисует. Ноль — измерение по построению, а не оценка. См. шапку.
  msPerFrameBudget: 0,
  easingIds: [],
  // Механики нет (`core.md §18.1 п. 6`); подложка играет ровно, а не по огибающей речи.
  needsAudioFeatures: false,
  purposes: [],
};

/** `bed@1` — контракт шаблона фикстуры; единственный из пяти в аудио-домене. */
export const bed1: TemplateSpec<BedParams> = {
  templateId: 'bed',
  templateVersion: 1,
  paramsSchema: ParamsSchema,
  declareAssets: (params): readonly AssetRef[] => [{ alias: params.asset, role: 'asset' }],
  declareFonts: () => [],
  manifest,
};
