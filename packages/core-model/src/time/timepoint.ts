// `TimePoint` и `Duration` — типы времени авторского слоя (ADR-0001, «Типы времени в
// авторском слое разделены, а не запрещены»).
//
// ФОРМА ВОСПРОИЗВЕДЕНА ДОСЛОВНО ПО ADR-0001. Единственное отступление от буквы — `readonly`
// на полях: имена, варианты и опциональность те же.
//
// ЧТО ЭТО ЗА ТИП И ГДЕ ОН ЖИВЁТ. `TimePoint` висит на `Clip` (таблица ADR-0001: «размещение
// элемента в интервале, заданном `TimePoint` + `Duration`»), то есть это тип **Timeline**,
// а не поле записи режиссуры. В `direction/1` (`@vpe/schema`) поля `at`/`until` сужены до
// варианта `anchor` без `nudgeSamples` — «только якорь (Charter V1)». Расхождения между
// схемой и ADR тут нет: авторский слой сужен намеренно, `mediaTime` (in-point музыки)
// появляется уровнем ниже, а `nudgeSamples` приезжает из `override/1 op: nudge` (ADR-0004 §7).
// Чтобы эти две формы не разъехались молча, есть тип-тест: `Direction['records'][number]['at']`
// обязан быть присваиваем в `TimePoint`.
//
// V1 ЗАПРЕЩАЕТ АБСОЛЮТНУЮ ФОРМУ РОВНО У `anchor`. `mediaTime` и `Duration` абсолютны и
// разрешены (ADR-0001). Поэтому у `anchor` нет и не может быть поля с сэмплом от начала
// ролика — есть только `nudgeSamples`, поправка ОТНОСИТЕЛЬНО якоря.
//
// ЧЕГО ЗДЕСЬ НЕТ. Вычисления абсолютного сэмпла по `anchor`. Оно требует ledger якорей
// (`C-04`), которого ещё нет, и форму этого ledger'а `C-01` за него не решает.

import { type Samples, type Sha256 } from '@vpe/schema';

import { TimeModelError } from './errors.js';

/**
 * Идентификатор якоря — `b:`/`sc:`/`ch:`/`r:` (ADR-0004 §1); `w:` в авторский слой не
 * попадает (ADR-0004 §2, инвариант A1, охраняется схемой `publicAnchor()`).
 *
 * Здесь это простой `string`. Бренд и валидация — `C-04` (ledger якорей): бренд без
 * единственного конструктора-валидатора не даёт ничего, а конструктор живёт там, где
 * якоря минтятся.
 */
export type AnchorId = string;

/** Позиция на речевом таймлайне. Абсолютной формы нет (Charter V1). */
export interface AnchorTimePoint {
  readonly kind: 'anchor';
  readonly anchor: AnchorId;
  readonly nudgeSamples?: Samples;
}

/** In-point внутри ассета (музыка). Абсолютен и разрешён (ADR-0001). */
export interface MediaTimePoint {
  readonly kind: 'mediaTime';
  readonly asset: Sha256;
  readonly offsetSamples: Samples;
}

/**
 * Позиция на сетке ассета. **В v1 не реализуется (M5).** Вариант остаётся в типе, потому что
 * форвард-совместимость суммы стоит одну строку, а введение третьего варианта задним числом —
 * миграция `direction/1` (ADR-0001).
 */
export interface GridTimePoint {
  readonly kind: 'gridPoint';
  readonly asset: Sha256;
  readonly gridId: string;
  readonly index: number;
}

export type TimePoint = AnchorTimePoint | MediaTimePoint | GridTimePoint;

/** Варианты, которые v1 умеет реализовать. */
export type RealizableTimePoint = AnchorTimePoint | MediaTimePoint;

/** Длительность. Абсолютна и разрешена: фейд, минимальное время показа (ADR-0001). */
export interface Duration {
  readonly samples: Samples;
}

/**
 * Отвергает `gridPoint`: «сетки ассетов не реализованы в v1».
 *
 * Формат не имеет права обещать то, чего нет (ADR-0001, M5). Отказ здесь дублирует отказ
 * валидатора `direction/` не по недосмотру: схема стережёт ФАЙЛ, а этот ассерт — значение,
 * дошедшее до модели, откуда бы оно ни пришло.
 *
 * @throws `TimeModelError`, если это `gridPoint`.
 */
export function assertRealizable(point: TimePoint): asserts point is RealizableTimePoint {
  if (point.kind === 'gridPoint') {
    throw new TimeModelError(
      'ADR-0001 gridPoint',
      `сетки ассетов не реализованы в v1 (ассет ${point.asset}, сетка \`${point.gridId}\`, ` +
        `индекс ${String(point.index)}). Вариант оставлен в типе ради форвард-совместимости: ` +
        'введение третьего варианта задним числом было бы миграцией `direction/1`.',
    );
  }
}
