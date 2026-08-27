// Слой RenderIR — сущности ADR-0001 `RenderIrSegment` и `AssemblyManifest`. ТОЛЬКО ТИПЫ.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ЖИВЁТ В `core-model`, А НЕ В `compile`. ADR-0009 (Decision):
// «`renderer-hyperframes` зависит от `core-model` (тип `RenderIrSegment` — сущность модели,
// ADR-0001), а не от `compile`: рендерер потребляет ЗНАЧЕНИЕ IR, а не компилятор». То есть
// адресат этого файла — рендерер, и стрелка `renderer → compile` не должна появиться ради
// одного типа.
//
// ПОЧЕМУ ЗДЕСЬ НЕТ НИ ОДНОЙ ФУНКЦИИ. `core-model/README.md` («Слой RenderIR: здесь его нет,
// и это решение») отказывался и от типа-заготовки, и от типа с полями — до тех пор, пока
// форму не задаст задача, которая IR ПРОИЗВОДИТ. Она его и задаёт: производит `CP-04`
// (`packages/compile/src/render-ir/`), а здесь лежит контракт между производителем и
// потребителем. Квантование, seed'ы, хэш и ассерты — там; здесь нечего исполнять.
//
// ЧЕГО В `RenderIrSegment` НЕТ, И ЭТО ПРОВЕРЯЕМО:
//
//   * **сэмплов** — ADR-0008 «Контракт»: «время в кадрах относительно сегмента». Единственное
//     место, где сэмплы в этом файле есть, — `AssemblySegment`: величины `L_i`/`A_i`/`δ_i`/`a_i`
//     ОПРЕДЕЛЕНЫ в сэмплах (ADR-0003 T6), и выразить их в кадрах значило бы потерять поправку;
//   * **абсолютных позиций** — `frameStart` каждого клипа отсчитывается от начала СВОЕГО
//     сегмента (ADR-0003 T3). Отсюда AC4-b: сегмент не зависит от окружения, в котором стоит;
//   * **`Map`/`Set`/`bigint`** — ADR-0008 «Гарантии входа»: «запрос обязан пережить JSON
//     round-trip (тест)». Охраняется не только тестом: `segmentIrHash` считается через
//     `canonicalJson`, который `Map`, `Set`, `bigint` и `undefined` отвергает по построению.
//     Поэтому seed лежит строкой (`SeedHex`), а не `bigint`, каким его отдаёт `seedOf`;
//   * **позиционных ординалов** — порядок клипов в `clips` ЕСТЬ ранг внутри сегмента
//     (ADR-0007 §5: `(z, sourceOrdinal, clipId)`), а само число `sourceOrdinal` в IR не
//     попадает: оно документное и сдвигается при вставке сцены выше по тексту, то есть
//     побайтовое равенство сегмента (AC4-b) стало бы ложным;
//   * **`segmentId` во входах seed'а** — ADR-0007 §1 (**D2**). `segmentId` у сегмента есть,
//     но в `seeds` он не участвует: карту заполняет `seedOf`, у которого `SeedNode` — четыре
//     поля формулы и ни одного сверх них.
//
// «НЕ ЗНАЕТ» ДОСЛОВНО (`core.md` §155, ADR-0001): **рендерер, сеть**. Строка про рендерер
// исполнима: в этом файле нет ни одного имени рендерера, а `template`/`params` лежат данными.

import type { Frames, Samples, Sha256 } from '@vpe/schema';

import type { FrameInterval } from '../time/interval.js';
import type { TemplateParams, TrackKind } from './entities.js';

/**
 * Seed узла, материализованный в IR (ADR-0007 §2: «рендерер их не выводит»).
 *
 * **Строка, а не `bigint`.** `seedOf` отдаёт `uint64` как `bigint` — единственная форма, в
 * которой 64 бита не теряются молча (ADR-0007 §1, решение владельца `C-05` вопрос 3). Но IR
 * обязан пережить JSON round-trip, а `bigint` в JSON невыразим. Форма: **16 строчных hex-цифр,
 * big-endian** — ровно те первые 8 байт дайджеста, которые `seedOf` и читает; перевод
 * `bigint → hex` обратим без потерь, чего нельзя сказать про `bigint → number`.
 */
export type SeedHex = string;

/**
 * Ассет, на который ссылается клип: sha и РОЛЬ, как в `SegmentRenderRequest.assets`
 * (ADR-0008 «Контракт»).
 *
 * Пути здесь нет намеренно: `path` в запросе рендерера — свойство конкретного прогона
 * (content-addressed путь во `tmpDir`), а IR — свойство произведения. Путь подставляет
 * адаптер (`H-01`), он же материализует каталог композиции.
 */
