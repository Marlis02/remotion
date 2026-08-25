// Ключи кэшируемых стадий — формулы ADR-0006 §2 (`M-05`).
//
// ТРИ КЛЮЧА, И НИ ОДНОГО ЧЕТВЁРТОГО. Кэшируются три стадии (ADR-0006 Decision 1: «кэшируй то,
// что стоит денег или минут»); `parse`, `plan`, `bind`, `renderIr`, `audioTrack`, `final`
// персистятся в `build/` для диффов, но в skip-recompute не участвуют — при AC1 они стоят
// миллисекунды, а каждая кэшируемая стадия есть ещё один источник тихой ошибки.
//
// ЧТО ЗДЕСЬ НЕ СЧИТАЕТСЯ: `voiceKey`. Он живёт в `packages/voice/src/plan/keys.ts` (`V-03`) и
// собирается из плана речи, которого `media` не видит по графу ADR-0009. `M-05` его не
// переопределяет и не реэкспортирует (стрелки `media → voice` нет и быть не может): стадия
// принимает ключ ЗНАЧЕНИЕМ. Общего у трёх ключей ровно два предмета — каноническая форма
// (`canonical.ts`) и проектор по `cacheKeyView` (`views.ts`), и оба лежат здесь, внизу графа.
//
// ВХОДЫ ТИПИЗИРОВАНЫ, А ПРОДЮСЕРОВ ЕЩЁ НЕТ. `segmentIrHash` производит `CP-03`, настоящий
// `engineFingerprint` — `H-*`, `compositionHash` — рендерер (`CP-05`). Поэтому ключи здесь —
// ЧИСТЫЕ ФУНКЦИИ от значений: они не читают ни диск, ни окружение, и это не заглушка, а
// граница задачи, названная в отчёте.

import type { Blake3 } from '@vpe/schema';

import { CacheError } from './errors.js';
import { cacheKeyView, keyOf, type KeyInputs } from './views.js';

/**
 * Дробь кадров — `compile-profile/1 → fps`. Отдельным типом, потому что в ключ входят ОБА
 * числа отдельными строками view: дробь — это два независимых целых, а не одно значение.
 */
export interface FpsInput {
  readonly num: number;
  readonly den: number;
}

/** Поля `compileProfile`, участвующие в `segmentKey`. Состав определяет `views/segment.json`. */
export interface CompileProfileInput {
  readonly fps: FpsInput;
  readonly width: number;
  readonly height: number;
  /**
   * ВХОДИТ В ФОРМУ, НО НЕ В КЛЮЧ — **K5**. Поле обязано здесь быть: без него мутация
   * «другая частота» была бы НЕВЫРАЗИМА, и K5 доказывался бы отсутствием строки, то есть
   * ничем. Матрица меняет его и требует, чтобы `segmentKey` не двинулся.
   */
  readonly projectSampleRate: number;
  readonly templateRegistryVersion: string;
  readonly safeAreas: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
  readonly defaultParagraphGapSamples: number;
  readonly defaultSceneGapSamples: number;
  readonly defaultChapterGapSamples: number;
  readonly minSegmentDurationFrames: number;
  readonly maxDurationFrames: number;
  readonly captions: {
    readonly tokensPerGroupMin: number;
    readonly tokensPerGroupMax: number;
    readonly minGroupDurationFrames: number;
  };
}

/** Поля `pixelProfile` (ADR-0006 §5 + C5: полная строка параметров энкодера). */
export interface PixelProfileInput {
  readonly browserGpu: boolean;
  readonly imageFormat: string;
  /** Необязателен по схеме (запрещён при `png`) — `kind: json`, чтобы «нет» ≠ «есть». */
  readonly jpegQuality?: number;
  readonly scale: number;
  readonly colorSpace: string;
  readonly pixelFormat: string;
  readonly codec: string;
  readonly crf: number;
  readonly gopSize: number;
  readonly encoder: {
    readonly threads: number;
    readonly preset: string;
    readonly tune: string;
    readonly rcLookahead: number;
    readonly aqMode: number;
    readonly psy: number;
    readonly bitexact: boolean;
  };
}

/**
 * Вход `segmentKey` — ADR-0006 §2 дословно, семь слагаемых.
 *
 * `engineFingerprint` — ОДНО ПОЛЕ, а не список и не объект с версиями. Это первая половина
 * правила «входит ровно один раз»: положить его дважды нельзя, потому что второго места нет.
 * Вторая половина — в `views.ts`: путь-префикс другого пути в `cacheKeyView` отвергается.
 */
