// Формы контракта границы рендерера — [ADR-0008](../../../docs/adr/0008-renderer-boundary.md),
// раздел «Контракт», ПЕРЕПИСАННЫЕ ЗДЕСЬ БЕЗ ЕДИНОГО ИЗМЕНЕНИЯ ПОЛЯ.
//
// ПОЧЕМУ ТИПЫ ЖИВУТ В ПАКЕТЕ РЕНДЕРЕРА, А НЕ В `core-model`. `SegmentRenderRequest` — не
// сущность модели: он состоит ИЗ сущностей (`RenderIrSegment`) плюс путей на диске текущей
// машины, которых в модели нет и быть не должно (ADR-0001: модель не знает файловой системы).
// Решение владельца задачи `H-01`.
//
// ПОЧЕМУ `SegmentArtifact` ЗДЕСЬ НЕТ. Правка DOC-04 (2026-08-25) в ADR-0008: «рендерер отдаёт
// КАДРЫ, `media` их кодирует и собирает артефакт». Решение владельца `H-01` (поправка A) читает
// эту букву дословно: адаптер возвращает `RenderResponse` с КАДРАМИ, а `SegmentArtifact` строит
// `media` (`buildSegmentArtifact`, `M-04`+). Поэтому стрелки `renderer-hyperframes → media` в
// карте ADR-0009 не появляется, и охранник графа `tests/boundaries/adr0009-graph.test.ts`
// не правится. Форма запроса при этом не меняется ни одним полем — меняется только ответ на
// вопрос «кто заполняет выход».
//
// ПОЧЕМУ ЗДЕСЬ НЕТ `import { Sha256 } from '@vpe/schema'`. Пакет по карте ADR-0009 зависит от
// `core-model` и `templates-spec`; `@vpe/schema` из него не резолвится вовсе. Бренд берётся у
// типа, который его несёт, — образец `packages/compile/src/timeline/types.ts`.

import type { IrAssetRef, IrFontRef, RenderIrSegment } from '@vpe/core-model';

/**
 * `Sha256` — БРЕНД, взятый у типа модели, а не объявленный заново.
 *
 * Второе объявление того же бренда было бы вторым `Sha256` в системе типов: структурно
 * совместимым, но не тем же самым, — и первая же функция, принимающая «наш» `Sha256`,
 * молча приняла бы любую строку. Здесь бренд ровно один, и он приехал из `@vpe/schema`
 * через `core-model`.
 */
export type Sha256 = IrAssetRef['sha256'];

/**
 * Точная дробь кадровой частоты (ADR-0003 T2). Форма из `compile-profile/1`.
 *
 * `num`/`den`, а не `number`: `30000/1001` в double не представимо, а `n/fps` — единственная
 * формула перевода времени во всём проекте.
 */
export interface FpsFraction {
  readonly num: number;
  readonly den: number;
}

/**
 * Поля `compile-profile/1`, которые ЧИТАЕТ адаптер.
 *
 * Не копия схемы: копия жила бы отдельной жизнью и разошлась бы с `@vpe/schema` в день
 * первой правки семейства. Здесь перечислено ровно то, без чего композиции не существует, —
 * геометрия и частота. Значение, которое кладёт вызывающий, — ВЕСЬ профиль; лишние поля
 * проезжают насквозь непрочитанными и попадают в JSON round-trip как есть.
 */
export interface CompileProfileInput {
  readonly fps: FpsFraction;
  readonly width: number;
  readonly height: number;
}

/**
 * Поля `render-profile/1 → pixelProfile`, которые ЧИТАЕТ адаптер.
 *
 * `browserGpu` — флаг `--no-browser-gpu` (ADR-0008, «Параллелизм»); `scale` — геометрия
 * композиции (ADR-0008: раскрытие `scale` — обязанность АДАПТЕРА, а не флаг рендерера, потому
 * что `--resolution` у HyperFrames умеет только целые множители ВВЕРХ, `FACT` SP-3c §6.2 п. 8);
 * `imageFormat` — формат ПЕРЕДАЧИ кадров.
 */
export interface PixelProfileInput {
  readonly browserGpu: boolean;
  readonly scale: number;
  readonly imageFormat: string;
}

/** Поля `render-profile/1 → executionProfile`, которые читает адаптер. */
export interface ExecutionProfileInput {
  readonly workers: number;
  readonly segmentTimeoutMs: number;
}

/** Ссылка на файл ассета в запросе. Три поля ADR-0008, ни одним больше. */
export interface RequestAsset {
  readonly sha256: Sha256;
  readonly path: string;
  readonly role: string;
}

