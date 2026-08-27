// `still@1` — статичная картинка. Шаблон, в который разворачивается `[img: alias]`
// (ADR-0002 §4), то есть основной способ поставить фотографию: 8 записей на ролик по AC1.
//
// **ЕГО `params` ПРИХОДЯТ ИЗ ДВУХ МЕСТ, И КОНТРАКТ ОБЯЗАН ПРИНЯТЬ ОБА.** Это измерение, а не
// осторожность:
//   * из файла — `fixtures/minimal/direction/01-intro.yaml`, запись `5d6e1130`:
//     `{ asset: "ledger", fit: cover }`;
//   * от компилятора — порождённая запись `expandImg` (`core-model/src/anchors/img.ts:86`):
//     `params: { asset: slot.alias }`, **без `fit`**.
// Отсюда `fit` — НЕОБЯЗАТЕЛЬНОЕ поле. Сделай его обязательным — и разворот `[img:]`, то есть
// восемь записей из восьми на ролике AC1, перестал бы проходить собственный контракт. Значение
// по умолчанию принадлежит коду шаблона (`E-*`/`H-06`), а не схеме: умолчание в схеме — это
// число, которое видит валидатор и не видит автор.
//
// `fit: cover` — ЗАКРЫТЫЙ СПИСОК ИЗ ОДНОГО ЗНАЧЕНИЯ, и это отказ выдумывать. `cover` —
// единственная раскладка, названная хоть одним документом проекта (фикстура). `contain`,
// `fill` и прочие — поведение, которого никто не решал; расширение списка стоит одну строку и
// делается там, где пишется код шаблона.
//
// СЛУЧАЙНОСТИ У НЕГО НЕТ, И ЭТО УЖЕ ЗАПИСАНО. ADR-0002 §4: «её шаблон `still@1` случайности
// не требует»; долг №136 держит условие открытия — «шаблон порождённой записи ПОЛУЧАЕТ
// случайность (например, jitter в `still@1`)». Он его не получил: `purposes: []`.

import { z } from 'zod';

import type { TemplateManifest } from '../manifest.js';
import { aliasRef } from '../params.js';
import type { AssetRef } from '../refs.js';
import type { TemplateSpec } from '../spec.js';

/** Раскладка картинки в кадре. Один элемент — см. шапку файла. */
const FITS = ['cover'] as const;

const ParamsSchema = z
  .object({
    /** Alias каталога. Роль ассета = имя ЭТОГО поля (ADR-0002 §4). */
    asset: aliasRef(),
    /** Необязательно: порождённая `[img:]`-запись его не несёт. */
    fit: z.enum(FITS).optional(),
  })
  .strict();

/** Разобранные `params` шаблона `still@1`. */
export type StillParams = z.infer<typeof ParamsSchema>;

const manifest: TemplateManifest = {
  templateId: 'still',
  templateVersion: 1,
  // `'asset'` — имя параметра, который ассет держит. Ровно эта строка уже лежит в IR
  // (`compile/src/compile-ir.ts`, `role: 'asset'` у порождённой записи), и назвать роль иначе
  // значило бы сменить `segmentIrHash` всех сегментов с картинками ради переименования —
  // цена, названная долгом №138.
  declaredAssets: ['asset'],
  declaredFonts: [],
  gates: [],
  // `INFERENCE`: статичная картинка, анимации нет вовсе; ни один спайк её не мерил.
  // Заменяется измерением при `E-00`.
  msPerFrameBudget: 1,
  easingIds: [],
  needsAudioFeatures: false,
  purposes: [],
};

/** `still@1` — контракт шаблона фикстуры и цель разворота `[img: alias]`. */
export const still1: TemplateSpec<StillParams> = {
  templateId: 'still',
  templateVersion: 1,
  paramsSchema: ParamsSchema,
  declareAssets: (params): readonly AssetRef[] => [{ alias: params.asset, role: 'asset' }],
  declareFonts: () => [],
  manifest,
};