export interface SegmentKeyInput {
  /** Содержимое сегмента: что и когда показано. Производит `CP-03`. */
  readonly segmentIrHash: string;
  readonly compileProfile: CompileProfileInput;
  readonly pixelProfile: PixelProfileInput;
  readonly assetShas: readonly string[];
  readonly fontShas: readonly string[];
  /** ADR-0006 §15: в v1 всегда пуст — `gridPoint` отвергается валидатором. */
  readonly gridShas: readonly string[];
  /** Измеренное окружение (M9, ADR-0006 §3). Настоящий отпечаток считает `H-*`. */
  readonly engineFingerprint: string;
}

/** Вход `composeKey` — ADR-0006 §2 после переименования `bundle` → `compose` (SP-3c §7). */
export interface ComposeKeyInput {
  /** `blake3` исходников пакетов рендер-пути: `renderer-hyperframes`, `templates-*`. */
  readonly sourceHashes: Readonly<Record<string, string>>;
  /** Релевантные строки `pnpm-lock.yaml`, а не файл целиком: иначе ключ шумит на чужом. */
  readonly lockfileLines: readonly string[];
  /** Было `bundlerVersion`; бандлера у выбранного рендерера нет вовсе. */
  readonly compilerVersion: string;
}

/**
 * `composeKey` — считаем МЫ ПО ВХОДАМ (ADR-0006 §2).
 *
 * Парная ему величина `compositionHash` приходит от рендерера ПО ВЫХОДУ и в этот ключ не
 * входит: выход в собственном ключе входа означал бы величину, которую нельзя посчитать до
 * вычисления. Сверка их обоих — `verifyComposition` ниже.
 */
export function composeKey(input: ComposeKeyInput): Blake3 {
  return keyOf(cacheKeyView('compose'), input as unknown as KeyInputs);
}

/**
 * `segmentKey` — ключ рендера одного сегмента.
 *
 * `sampleRate` в него не входит ни одним полем (**K5**): он не влияет ни на один пиксель, а
 * сегменты немы (**R5**). Проверяется мутацией `compileProfile.projectSampleRate`, а не
 * отсутствием строки.
 */
export function segmentKey(input: SegmentKeyInput): Blake3 {
  return keyOf(cacheKeyView('segment'), input as unknown as KeyInputs);
}

/**
 * Сверка `composeKey` ↔ `compositionHash` — «дешёвый охранник против „скомпилировалось не то“»
 * (ADR-0006 §2 дословно).
 *
 * ОБЕ ВЕЛИЧИНЫ — ВХОДЫ, и равенства между ними не существует: `composeKey` — хэш ВХОДОВ
 * компиляции, `compositionHash` — хэш её ВЫХОДА, и совпасть они не могут по построению.
 * Сверяется другое: величина, которую рендерер называет СЕЙЧАС, и та, что была записана для
 * ЭТОГО `composeKey` в прошлый раз. Расхождение означает ровно одно — при тех же входах
 * скомпилировалось другое, то есть либо вход неполон (что-то влияет на композицию и не
 * входит в ключ), либо компиляция недетерминирована. Оба случая — договорная ошибка, а не
 * предупреждение: `FACT` (SP-3c §7) за 134 прогона у композиции встретился РОВНО ОДИН
 * `compositionHash`, и две холодные компиляции дали побайтово равный mp4, — то есть
 * расхождение здесь не «бывает», а значит дефект.
 *
 * Совпадение — тишина (функция ничего не возвращает): охранник, печатающий на успехе, в
 * пятидесятистрочном отчёте сборки становится шумом и его отключают.
 *
 * @throws {CacheError} `K3` — расхождение; сообщение несёт ОБЕ величины и ключ, по которому
 *   они сравнивались, чтобы отладка начиналась с них, а не с повторного прогона.
 */
export function verifyComposition(key: Blake3, recorded: string, reported: string): void {
  if (recorded === reported) return;
  throw new CacheError(
    'K3',
    `composeKey \`${key}\`: рендерер вернул compositionHash \`${reported}\`, а для этого ` +
      `ключа записан \`${recorded}\`. При одних входах скомпилировалось РАЗНОЕ — значит либо ` +
      'вход компиляции неполон (что-то влияет на композицию и не входит в `composeKey`), ' +
      'либо компиляция недетерминирована. Кэш стадии `compose` до выяснения непригоден: ' +
      'валидный по ключу устаревший кадр — тот самый дефект, ради которого стадия введена',
  );
}