/**
 * Ссылка на файл шрифта в запросе.
 *
 * `family` кладётся КАК ЕСТЬ из `IrFontRef.family`: веса начертания в контракте нет — долг
 * №153, и закрывается он не здесь.
 */
export interface RequestFont {
  readonly sha256: Sha256;
  readonly path: string;
  readonly family: string;
}

/**
 * `SegmentRenderRequest` — ADR-0008 «Контракт», дословно.
 *
 * `bundle.hash` — **наш** sha256 канонического перечня каталога композиции (решение владельца
 * `H-01`, поправка B): величина ВХОДА, которую вызывающий обязан знать до рендера. Величина,
 * которую считает сам рендерер, приходит в ответе отдельным полем `engineCompositionHash` —
 * два имени на две разные величины (16 hex у рендерера против 64 hex sha256 у нас,
 * `FACT` SP-3c §7: `5c05d8c4637e8a1c`).
 *
 * **Гарантии входа (ADR-0008):** всё по значению или по локальному пути; никаких URL; никаких
 * `Map`/`Set` — запрос обязан пережить JSON round-trip (**R4**, `test/contract.test.ts`).
 */
export interface SegmentRenderRequest {
  readonly requestVersion: 1;
  readonly ir: RenderIrSegment;
  readonly compileProfile: CompileProfileInput;
  readonly pixelProfile: PixelProfileInput;
  readonly executionProfile: ExecutionProfileInput;
  readonly bundle: {
    readonly path: string;
    readonly hash: Sha256;
    readonly compositionId: string;
  };
  readonly assets: readonly RequestAsset[];
  readonly fonts: readonly RequestFont[];
  readonly outputPath: string;
  readonly tmpDir: string;
}

/**
 * Кадры, отданные рендерером, — ВЫХОД адаптера (правка DOC-04 в ADR-0008).
 *
 * `pattern` — шаблон имени в форме ffmpeg (`frame_%06d.png`), `startNumber` — номер первого
 * кадра. Обе величины ИЗМЕРЕНЫ у рендерера, а не назначены нами: `FACT` (`hyperframes@0.8.5`,
 * `formatExportFrameName` в `dist/cli.js`) png-последовательность нумеруется С ЕДИНИЦЫ и
 * пишется как `frame_000001.png`. Пара (`pattern`, `startNumber`) — это ровно то, что
 * `media.encodeSegment` принимает своими полями `framePattern`/`startNumber`, поэтому договор
 * о нумерации проезжает границу пакетов ЗНАЧЕНИЕМ, а не соглашением.
 */
export interface RenderedFrames {
  /** Каталог с кадрами. Лежит внутри `tmpDir` запроса (**R2**). */
  readonly dir: string;
  readonly pattern: string;
  readonly startNumber: number;
  /** ИЗМЕРЕННОЕ число PNG в каталоге, сверенное с `ir.segmentDurationInFrames`. */
  readonly frameCount: number;
}

/**
 * Измерения одного прогона. Поля `stats` из ADR-0008 `SegmentArtifact`, слово в слово.
 *
 * Живут здесь, а не в `media`: `wallMs`/`retries`/`peakRssBytes` — свойства ЗАПУСКА, и
 * измерить их может только тот, кто запускал. `media` кладёт их в артефакт как есть.
 */
export interface RenderStats {
  readonly wallMs: number;
  readonly retries: number;
  readonly peakRssBytes: number;
}

/** Одна проблема отказа: правило, текст, адрес. Списком, а не первой попавшейся. */
export interface RenderProblem {
  /** `R3`, `R4`, `ADR-0008 форма`, … — то, что нарушено. */
  readonly rule: string;
  readonly message: string;
  /** Путь внутри запроса: `assets[1].sha256`, `bundle.path`. */
  readonly at: string;
}

/**
 * Ответ адаптера. Он же — тело JSON на stdout у `bin/render-segment`.
 *
 * `engineCompositionHash` — величина, которую посчитал САМ рендерер (трасса
 * `[Render:trace] {phase:'compile',status:'checkpoint'}`). Её потребитель — `verifyComposition`
 * из `media/cache` (ADR-0006 §2, долг №116): «при одних входах скомпилировалось разное».
 * `null` означает, что рендерер её не назвал, а не «совпала».
 */
export type RenderResponse =
  | {
      readonly ok: true;
      readonly frames: RenderedFrames;
      readonly engineCompositionHash: string | null;
      readonly stats: RenderStats;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly rule: string;
        readonly message: string;
        readonly details: readonly RenderProblem[];
      };
    };

/** Реэкспорт для читателя контракта: чем адресуются ассеты и шрифты внутри IR. */
export type { IrAssetRef, IrFontRef, RenderIrSegment };
