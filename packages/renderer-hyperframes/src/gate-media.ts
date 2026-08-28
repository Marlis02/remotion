// **СКЛЕЙКА ПОРТА `GateMedia` — ОДНА ФУНКЦИЯ НА ВЕСЬ РЕПОЗИТОРИЙ** (`E-00`, долг №169).
//
// ЧТО БЫЛО. `runGate` принимает измерение входом-портом: карта ADR-0009 не даёт этому пакету
// стрелки в `@vpe/media`, поэтому кодирование кадров и обе величины ADR-0008 приезжают
// значением. Склейку (`buildSegmentArtifact` + `framemd5Of`) писал КАЖДЫЙ вызывающий: после
// `H-04` их было двое — браузерный тест и будущая команда `vpe template gate`. Две копии
// одной склейки расходятся молча, и цена расхождения названа долгом: гейт снят на одном
// профиле энкодера, сборка идёт на другом — тогда обе величины записи описывают НЕ ТОТ файл.
//
// ЧТО СТАЛО. Склейка здесь, и её зовут оба: тест `gate-render.test.ts` и команда. Стрелка в
// `media` при этом НЕ появилась — обе функции приезжают полями `deps`, ровно как `pcmSource`
// в `CP-05` и `clock` в `renderSegment`. Охранник `test/boundaries.test.ts` («`src/**` не
// импортирует `@vpe/media` ни одной строкой») остаётся зелёным, и это проверяется им же.
//
// ПОЧЕМУ ТИПЫ ПАРАМЕТРИЧЕСКИЕ, А НЕ `unknown`. `pixelProfile` и `fps` — величины `@vpe/media`
// и `@vpe/schema`, и назвать их здесь по имени нельзя (нет стрелки). `unknown` заставил бы
// вызывающего кастовать САМУ ФУНКЦИЮ (контравариантность параметров), то есть прятать под
// каст ровно то место, ради которого склейка и сводится в одно. Параметры `P`/`F`
// выводятся из поданной функции, и каст, если он нужен, остаётся на ЗНАЧЕНИИ профиля.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { RenderStats, RenderedFrames } from './contract.js';
import type { GateMedia, GateMeasurement } from './gate.js';

/** То, что `buildSegmentArtifact` возвращает и что нужно гейту. Бренд `Sha256` — строка. */
export interface GateArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly framemd5Sha256: string;
  /** Число кадров, ИЗМЕРЕННОЕ в готовом файле (ADR-0008 «Контракт»). */
  readonly frameCount: number;
}

/** Покадровые строки `framemd5` без шапки — вход `where`. */
export interface GateFramemd5 {
  readonly lines: readonly string[];
}

export interface GateMediaDeps<P, F> {
  /** `buildSegmentArtifact` из `@vpe/media` (`M-04`): кодирование + обе величины ADR-0008. */
  readonly buildSegmentArtifact: (input: {
    readonly frames: RenderedFrames;
    readonly pixelProfile: P;
    readonly fps: F;
    readonly outputPath: string;
    readonly stats: RenderStats;
  }) => Promise<GateArtifact>;
  /** `framemd5Of` из `@vpe/media`: ПОКАДРОВЫЕ строки, которых нет в артефакте. */
  readonly framemd5Of: (input: { readonly path: string }) => Promise<GateFramemd5>;
  /** Профиль энкодера пары. ОДИН на все N прогонов — иначе это гейт не одной пары. */
  readonly pixelProfile: P;
  /** `compileProfile.fps` — точная дробь (ADR-0003 T2). */
  readonly fps: F;
}

/**
 * **Порт `GateMedia`, собранный из двух функций `media`.**
 *
 * Обязанности ровно три, и все три — те, что раньше повторял каждый вызывающий:
 *   1. создать каталог для файла сегмента (`runGate` даёт свой путь на каждый прогон);
 *   2. закодировать кадры одним и тем же `pixelProfile`/`fps` — обе величины ADR-0008
 *      (`sha256` файла и свёрнутый `framemd5`) берутся отсюда;
 *   3. добрать ПОКАДРОВЫЕ строки `framemd5`: без них `where` не назвал бы ни одного кадра.
 */
export function createGateMedia<P, F>(deps: GateMediaDeps<P, F>): GateMedia {
  return {
    measure: async ({ frames, outputPath, stats }): Promise<GateMeasurement> => {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      const artifact = await deps.buildSegmentArtifact({
        frames,
        pixelProfile: deps.pixelProfile,
        fps: deps.fps,
        outputPath,
        stats,
      });
      const md5 = await deps.framemd5Of({ path: artifact.path });
      return {
        path: artifact.path,
        sha256: artifact.sha256,
        framemd5Sha256: artifact.framemd5Sha256,
        framemd5Lines: md5.lines,
        frameCount: artifact.frameCount,
      };
    },
  };
}
