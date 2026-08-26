// Вход IR-стороны (`CP-04`). Зона `render-ir/` — «IR не знает Timeline» (**M5**, ADR-0009).
//
// ПОЧЕМУ У ЗОНЫ СВОИ ВХОДНЫЕ ТИПЫ, А НЕ `Timeline`. Правило M5 запрещает `render-ir/**`
// импортировать `timeline/**` — и это не формальность, а исполнимая форма утверждения
// «`d_i` — функция только содержимого сегмента» (T6, свойство (1)). Если бы квантование
// принимало `Timeline`, ему были бы доступны `cutTable`, соседние сегменты и длина ролика,
// то есть ровно то, от чего `d_i` зависеть не должен. Здесь их нет — не по дисциплине, а
// потому что тип их не несёт.
//
// ПЕРЕВОДИТ `Timeline` В ЭТИ ФОРМЫ СТАДИЯ `compileIr` (`../compile-ir.ts`), которая лежит
// ВНЕ обеих зон и импортирует обе. Она же — единственное место, где обе половины видны сразу.
//
// ВСЁ ВРЕМЯ ЗДЕСЬ — В СЭМПЛАХ И АБСОЛЮТНОЕ. Кадры и segment-relative появляются на выходе
// квантования, а не на входе: `localFrame(x) = frameOfSample(x − segmentStartSample)`
// (ADR-0003 T3), и чтобы вычесть начало сегмента, его надо ещё иметь.

import type { IrAssetRef, Samples, TemplateParams, TrackKind } from '@vpe/core-model';

/**
 * Четыре поля формулы seed'а минус `purpose` (ADR-0007 §1).
 *
 * `null` у клипа, порождённого из `[img:]`: `recordId` — «явный случайный id записи режиссуры,
 * выданный CLI при создании записи и записанный в `direction/*.yaml`», а у порождённой записи
 * нет ни одного из двух событий (решение владельца `C-05`, долг №21). Формула без `recordId`
 * не записывается, и выдумывать правило его вывода `CP-04` не вправе — настоящий ответ даёт
 * `TS-01` вместе с манифестом шаблона (решение владельца 1-bis, 2026-08-26).
 *
 * `segmentId` в этом типе отсутствует, и это **D2** типом: подмешать разбиение в seed нельзя,
 * потому что его сюда неоткуда взять.
 */
export interface SeedScope {
  readonly chapterId: string;
  /** `null` — запись стоит на якоре главы: сцены у неё нет (ADR-0007 §1). */
  readonly sceneId: string | null;
  readonly recordId: string;
}

/** Клип до квантования: абсолютные сэмплы плюс всё, что уедет в IR данными. */
export interface IrClipSource {
  readonly clipId: string;
  readonly track: TrackKind;
  readonly z: number;
  /**
   * Позиция якоря `at` в порядке ИСХОДНИКА (ADR-0007 §5). Нужна РОВНО для сортировки и в IR
   * не попадает: она документная и сдвигается при вставке сцены выше по тексту, то есть
   * побайтовое равенство сегмента (AC4-b) стало бы ложным.
   */
  readonly sourceOrdinal: number;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly template: string;
  readonly params: TemplateParams;
  readonly assets: readonly IrAssetRef[];
  /** `null` ⇒ у клипа не будет ни одного seed'а (порождённая `[img:]`-запись). */
  readonly seedScope: SeedScope | null;
}

/** Слово группы субтитров до квантования. */
export interface IrCaptionTokenSource {
  readonly text: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
}

/** Группа субтитров до квантования: края первого и последнего токена, буквально (**T10**). */
export interface IrCaptionGroupSource {
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly text: string;
  readonly tokens: readonly IrCaptionTokenSource[];
}

/** Сегмент до квантования: разбиение дорожки (`CP-03`) плюс всё, что в нём лежит. */
export interface IrSegmentSource {
  readonly segmentId: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
  /** `L_i` — сумма НОМИНАЛЬНЫХ длин клипов дорожки речи, без поправки `δ` (ADR-0003 T6). */
  readonly nominalSamples: Samples;
  /**
   * Предъявляла ли сегментация этому сегменту порог `minSegmentDurationFrames` (долг №132,
   * формулировка — решение владельца 9, 2026-08-26).
   *
   * `false` в двух случаях, и оба — «выбора не было»: хотя бы одна граница сегмента есть
   * разрез `chapter-forced` (граница главы режет БЕЗУСЛОВНО, **V4**), либо принятых разрезов
   * в ролике нет вовсе (единственный сегмент — объединять не с чем). Считает эту величину
   * `compileIr` по `cutTable`, а не эта зона: таблица разрезов — знание Timeline.
   */
  readonly thresholdChecked: boolean;
  readonly clips: readonly IrClipSource[];
  readonly captions: readonly IrCaptionGroupSource[];
}