export interface IrAssetRef {
  readonly sha256: Sha256;
  /**
   * Чем ассет служит шаблону. До `TS-01` (`declareAssets`) роль есть только у порождённой
   * `[img:]`-записи, и она — имя параметра шаблона, который ассет держит (ADR-0002 §4).
   */
  readonly role: string;
}

/**
 * Клип в раскладке сегмента: что показано и в каких кадрах.
 *
 * `frames` — `FrameInterval` из модели времени (`time/interval.ts`), а не вторая пара чисел:
 * полуоткрытость `[frameStart, frameEnd)` — правило T4 «для ВСЕХ интервалов Timeline и
 * RenderIR», и второй формы интервала в репозитории быть не должно.
 */
export interface IrClip {
  /** `r:<recordId>` у записи файла, `img:<b:...>` у порождённой — авторский id, не позиция. */
  readonly clipId: string;
  readonly track: TrackKind;
  /** Авторский z (ADR-0007 §5). Лежит рядом с порядком, потому что порядок из него и выведен. */
  readonly z: number;
  /** Segment-relative, ADR-0003 T3. */
  readonly frames: FrameInterval;
  /** `kenburns@1` — вызов с параметрами (**V3**), разворачивается при рендере. */
  readonly template: string;
  /** Данными насквозь: контракт `params` объявляет `TS-01`, а не этот тип. */
  readonly params: TemplateParams;
  readonly assets: readonly IrAssetRef[];
  /**
   * `purpose → seed` (ADR-0007 §1). Обычный объект, а не `Map`: JSON round-trip.
   *
   * ПОЧЕМУ КАРТА, А НЕ ОДНО ПОЛЕ. «У одной записи режиссуры узлов может быть несколько, и
   * различает их только `purpose`» (`model/seed.ts`). Сегодня в карте не больше одной записи —
   * настоящий перечень purposes объявит манифест шаблона (`TS-01`), — но форма от этого не
   * изменится: вырастет число ключей, а не тип.
   *
   * Пусто у порождённой `[img:]`-записи: у неё нет `recordId` (решение владельца `C-05`,
   * долг №21), а формула ADR-0007 §1 без него не записывается.
   */
  readonly seeds: Readonly<Record<string, SeedHex>>;
}

/**
 * Слово внутри группы субтитров.
 *
 * `highlight: null` — подсветки нет как ШАГА: слово показано в группе, отдельного интервала
 * подсветки у него нет. Так выражается разрешение ADR-0003 «Субтитры» («подсветке разрешено
 * схлопнуться в 0 кадров») без нарушения T4 («интервалы полуоткрыты» — пустых не бывает).
 * Схлопывание не молчаливо: его печатает `IrBuildRecord` стадии.
 */
export interface IrCaptionToken {
  /** Display-форма (ADR-0004 §5): `[say: 200 | two hundred]` показывает `200`. */
  readonly text: string;
  readonly highlight: FrameInterval | null;
}

/** Готовая группа субтитров с диапазоном кадров (ADR-0008 «Гарантии входа»). */
export interface IrCaptionGroup {
  readonly frames: FrameInterval;
  /** ОДНА строка, слова через пробел: перенос и автоуменьшение кегля шаблону запрещены. */
  readonly text: string;
  readonly tokens: readonly IrCaptionToken[];
}

/**
 * «Video IR» (ADR-0001): кадры, segment-relative, целое время, материализованные seed'ы.
 *
 * Единица рендера и кэша: `segmentIrHash = blake3(canonicalJson(этой структуры))` — первое
 * слагаемое `segmentKey` (ADR-0006 §2).
 */
export interface RenderIrSegment {
  /** `seg:<id первой сцены сегмента>` (ADR-0007 §1). Во входы seed'а не идёт (**D2**). */
  readonly segmentId: string;
  /** `d_i` (ADR-0003 T6). Имя разведено с `clipDurationInFrames` в m2. */
  readonly segmentDurationInFrames: Frames;
  /** Порядок = ранг внутри сегмента по `(z, sourceOrdinal, clipId)`; ординала в IR нет. */
  readonly clips: readonly IrClip[];
  readonly captions: readonly IrCaptionGroup[];
  /**
   * Шрифты — файлами с checksum (ADR-0008 «Гарантии входа»).
   *
   * `never[]` — ПОМЕТКА ТИПОМ, а не забытое поле: список наполняет `declareFonts` шаблона
   * (`TS-01`), которого нет, и до него единственное честное содержимое — пустой массив.
   * Тип `readonly never[]` делает «положить сюда что-нибудь» невыразимым до правки типа,
   * то есть до появления `TS-01`.
   */
  readonly fonts: readonly never[];
}

