// `captionEmphasis@1` — визуальная эмфаза внутри полосы субтитров.
//
// НОРМА `params` — `fixtures/minimal/direction/01-intro.yaml`, запись `e40b7a92`:
// `style: "bold"`. Одно поле, и второго ни один документ не называет.
//
// **ЕДИНСТВЕННЫЙ ИЗ ПЯТИ, КТО ОБЪЯВЛЯЕТ ШРИФТ.** Отсюда `declaredFonts: ['caption']` и
// непустой `declareFonts`. Это и есть тот список, который наполняет `RenderIrSegment.fonts` —
// сегодня `readonly never[]`, «пометка типом» (долг №139): «список наполняет `declareFonts`
// (ADR-0008: шрифты и эмодзи-шрифт — файлами с checksum); до `TS-01` единственное честное
// содержимое — пустой массив». Контракт есть; правку типа делает потребитель (`CP-06`).
//
// **СЕМЕЙСТВО ШРИФТА НЕ НАЗЫВАЕТСЯ, И ЭТО ОТКАЗ, А НЕ ЗАБЫВЧИВОСТЬ.** Шрифт канала не выбран
// (долг №13, за владельцем); `DejaVu Sans Bold` в `fixtures/minimal/fonts/records` назван
// ВРЕМЕННЫМ (решение владельца 4, RM2), и sha в записи — плейсхолдер, байтов в контуре нет.
// Шаблон, вписавший `family: 'DejaVu Sans'`, зафиксировал бы временный выбор в коде и увёз
// его в `engineFingerprint` вместе с первым гейтом. `FontRef.family` необязателен именно для
// этого случая: шаблон объявляет РОЛЬ, семейство подставляет проект.
//
// `style: bold` — ЗАКРЫТЫЙ СПИСОК ИЗ ОДНОГО ЗНАЧЕНИЯ. Маркер `[emph]` в v1 — «чисто
// визуальный; голосовая эмфаза не поддерживается» (Charter V5), а его scope выбран временно
// и держится в одном месте (долг №128, `sourceTokens`/`CaptionGroupToken.emph`). Расширять
// список стилей до того, как решён scope маркера, значило бы решать за `DOC-06`.

import { z } from 'zod';

import type { TemplateManifest } from '../manifest.js';
import type { FontRef } from '../refs.js';
import type { TemplateSpec } from '../spec.js';

/** Стили эмфазы. Один элемент — см. шапку файла. */
const STYLES = ['bold'] as const;

const ParamsSchema = z
  .object({
    style: z.enum(STYLES),
  })
  .strict();

/** Разобранные `params` шаблона `captionEmphasis@1`. */
export type CaptionEmphasisParams = z.infer<typeof ParamsSchema>;

/** Роль шрифта — чем он служит шаблону. Одна строка на схему и на манифест. */
const FONT_ROLE = 'caption';

const manifest: TemplateManifest = {
  templateId: 'captionEmphasis',
  templateVersion: 1,
  declaredAssets: [],
  declaredFonts: [FONT_ROLE],
  gates: [],
  // `INFERENCE`: смена начертания внутри полосы, которую шаблон субтитров рисует и так.
  // Не измерялся; заменяется измерением при `E-00`.
  msPerFrameBudget: 1,
  easingIds: [],
  needsAudioFeatures: false,
  purposes: [],
};

/** `captionEmphasis@1` — контракт шаблона фикстуры; единственный, кто просит шрифт. */
export const captionEmphasis1: TemplateSpec<CaptionEmphasisParams> = {
  templateId: 'captionEmphasis',
  templateVersion: 1,
  paramsSchema: ParamsSchema,
  declareAssets: () => [],
  // Семейство НЕ называется — см. шапку. Роль объявлена всегда: шаблон рисует текст на любых
  // `params`, и шрифт ему нужен на любых.
  declareFonts: (): readonly FontRef[] => [{ role: FONT_ROLE }],
  manifest,
};