/** Строка манифеста: все пять величин T6 у одного сегмента плюс его место в ролике. */
export interface AssemblySegment {
  readonly segmentId: string;
  /** `d_i = ceil(L_i / S)`. */
  readonly segmentDurationInFrames: Frames;
  /** `L_i` — сумма НОМИНАЛЬНЫХ длин клипов сегмента, без поправки. */
  readonly nominalSamples: Samples;
  /** `A_i = frameStartSample(d_i)`. */
  readonly alignedSamples: Samples;
  /** `δ_i = A_i − L_i`, всегда в `[0, S)`. */
  readonly correctionSamples: Samples;
  /** `f_i` — первый кадр сегмента в ролике, `f_0 = 0`, `f_{i+1} = f_i + d_i`. */
  readonly firstFrame: Frames;
  /** `a_i` — первый сэмпл сегмента в дорожке, `a_0 = 0`, `a_{i+1} = a_i + A_i`. */
  readonly firstSample: Samples;
}

/**
 * Ссылка на собранную аудио-дорожку ролика (`AssemblyManifest` ADR-0001: «ссылка на дорожку»).
 *
 * **ССЫЛКА, А НЕ БАЙТЫ.** Манифест — значение, переживающее JSON round-trip (ADR-0008
 * «Гарантии входа»); дорожка 60-секундного Short — 2.8 МБ `Int16Array`. Поэтому здесь адрес
 * в CAS и две величины, по которым дорожку можно проверить, не читая её.
 *
 * **`sha256`, А НЕ `blake3`, И ЭТО ИЗМЕРЕНО** (`CP-05`, решение владельца 4): адрес блоба в
 * CAS считает `sha256Of` (`media/src/store/local.ts`) — `sha256` по байтам. Возьми здесь
 * `blake3` (которым считаются ключи кэша, ADR-0006 §2), и положить дорожку в стор той же
 * функцией стало бы нельзя: адрес и поле разошлись бы. `blake3` адресует ВЫЧИСЛЕНИЕ,
 * `sha256` — БАЙТЫ; здесь именно байты.
 *
 * **`numSamples` и `sampleRate` рядом с адресом — не дубль содержимого.** Из них считается
 * ассерт ADR-0008 «после конката»: `Σ durationInFrames == ceil(N_samples / samplesPerFrame)`.
 * Читатель манифеста (`L-01`, мукс `M-04`) обязан уметь его проверить, не декодируя дорожку.
 */
export interface AudioTrackRef {
  /** `sha256` по байтам PCM s16le — тот же адрес, которым блоб лежит в CAS. */
  readonly sha256: Sha256;
  /** Длина дорожки в сэмплах. Равна `frameStartSample(F)` (ADR-0003 T5, добивка `CP-05`). */
  readonly numSamples: Samples;
  /** `projectSampleRate` (ADR-0003 «Разделение sampleRate»), а не `deliverySampleRate`. */
  readonly sampleRate: number;
}

/**
 * Порядок сегментов, их длины в кадрах, ссылка на аудио-дорожку (ADR-0001).
 *
 * «НЕ знает содержимого сегментов» — исполнимо: ни одного поля отсюда нельзя дойти до клипа,
 * группы субтитров или seed'а.
 */
export interface AssemblyManifest {
  readonly segments: readonly AssemblySegment[];
  /** `F = Σ d_i`. Длина ролика в кадрах; предел `maxDurationFrames` проверяет `CP-05` (T9). */
  readonly totalFrames: Frames;
  /** `Σ δ_i` — «цена, принимаемая явно» (ADR-0003 T6): печатается в отчёте сборки. */
  readonly totalCorrectionSamples: Samples;
  /**
   * `frameStartSample(F) − Σ A_i` — невязка кадровой сетки и дорожки, свойство (3) T6.
   *
   * Печатается числом, а не подразумевается: ассерт `Σ A_i ≤ frameStartSample(F)` с разницей
   * `< n` держится здесь, а падение на нём — обязанность `CP-05` (T6c), где появляется сама
   * дорожка.
   */
  readonly trackTailSamples: Samples;
  /**
   * Дорожка приезжает с `CP-05` (`compileAudio` → `AudioPlan` → `renderAudioTrack`).
   *
   * `null`, а не отсутствующее поле: отсутствие ключа неотличимо от опечатки в имени, а
   * `null` — значимое значение «дорожки ещё нет», и оно попадает в `canonicalJson`, то есть
   * в `segmentIrHash` его отсутствие видно. ~~Тип `AudioTrackRef | null` заводит `CP-05`.~~
   * *(заведено: `CP-05`, 2026-08-27.)* `null` остаётся законным значением и означает ровно
   * «манифест собран, дорожки при нём нет»: `assemblyManifest` (`CP-04`) отдаёт манифест до
   * стадии звука, а `withAudioTrack` (`CP-05`) возвращает его копию с заполненным полем.
   */
  readonly audioTrack: AudioTrackRef | null;
}
