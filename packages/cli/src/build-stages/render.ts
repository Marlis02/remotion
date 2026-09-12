// **ПОЛОВИНА СБОРКИ, КОТОРОЙ НУЖЕН БРАУЗЕР**: запрос на сегмент → рендер → артефакт `media`
// → конкат и мукс финала (`core.md` §1, шаги 8–10; ADR-0008 «Сборка»).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Сборка `SegmentRenderRequest` из уже посчитанного IR, подстановка путей
// (ассеты и шрифты — из CAS, по sha256), вычисление `bundle.hash` ДО рендера, вызов адаптера,
// кодирование кадров `media` и один вызов конката. Ни одного правила рендера: параллелизм,
// изоляция, отпечаток и **R12** живут в адаптере, кодек — в профиле, склейка — в `media`.
//
// ПОЧЕМУ `bundle.hash` СЧИТАЕТСЯ ЗДЕСЬ, А НЕ ПРИХОДИТ ГОТОВЫМ. Это величина ВХОДА (ADR-0008,
// решение владельца `H-01`, поправка B): вызывающий обязан знать её до рендера, а посчитать
// её может только материализация каталога. Поэтому сборка материализует каталог один раз
// «вхолостую» (`verifyHash: false`, правка `L-01` по разрешению владельца) и кладёт
// полученный хэш в запрос; адаптер пересоберёт каталог из тех же полей и СВЕРИТ (**R2**) —
// правило не ослаблено, у него просто появился законный первый вычислитель.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { segmentIrHash } from '@vpe/compile';
import type { RenderIrSegment } from '@vpe/core-model';
import {
  StageCache,
  buildSegmentArtifact,
  compositeVideoUnderlay,
  concatAndMux,
  encodeWav,
  probeStreamFingerprint,
  segmentKey,
  type CacheManifestEntry,
  type PcmS16,
  type SegmentArtifact,
  type SegmentKeyInput,
  type Store,
} from '@vpe/media';
import {
  browserPath,
  collectEngineProbe,
  computeEngineFingerprint,
  defaultCliPath,
  materializeComposition,
  rendererTemplates,
  renderSegment,
  resolveOnPath,
  validateRequest,
  type RenderResponse,
  type RendererTemplateRegistry,
  type SegmentRenderRequest,
} from '@vpe/renderer-hyperframes';
import { asSha256, type AudioProfile, type CompileProfile, type RenderProfile, type Sha256 } from '@vpe/schema';
import type { TemplateRegistry } from '@vpe/templates-spec';

import { AC4_GATE_SKIP_WHY, isGateProfile, type BuildProfileId } from '../ac4.js';
import { CliError, EXIT } from '../errors.js';
import {
  videoHolesOf,
  videoPlanOf,
  type VideoIntrinsicInput,
  type VideoPlanInput,
} from './video-plan.js';

/** Подмена рендера — ТОЛЬКО тесты: браузера у них нет. Форма — сигнатура адаптера. */
export type RenderFn = (
  request: SegmentRenderRequest,
  options: Parameters<typeof renderSegment>[1],
) => Promise<RenderResponse>;

export interface RenderDeps {
  readonly clock: () => number;
  readonly env: NodeJS.ProcessEnv;
  /** Реестр РЕАЛИЗАЦИЙ шаблонов. Умолчание — продакшн. */
  readonly templates?: RendererTemplateRegistry;
  /** Подмена адаптера (тесты). */
  readonly render?: RenderFn;
  /**
   * Отпечаток окружения ЭТОЙ машины. Умолчание — измерение теми же резолверами, что у рендера.
   *
   * Вход, потому что его спрашивают ДО рендера — на входе **R12** (`assertBuildMayStart`), —
   * а тесту с подставленным адаптером мерить нечего: браузера в нём нет.
   */
  readonly fingerprint?: () => string;
}

/** Раскладка рендера внутри `build/`. */
export interface RenderLayout {
  readonly buildDir: string;
  readonly segmentsDir: string;
  readonly tmpDir: string;
}

export interface SegmentRenderInput {
  readonly ir: RenderIrSegment;
  readonly index: number;
}

/** Как сегмент получен: из кэша, рендером, либо кэш выключен флагом (`CACHE-01`). */
export type SegmentCacheVerdict = 'hit' | 'miss' | 'off';

/** Что получилось по сегменту: запрос (для отчёта), ответ адаптера и артефакт `media`. */
export interface SegmentResult {
  readonly segmentId: string;
  readonly bundleHash: string;
  readonly artifact: SegmentArtifact;
  readonly engineCompositionHash: string | null;
  readonly browserLaunchLine: string | null;
  /**
   * Откуда байты. НИЖЕ ПО ТЕЧЕНИЮ ЭТО ПОЛЕ НЕ ЧИТАЕТ НИКТО, кроме отчётов: `assembleFinal`
   * берёт `artifact.path`, `BuildRecord` — измерения, и оба обязаны быть слепы к источнику
   * (**K3**: «попадание == промах»). Поле существует ради ОТЧЁТА — «почему эта сборка шла
   * четыре секунды» есть законный вопрос, и ответ на него не должен требовать чтения `.cache`.
   */
  readonly cache: SegmentCacheVerdict;
  /**
   * Стенка `buildRequest` — цена, которую платит и попадание (`CACHE-01`).
   *
   * Материализация каталога композиции нужна ВСЕГДА: `bundle.hash` иначе неизвестен, а он —
   * ВХОД `segmentKey` (`CACHE-02`), то есть без него нечего спросить у кэша. Число печатается
   * в `reports/timings.txt`, чтобы «сколько стоит прогретая сборка» отвечалось измерением, а
   * не оценкой. Цена названа долгом №249: снимет её кэш стадии `compose`.
   */
  readonly requestMs: number;
  /**
   * Стенка стадии нижнего слоя видео (`VID-02a`) — `null` у сегмента БЕЗ `video@1`.
   *
   * `null`, а не `0`, и разница несущая: ноль означал бы «стадия отработала мгновенно», а
   * правда другая — её не звали вовсе, и байты сегмента побайтово те же, что до этой задачи.
   */
  readonly videoUnderlayMs: number | null;
}

/** `compositionId` из `segmentId`: `seg:intro` → `seg-intro`. Двоеточие — не имя каталога. */
export function compositionIdOf(segmentId: string): string {
  return segmentId.replace(/[^A-Za-z0-9_-]/gu, '-');
}

/** Отпечаток окружения — теми же резолверами, что и рендер (**R14**, `H-03`). */
export function measureFingerprint(env: NodeJS.ProcessEnv): string {
  return computeEngineFingerprint(
    collectEngineProbe({
      parentEnv: env,
      cliPath: defaultCliPath(),
      browserPath,
      resolveOnPath,
    }),
  ).fingerprint;
}

export interface BuildRequestInput {
  readonly ir: RenderIrSegment;
  readonly index: number;
  readonly layout: RenderLayout;
  readonly compileProfile: { readonly fps: { num: number; den: number }; readonly width: number; readonly height: number };
  readonly renderProfile: RenderProfile;
  readonly store: Store;
  readonly templates: RendererTemplateRegistry;
}

/**
 * Первое вхождение каждого `sha256` — **список ФАЙЛОВ, а не список ссылок**.
 *
 * **ЗАЧЕМ ЭТО ЕСТЬ** (`E-02`, 2026-08-31, решение владельца — вариант «а»). Две стороны
 * границы говорили противоположное, и до `parallax25@1` противоречие спало, потому что ни один
 * шаблон не просил ОДИН файл в ДВУХ ролях:
 *
 *   * `compile` кладёт в `RenderIrSegment.assets` пару `(sha, role)` НАМЕРЕННО — `unionOfRefs`
 *     дословно: «ДЕДУПЛИКАЦИЯ ПО ПАРЕ, А НЕ ПО SHA: один файл в двух ролях — две строки, потому
 *     что роль есть часть того, что просит шаблон»;
 *   * адаптер отвергает повтор `sha256` в `assets`/`fonts` запроса — `validate.ts` дословно:
 *     «два имени у одного блоба означали бы два файла в каталоге композиции с одинаковым
 *     содержимым — и второй вход в `compositionHash`».
 *
 * Оба правы, и оба остаются в силе: расходятся они не в существе, а в ЕДИНИЦЕ. IR перечисляет
 * ССЫЛКИ (что просит какой шаблон), запрос перечисляет ФАЙЛЫ (что лечь в каталог композиции).
 * Перевод одного в другое и есть склейка по `sha256`, и её место — здесь, в сборке запроса, а
 * не в правиле по ту или эту сторону.
 *
 * **РОЛЬ НА УРОВНЕ СЕГМЕНТА НЕ ЧИТАЕТ НИКТО, И ЭТО ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО.**
 * `materializeComposition` берёт из `request.assets` только `path` и `sha256` (файл ложится как
 * `assets/<sha>.<ext>`, карта композиции — `sha → url`), а роль шаблон читает у СВОЕГО клипа
 * (`ctx.assets[i].role`, `IrClip.assets`), и там пара «sha + роль» сохраняется целиком. То есть
 * склейка не теряет ни одного факта: `parallax25@1` по-прежнему видит `layer0` и `layer1`, даже
 * если оба указывают на один блоб.
 *
 * **ЧТО ОСТАЁТСЯ ОТ ПОТЕРЯННОЙ РОЛИ.** Выживает ПЕРВОЕ вхождение, а порядок `IR.assets` —
 * сортировка по `(sha256, role)` (`unionOfRefs`), то есть выживает лексикографически меньшая
 * роль. Величина детерминирована и ни на что не влияет; названо здесь, чтобы «какая именно
 * роль осталась» не пришлось выяснять чтением двух пакетов.
 */
function byFirstSha<T extends { readonly sha256: string }>(refs: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return refs.filter((ref) => (seen.has(ref.sha256) ? false : (seen.add(ref.sha256), true)));
}

/**
 * IR сегмента → `SegmentRenderRequest` с ВЕРНЫМ `bundle.hash`.
 *
 * Пути ассетов и шрифтов берутся у CAS: `store.path(sha)` падает перечнем недостающих sha256
 * (`MissingBlobsError`), а не «файл не найден», — и это ровно то сообщение, по которому автор
 * зовёт `vpe store fetch`.
 */
export async function buildRequest(input: BuildRequestInput): Promise<SegmentRenderRequest> {
  const tmpDir = path.join(input.layout.tmpDir, 'segments', compositionIdOf(input.ir.segmentId));
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(input.layout.segmentsDir, { recursive: true });

  // Склейка по `sha256` — ПЕРЕД `store.path`, а не после: иначе CAS спрашивали бы про один и
  // тот же блоб дважды, и перечень недостающих sha в `MissingBlobsError` называл бы его дважды.
  // Шрифты склеиваются тем же способом и по той же причине: сегодня ни один шаблон не
  // объявляет один файл в двух ролях шрифта, но правило по ту сторону границы (`unionOfRefs`)
  // одно на оба списка — оставить здесь только ассеты значило бы оставить ту же мину взведённой.
  const assets = await Promise.all(
    byFirstSha(input.ir.assets).map(async (ref) => ({
      sha256: ref.sha256,
      path: await input.store.path(ref.sha256),
      role: ref.role,
    })),
  );
  const fonts = await Promise.all(
    byFirstSha(input.ir.fonts).map(async (ref) => ({
      sha256: ref.sha256,
      path: await input.store.path(ref.sha256),
      family: ref.family,
    })),
  );

  const draft = {
    requestVersion: 1,
    ir: input.ir,
    compileProfile: input.compileProfile,
    pixelProfile: {
      browserGpu: input.renderProfile.pixelProfile.browserGpu,
      scale: input.renderProfile.pixelProfile.scale,
      imageFormat: input.renderProfile.pixelProfile.imageFormat,
    },
    executionProfile: {
      workers: input.renderProfile.executionProfile.workers,
      segmentTimeoutMs: input.renderProfile.executionProfile.segmentTimeoutMs,
    },
    bundle: {
      path: path.join(tmpDir, 'composition'),
      // Заведомо неверное значение верной ФОРМЫ: настоящее считается строкой ниже, и до тех
      // пор поле не притворяется известным (приём `UNSET_HASH` из фикстур `H-01`).
      hash: '0'.repeat(64),
      compositionId: compositionIdOf(input.ir.segmentId),
    },
    assets,
    fonts,
    // ПЛАНЫ ДЫР `video@1` (`VID-02c`) — СЧИТАЮТСЯ ДО РЕНДЕРА, а не после, и это не порядок
    // строк, а необходимость: дыру пробивает БРАУЗЕР, то есть числа обязаны лежать в
    // композиции ДО того, как она соберётся, и войти в `bundle.hash`. Стадия ffmpeg зовёт ТУ
    // ЖЕ функцию геометрии позже, на готовых кадрах, — расхождения нет по построению.
    //
    // Прямоугольники здесь в БАЗОВЫХ координатах (без `scale` профиля): дыру уменьшает
    // единственный CSS-масштаб на слое (`FIX-02`), и вторая простановка масштаба дала бы
    // `scale` в квадрате — ровно долг №182, уже однажды оплаченный.
    videoHoles: videoHolesOf({
      ir: input.ir,
      width: input.compileProfile.width,
      height: input.compileProfile.height,
      scale: 1,
      fps: input.compileProfile.fps,
      videoOf: (sha256) => {
        const asset = assets.find((a) => a.sha256 === sha256);
        const intrinsic = VIDEO_INTRINSICS.get(sha256);
        return asset === undefined || intrinsic === undefined
          ? undefined
          : { path: asset.path, intrinsic };
      },
    }),
    // ВНЕ `tmpDir` — этого требует **R2**: адаптер чистит свой временный каталог.
    outputPath: path.join(
      input.layout.segmentsDir,
      `${String(input.index).padStart(4, '0')}-${compositionIdOf(input.ir.segmentId)}.mts`,
    ),
    tmpDir,
  };

  const probe = validateRequest(draft);
  const { compositionHash } = materializeComposition(probe, {
    registry: input.templates,
    verifyHash: false,
  });
  return validateRequest({ ...draft, bundle: { ...draft.bundle, hash: compositionHash } });
}

export interface RenderSegmentsInput {
  readonly segments: readonly RenderIrSegment[];
  readonly layout: RenderLayout;
  readonly compileProfile: BuildRequestInput['compileProfile'];
  /**
   * ПОЛНЫЙ профиль компиляции — вход `segmentKey` (`CACHE-01`), а не вход запроса.
   *
   * Рядом с узким `compileProfile` выше, а не вместо него: узкий несёт три поля, которые
   * читает адаптер (**K4**), а `views/segment.json` называет девятнадцать — включая
   * `safeAreas.*` и `maxDurationFrames`, которых у узкого нет вовсе.
   */
  readonly compileProfileFull: CompileProfile;
  readonly renderProfile: RenderProfile;
  readonly store: Store;
  readonly specs: TemplateRegistry;
  readonly profileId: BuildProfileId;
  /**
   * Отпечаток окружения, ИЗМЕРЕННЫЙ ДО РЕНДЕРА (`build.ts` §6) — седьмое слагаемое
   * `segmentKey` (ADR-0006 §2, **K6**: единственное место измеренного окружения в ключе).
   *
   * Приходит ЗНАЧЕНИЕМ, а не измеряется здесь второй раз: две пробы одной машины могут
   * разойтись (перезапуск Chrome между ними), и тогда ключ описывал бы окружение, в котором
   * **R12** не спрашивался.
   */
  readonly engineFingerprint: string;
  /**
   * Корень, под которым живёт `.cache/segment/<profileId>` (ADR-0005 §1).
   *
   * Это КОРЕНЬ ЗАПИСИ (`--write-root`), а не корень чтения: кэш — запись, и сборка
   * `fixtures/minimal` иначе положила бы `.cache/` внутрь фикстуры, которую нельзя трогать ни
   * символом. У обычной сборки оба корня совпадают, и разница видна только на фикстуре.
   */
  readonly cacheRoot: string;
  /** `--no-cache`: кэш не спрашивается и не пополняется ни одной записью. */
  readonly noCache: boolean;
  /**
   * `--keep-frames`: НЕ удалять каталог кадров сегмента после того, как артефакт лёг на диск.
   *
   * ═══ ПОЧЕМУ УДАЛЕНИЕ — УМОЛЧАНИЕ, А ОСТАВЛЕНИЕ — ФЛАГ (долг №288) ═══
   * ИЗМЕРЕНО (`SP-VID-DUR`, 2026-09-12): десятиминутный ролик на `draftHalf` оставляет в
   * `build/tmp/segments/*\/frames` **12 ГБ** (49 сегментов по 128–444 МБ), на `final` — около
   * 48 ГБ, на двадцати минутах `final` — около 96 ГБ. То есть длинный ролик упирается в диск
   * раньше, чем во время, и упирается он в ПРОИЗВОДНОЕ, которое после энкода не читает никто:
   * `assembleFinal` берёт `artifact.path` (`.mts` в `segments/`, ВНЕ `tmpDir`), а кэш —
   * байты того же файла.
   *
   * **ЧИСТИТ ВЫЗЫВАЮЩИЙ, А НЕ АДАПТЕР, И ЭТО НЕ ПЕРЕКЛАДЫВАНИЕ.** `run.ts` в своём `finally`
   * сносит каталог КОМПОЗИЦИИ и намеренно оставляет кадры: «удалить их здесь значило бы
   * отдать вызывающему путь к тому, чего уже нет» (его шапка, ADR-0008). Кадры перестают быть
   * нужны РОВНО тогда, когда из них собран артефакт, — а это знает только тот, кто его
   * собрал. Момент выбран так же: после `buildSegmentArtifact` и после `cache.put`, то есть
   * когда и файл на диске, и запись кэша уже есть.
   *
   * **ФЛАГ БЕЗ ЗНАЧЕНИЯ** — той же причины, что у `--no-cache` и `--allow-tts`:
   * `--keep-frames=false` был бы вторым способом сказать «удаляй», а первый — не писать флаг.
   * Нужен он двоим: отладке («покажи мне кадр 37, который вышел чёрным») и тем прогонам,
   * которые кадры ЧИТАЮТ после сборки.
   *
   * **АС4 НЕ ЗАДЕТ**: удаляется то, что уже прошло энкод, и ни один байт `.mts` от этого не
   * меняется. Охранник — `keep-frames.test.ts`: после сборки кадров нет, с флагом — есть, а
   * `sha256` сегмента в обоих прогонах один.
   */
  readonly keepFrames?: boolean;
  readonly deps: RenderDeps;
  /** Печать хода: сегмент за сегментом. Рендер идёт минутами — молчать нельзя. */
  readonly out: (text: string) => void;
}

/**
 * Вход `segmentKey` НА НАСТОЯЩИХ ВЕЛИЧИНАХ — восемь слагаемых ADR-0006 §2 (`CACHE-01`,
 * `bundleHash` добавлен `CACHE-02`).
 *
 * ═══ РЕЦЕПТ ОДИН НА РЕПОЗИТОРИЙ, И ЭТО ГЛАВНОЕ СВОЙСТВО ФУНКЦИИ ═══
 * Тем же составом ключ собирает golden blast radius (**K9**,
 * [`blast-radius.test.ts`](../../test/blast-radius.test.ts)): `segmentIrHash(segment)`,
 * `bundle.hash` запроса, ПОЛНЫЙ профиль компиляции, `pixelProfile` целиком, отсортированные
 * списки sha ассетов и шрифтов, пустой `gridShas`, `engineFingerprint`. Разойдись эти два
 * места хоть одним полем — golden охранял бы множество промахов ДРУГОГО ключа, то есть не
 * того, по которому кэш решает, рендерить или нет.
 *
 * СПИСКИ БЕРУТСЯ ИЗ IR, А НЕ ИЗ ЗАПРОСА, и это не мелочь: запрос склеен по `sha256`
 * (`byFirstSha`), а IR перечисляет ССЫЛКИ — один файл в двух ролях даёт в нём две строки.
 * Ключ обязан считаться по тому же перечню, что и в golden, а тот берёт IR.
 *
 * Каст — тот же приём, что в `blast-radius.test.ts` и `media/test/cache-helpers.ts`: схемы
 * семейств ШИРЕ, чем `SegmentKeyInput`, а какие их поля входят в ключ, решает не тип, а
 * `views/segment.json` — он же и падает, если названного пути во входах нет (**K2**).
 */
export function segmentCacheKey(input: {
  readonly ir: RenderIrSegment;
  /**
   * `bundle.hash` ЭТОГО запроса (`CACHE-02`) — хэш реализации композиции.
   *
   * Приходит ЗНАЧЕНИЕМ, а не считается здесь: его производит `buildRequest`
   * (`materializeComposition`), и второй счёт означал бы вторую материализацию каталога на
   * каждый вопрос к кэшу.
   */
  readonly bundleHash: string;
  readonly compileProfile: CompileProfile;
  readonly pixelProfile: RenderProfile['pixelProfile'];
  readonly engineFingerprint: string;
}): string {
  const key = {
    segmentIrHash: segmentIrHash(input.ir),
    bundleHash: input.bundleHash,
    compileProfile: input.compileProfile,
    pixelProfile: input.pixelProfile,
    assetShas: [...input.ir.assets.map((asset) => asset.sha256)].sort(),
    fontShas: [...input.ir.fonts.map((font) => font.sha256)].sort(),
    // ADR-0006 §15: в v1 всегда пуст — `gridPoint` отвергается валидатором.
    gridShas: [],
    engineFingerprint: input.engineFingerprint,
  } as unknown as SegmentKeyInput;
  return String(segmentKey(key));
}

/**
 * Артефакт сегмента ИЗ БАЙТОВ КЭША — «неотличим от рендеренного» делом, а не обещанием.
 *
 * ═══ ЧТО ИЗМЕРЯЕТСЯ, А ЧТО ЧИТАЕТСЯ — И ПОЧЕМУ ЛИНИЯ ПРОХОДИТ ЗДЕСЬ ═══
 * (Решение владельца, `CACHE-01` вопрос 3; разрез по ЦЕНЕ, а не по удобству.)
 *
 *   * ИЗМЕРЯЮТСЯ `sha256` (один проход по мегабайтам) и `stream` (`ffprobe`, десятки мс) —
 *     то есть ровно те же функции от того же файла, что на промахе;
 *   * ЧИТАЮТСЯ из манифеста `framemd5Sha256` и `frameCount`. Пересчёт `framemd5` стоит
 *     декодирования КАЖДОГО кадра — секунд на сегмент, то есть половины выигрыша.
 *
 * ПОЧЕМУ ЧТЕНИЕ ЗДЕСЬ ЗАКОННО. `framemd5` — чистая функция БАЙТОВ и версии ffmpeg. Байты
 * доказаны: стадия `segment` спрашивает кэш с `verify: true`, то есть `get` уже сверил
 * sha256 и уронил бы сборку на расхождении. Версия ffmpeg входит в ключ через
 * `engineFingerprint` (**K6**), то есть другая версия — другой ключ и другая запись.
 *
 * И ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ ДОВОДА: подлинность `framemd5` по-прежнему МЕРЯЕТСЯ, а не только
 * читается, — `vpe verify ac4` идёт с `--no-cache` (долг №239), поэтому ночной контур считает
 * его настоящим декодом на настоящем рендере.
 *
 * `frameCount` СВЕРЯЕТСЯ С IR, а не принимается на веру: ADR-0006 §8 дословно — «на попадании
 * проверяются размер и `frameCount` (дёшево)». Размер сверил `get`, число кадров сверяется
 * здесь, и сверяется с тем, сколько кадров этому сегменту НУЖНО.
 */
async function artifactFromCache(input: {
  readonly bytes: Uint8Array;
  readonly outputPath: string;
  readonly entry: CacheManifestEntry;
  readonly wallMs: number;
}): Promise<SegmentArtifact> {
  writeFileSync(input.outputPath, input.bytes);
  const stream = await probeStreamFingerprint({ path: input.outputPath });
  return {
    path: input.outputPath,
    sha256: asSha256(createHash('sha256').update(input.bytes).digest('hex')),
    frameCount: input.entry.frameCount as number,
    framemd5Sha256: asSha256(input.entry.framemd5Sha256 as string),
    stream,
    // ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ПОПАДАНИЕ НЕ МОЖЕТ БЫТЬ НЕОТЛИЧИМО ПО ПОСТРОЕНИЮ, и потому
    // числа честные, а не переписанные из записи: стенка — настоящая стенка ЭТОГО пути,
    // попыток не было, пик RSS не измерялся. Ноль читается рядом со строкой `cache=hit` в
    // `timings.txt` — иначе его пришлось бы читать как «померили ноль».
    stats: { wallMs: input.wallMs, retries: 0, peakRssBytes: 0 },
  };
}

/**
 * Как спрашивается **R12** на этом прогоне: `require` на паре гейта, `skip` с причиной на
 * `ac4`. Функция существует затем, чтобы решение было ОДНИМ выражением, а не условием,
 * растащенным по вызову рендера.
 */
function gateOf(input: RenderSegmentsInput): NonNullable<Parameters<typeof renderSegment>[1]['gate']> {
  return isGateProfile(input.profileId)
    ? { mode: 'require', specs: input.specs, profileId: input.profileId }
    : { mode: 'skip', why: AC4_GATE_SKIP_WHY };
}

/**
 * Рендер всех сегментов по порядку ролика. Параллелизм — внутри рендерера (`workers`).
 *
 * ═══ ГДЕ СТОИТ МЕЖСБОРОЧНЫЙ КЭШ И ПОЧЕМУ ИМЕННО ЗДЕСЬ (`CACHE-01`, долг №200) ═══
 * ВЫШЕ точки инъекции `deps.render`, а не обёрткой вокруг неё. Значение кэша — ЗАКОДИРОВАННЫЙ
 * сегмент (`.mts`), то есть выход `buildSegmentArtifact`, а `deps.render` отдаёт КАДРЫ.
 * Обёртка вокруг адаптера обязана была бы на попадании выдумать каталог PNG — то есть
 * «похожие байты», третий исход, которого у **K3** нет по построению.
 *
 * ДВА ИСХОДА ВОПРОСА К КЭШУ, И КАЖДЫЙ ПЕЧАТАЕТСЯ СВОИМ СЛОВОМ:
 *   * `попадание` — ключ есть: байты кладутся по ТОМУ ЖЕ пути, что дал бы рендер, и ниже по
 *     течению никто не знает, откуда они;
 *   * `промах` — записи нет либо байты значения исчезли (`get` вернул `undefined`).
 *
 * ═══ ТРЕТЬЕГО ИСХОДА БОЛЬШЕ НЕТ, И ЭТО ГЛАВНАЯ ПРАВКА `CACHE-02` ═══
 * ~~`промах по композиции` — ключ есть, а `bundleHash` записи не равен `bundle.hash` этого
 * запроса.~~ Вердикт существовал ровно потому, что `bundle.hash` НЕ ВХОДИЛ в `segmentKey`:
 * `CACHE-01` спрашивал композицию ПОСТ-ФАКТУМ, по мете записи. Он ловил чтение и не мешал
 * ЗАПИСИ: после пересчёта `put` шёл ТЕМ ЖЕ ключом с ДРУГИМИ байтами и падал **K3** «два
 * разных выхода при одном ключе» — то есть правка шаблона роняла сборку, и лечилась она
 * только `rm -rf .cache`. Теперь `bundleHash` — ВХОД ключа (`views/segment.json`,
 * ADR-0006 §2 после `DOC-06`), другой код шаблона даёт другой ключ, и исход у него обычный:
 * промах и рендер. `meta.bundleHash` в записи манифеста ОСТАЁТСЯ — диагностикой (по ней
 * видно глазами, какой композицией снята запись), но ни одного решения на ней больше нет.
 *
 * ЦЕНА, КОТОРУЮ ПЛАТИТ И ПОПАДАНИЕ: `buildRequest` зовётся ВСЕГДА, потому что `bundle.hash`
 * иначе неизвестен, а он — слагаемое ключа. То есть прогретая сборка всё равно материализует
 * каталог композиции каждого сегмента. Величина измеряется и печатается — `requestMs` в
 * `reports/timings.txt` (долг №249).
 */
export async function renderSegments(input: RenderSegmentsInput): Promise<readonly SegmentResult[]> {
  const templates = input.deps.templates ?? rendererTemplates;
  const run = input.deps.render ?? renderSegment;
  const out: SegmentResult[] = [];
  // `verify: true` — РЕШЕНИЕ ВЛАДЕЛЬЦА (`CACHE-01` вопрос 1), усиление ADR-0006 §8, а не
  // ослабление: буква ADR говорит «sha256 — под `--verify-cache`», но флага у сборки нет, а
  // цена проверки нулевая (тот же проход sha256, что нужен артефакту). Без неё подмена байтов
  // ТОЙ ЖЕ ДЛИНЫ прошла бы молча — то есть попадание перестало бы быть равным промаху.
  // Расхождение буквы ADR с поведением записано долгом №246.
  const cache = input.noCache
    ? null
    : new StageCache(input.cacheRoot, { stage: 'segment', profileId: input.profileId }, { verify: true });

  for (const [index, ir] of input.segments.entries()) {
    const requestStarted = input.deps.clock();
    const request = await buildRequest({
      ir,
      index,
      layout: input.layout,
      compileProfile: input.compileProfile,
      renderProfile: input.renderProfile,
      store: input.store,
      templates,
    });
    const requestMs = input.deps.clock() - requestStarted;

    input.out(
      `сегмент ${String(index + 1)}/${String(input.segments.length)} \`${ir.segmentId}\`: ` +
        `${String(ir.segmentDurationInFrames)} кадров, bundle ${request.bundle.hash.slice(0, 12)}…\n`,
    );

    if (cache === null) {
      input.out('  кэш: выключен\n');
    } else {
      const key = segmentCacheKey({
        ir,
        // `bundle.hash` — ВХОД КЛЮЧА (`CACHE-02`). Он уже под рукой: `buildRequest` выше
        // материализовал каталог и посчитал его, и второго счёта не нужно.
        bundleHash: request.bundle.hash,
        compileProfile: input.compileProfileFull,
        pixelProfile: input.renderProfile.pixelProfile,
        engineFingerprint: input.engineFingerprint,
      });
      const hitStarted = input.deps.clock();
      const entry = await cache.lookup(key);
      if (entry !== undefined) {
        assertUsableEntry(entry, ir, key, input.cacheRoot, input.profileId);
        const bytes = await readCachedBytes(cache, key, input.cacheRoot, input.profileId);
        if (bytes !== undefined) {
          const artifact = await artifactFromCache({
            bytes,
            outputPath: request.outputPath,
            entry,
            wallMs: input.deps.clock() - hitStarted,
          });
          input.out(`  кэш: попадание ${key.slice(0, 12)}…\n`);
          out.push({
            segmentId: ir.segmentId,
            bundleHash: request.bundle.hash,
            artifact,
            // Рендерер в этом прогоне не работал — величин из его трассы нет и выдумывать их
            // нечем. `null` здесь означает «не спрашивали», и это ровно то, что случилось.
            engineCompositionHash: null,
            browserLaunchLine: null,
            cache: 'hit',
            requestMs,
            // Попадание кэша означает, что стадия в ЭТОМ прогоне не работала: в кэше лежит
            // готовый `.mts`, то есть результат УЖЕ прошедшей стадии. `null` здесь читается
            // так же, как у сегмента без видео, и это верно: «не звали в этом прогоне».
            videoUnderlayMs: null,
          });
          continue;
        }
        // Запись есть, байтов нет — ПРОМАХ по контракту `StageCache` (кэш инвалидируется по
        // определению). Печатается тем же словом: пересчёт — законный исход, порча — нет.
        input.out('  кэш: промах (байты значения исчезли)\n');
      } else {
        input.out('  кэш: промах\n');
      }
    }

    const response = await run(request, {
      clock: input.deps.clock,
      registry: templates,
      parentEnv: input.deps.env,
      // **R12 НА КАЖДОМ СЕГМЕНТЕ**, а не только на входе сборки: пара проверяется по
      // ИЗМЕРЕННОМУ этим прогоном отпечатку, а вход `assertBuildMayStart` — по отпечатку,
      // измеренному до рендера. Два разных вопроса, и оба обязаны иметь ответ.
      //
      // НА ПРОФИЛЕ `ac4` ОТВЕТ ДРУГОЙ, И ОН НАЗВАН ПРИЧИНОЙ (`F-01`, решение владельца 12):
      // записи гейта на этом профиле не существует по построению, поэтому проход именуется
      // (`mode: 'skip'`), а не выводится из умолчания. Ветка ОДНА на всю сборку — вторая
      // (`assertBuildMayStart` в `build.ts`) спрашивает тот же вопрос до первого кадра.
      gate: gateOf(input),
    });

    if (!response.ok) {
      throw new CliError(
        'R12',
        `сегмент \`${ir.segmentId}\` не отрендерился (${response.error.rule}): ` +
          response.error.message,
        EXIT.error,
      );
    }

    // ═══ СТАДИЯ НИЖНЕГО СЛОЯ ВИДЕО (`VID-02a`, 2026-09-11) ═══
    // Стоит МЕЖДУ рендером и кодированием, а не внутри энкода, — разбор в шапке
    // `media/src/assemble/video-underlay.ts`. Здесь важно одно: **сегмент без `video@1`
    // стадию не проходит вовсе**, и его байты остаются побайтово теми же, что до этой
    // задачи. Это не оптимизация, а условие приёмки (охранник — `video-underlay-absent`).
    const videoPlan = videoPlanOf({
      ir,
      width: input.compileProfileFull.width,
      height: input.compileProfileFull.height,
      scale: input.renderProfile.pixelProfile.scale,
      fps: input.compileProfile.fps,
      videoOf: videoLookupOf(request, input.specs),
    });
    let frames = response.frames;
    let videoUnderlayMs: number | null = null;
    if (videoPlan !== null) {
      // Стенку меряет ВЫЗЫВАЮЩИЙ теми же часами, что и остальные стадии (`deps.clock`):
      // у стадии своих часов нет по запрету Charter V8.
      const underlayStarted = input.deps.clock();
      const run = await compositeVideoUnderlay({
        framesDirIn: response.frames.dir,
        framesDirOut: path.join(request.tmpDir, 'frames-video'),
        pattern: response.frames.pattern,
        startNumber: response.frames.startNumber,
        plan: videoPlan,
      });
      frames = { dir: run.dir, pattern: run.pattern, startNumber: run.startNumber, frameCount: run.frameCount };
      videoUnderlayMs = input.deps.clock() - underlayStarted;
      input.out(
        `  видео: нижний слой ${String(videoPlan.rect.width)}×${String(videoPlan.rect.height)} ` +
          `в (${String(videoPlan.rect.x)}, ${String(videoPlan.rect.y)}), ` +
          `${String(Math.round(videoUnderlayMs))} мс\n`,
      );
    }

    const artifact = await buildSegmentArtifact({
      frames,
      pixelProfile: input.renderProfile.pixelProfile,
      fps: input.compileProfile.fps as Parameters<typeof buildSegmentArtifact>[0]['fps'],
      outputPath: request.outputPath,
      stats: response.stats,
    });

    if (cache !== null) {
      // ПОРЯДОК ЗНАЧИМ, и он тот же, что у стадии `voice`: сначала артефакт на диске, потом
      // запись в кэш. Обрыв между шагами оставляет байты без записи — это промах, то есть
      // пересчёт; обратный порядок оставил бы запись, ведущую в пустоту.
      await cache.put(
        segmentCacheKey({
          ir,
          bundleHash: request.bundle.hash,
          compileProfile: input.compileProfileFull,
          pixelProfile: input.renderProfile.pixelProfile,
          engineFingerprint: input.engineFingerprint,
        }),
        readFileSync(artifact.path),
        {
          frameCount: artifact.frameCount,
          framemd5Sha256: String(artifact.framemd5Sha256),
          bundleHash: request.bundle.hash,
          segmentId: ir.segmentId,
        },
      );
    }

    // ═══ КАДРЫ СЕГМЕНТА БОЛЬШЕ НЕ НУЖНЫ — ИХ МЕСТО НУЖНО (долг №288) ═══
    // ПОСЛЕДНИМ ШАГОМ, а не раньше: до `cache.put` каталог `tmpDir` ещё может понадобиться,
    // а `artifact.path` лежит ВНЕ него (`segmentsDir`, **R2**), поэтому снос ничего у
    // вызывающего не отнимает. Удаляется ВЕСЬ `request.tmpDir`, а не только `frames`: там же
    // лежат `frames-video` (вторая копия кадров, `VID-02a`) и `hf-tmp` — то же производное и
    // та же цена. Каталог композиции к этому моменту снёс сам адаптер (`run.ts`, `finally`).
    if (input.keepFrames !== true) {
      rmSync(request.tmpDir, { recursive: true, force: true });
    }

    out.push({
      segmentId: ir.segmentId,
      bundleHash: request.bundle.hash,
      artifact,
      engineCompositionHash: response.engineCompositionHash,
      browserLaunchLine: response.browserLaunchLine,
      cache: cache === null ? 'off' : 'miss',
      requestMs,
      videoUnderlayMs,
    });
  }

  return out;
}

/**
 * Поиск байтов и паспорта видео по `sha256` — вход разворота плана (`video-plan.ts`).
 *
 * **ПУТЬ БЕРЁТСЯ ИЗ ЗАПРОСА, А НЕ ИЗ КАТАЛОГА КОМПОЗИЦИИ.** В `request.assets` уже лежит путь
 * в CAS, разрешённый `store.path` (`buildRequest`), — то есть ровно те байты, чей `sha256`
 * вошёл в `bundle.hash`. Читать копию из каталога композиции значило бы читать файл, который
 * положил адаптер, и зависеть от его раскладки; читать CAS напрямую — заводить второй
 * резолвер alias'ов.
 *
 * **ПАСПОРТ БЕРЁТСЯ ИЗ IR, А НЕ ИЗМЕРЯЕТСЯ ЗАНОВО.** Частота и число кадров видео — поля
 * записи `asset-record/1`, снятые ДЕКОДОМ при `vpe asset add` (`VID-01`; на шестисекундном
 * ролике это стоит около секунды и платится один раз). Мерить их здесь второй раз значило бы
 * держать две правды об одном файле и разойтись на первом VFR.
 */
function videoLookupOf(
  request: SegmentRenderRequest,
  specs: TemplateRegistry,
): VideoPlanInput['videoOf'] {
  void specs;
  return (sha256) => {
    const asset = request.assets.find((a) => a.sha256 === sha256);
    if (asset === undefined) return undefined;
    const intrinsic = VIDEO_INTRINSICS.get(sha256);
    return intrinsic === undefined ? undefined : { path: asset.path, intrinsic };
  };
}

/**
 * Паспорта видео, собранные сборкой ДО рендера, по `sha256`.
 *
 * **ПОЧЕМУ КАРТА, А НЕ ПОЛЕ IR.** `RenderIrSegment` несёт у ассета ровно `{sha256, role}` —
 * и это правильно: IR адресует байты, а не описывает их (иначе `segmentIrHash` менялся бы от
 * правки паспорта, не менявшей ни одного пикселя). Паспорт живёт в каталоге ассетов проекта,
 * который читает `build.ts`; сюда он приезжает значением через `setVideoIntrinsics`.
 *
 * **МОДУЛЬНОЕ СОСТОЯНИЕ НАЗВАНО ВСЛУХ И ЭТО ДОЛГ.** Правильное место — поле
 * `RenderSegmentsInput`; сегодня оно потребовало бы протащить каталог ассетов через четыре
 * вызывающих, включая тесты, которые его не строят. Форма выбрана осознанно и с ценой:
 * два параллельных `renderSegments` в одном процессе разделили бы карту. Параллельных сборок
 * в v1 нет (`chapterParallelism: 1`), и это записано долгом.
 */
const VIDEO_INTRINSICS = new Map<string, VideoIntrinsicInput>();

/** Кладёт паспорта видео проекта перед рендером. Зовёт `build.ts`, один раз на сборку. */
export function setVideoIntrinsics(
  entries: Iterable<readonly [string, VideoIntrinsicInput]>,
): void {
  VIDEO_INTRINSICS.clear();
  for (const [sha, intrinsic] of entries) VIDEO_INTRINSICS.set(sha, intrinsic);
}

/**
 * Запись манифеста, годная к употреблению, — или ОТКАЗ с адресом, а не тихий пересчёт.
 *
 * Две проверки, и обе про то, что запись описывает ИМЕННО ЭТОТ сегмент:
 *   * состав полей. Запись с совпавшим `bundleHash`, но без `frameCount`/`framemd5Sha256`
 *     получиться самой не может — её либо правили руками, либо писала другая версия движка.
 *     Достроить умолчаниями нечего: `framemd5` пришлось бы пересчитать декодом, а это ровно
 *     то, что попадание обязано НЕ делать;
 *   * число кадров против IR. ADR-0006 §8 дословно: «на попадании проверяются размер и
 *     `frameCount` (дёшево)». Размер сверил `get`; здесь сверяется, что кадров в записи
 *     столько, сколько нужно ЭТОМУ сегменту.
 */
function assertUsableEntry(
  entry: CacheManifestEntry,
  ir: RenderIrSegment,
  key: string,
  cacheRoot: string,
  profileId: BuildProfileId,
): void {
  if (entry.frameCount === undefined || entry.framemd5Sha256 === undefined) {
    throw new CliError(
      'K3',
      `кэш сегментов: запись \`${key}\` неполна — нет ` +
        `\`${entry.frameCount === undefined ? 'frameCount' : 'framemd5Sha256'}\`. Достроить её ` +
        'умолчаниями нельзя ни одним полем: попадание перестало бы быть равным промаху. ' +
        `Лечится удалением пространства имён: \`rm -rf ${cacheNamespaceHint(cacheRoot, profileId)}\``,
      EXIT.error,
    );
  }
  const wanted = Number(ir.segmentDurationInFrames);
  if (entry.frameCount !== wanted) {
    throw new CliError(
      'K3',
      `кэш сегментов, сегмент \`${ir.segmentId}\`, ключ \`${key}\`: запись обещает ` +
        `${String(entry.frameCount)} кадров, а сегменту нужно ${String(wanted)}. Ключ есть ` +
        'функция входов — расхождение здесь означает, что под ключом лежит ЧУЖОЙ сегмент. ' +
        `Лечится удалением пространства имён: \`rm -rf ${cacheNamespaceHint(cacheRoot, profileId)}\``,
      EXIT.error,
    );
  }
}

/**
 * Байты значения — с ПЕРЕВОДОМ порчи в отказ сборки, а не в тихий пересчёт (**K3**).
 *
 * `CacheError` из `get` означает ровно одно: по валидному ключу лежат не те байты (усечение
 * или подмена). Проглотить его промахом значило бы стереть след порчи и пересчитать — то есть
 * сделать вид, что кэша не было. Поэтому он превращается в отказ сборки С СОВЕТОМ: удалить
 * пространство имён можно за одну команду, а понять, почему ролик собрался «немного другим»,
 * нельзя вовсе.
 */
async function readCachedBytes(
  cache: StageCache,
  key: string,
  cacheRoot: string,
  profileId: BuildProfileId,
): Promise<Uint8Array | undefined> {
  try {
    return await cache.get(key);
  } catch (error) {
    throw new CliError(
      'K3',
      `кэш сегментов испорчен: ${error instanceof Error ? error.message : String(error)}\n` +
        `Сборка остановлена, а НЕ пересчитана молча (**K3**). Кэш восстановим целиком — ` +
        `удалите пространство имён и повторите: \`rm -rf ${cacheNamespaceHint(cacheRoot, profileId)}\``,
      EXIT.error,
    );
  }
}

/** Путь пространства имён для совета в отказе. Раскладку знает `media` — здесь только текст. */
function cacheNamespaceHint(cacheRoot: string, profileId: BuildProfileId): string {
  return path.join(cacheRoot, '.cache', 'segment', profileId);
}

export interface AssembleInput {
  readonly segments: readonly SegmentResult[];
  readonly track: PcmS16;
  readonly audioProfile: AudioProfile;
  readonly layout: RenderLayout;
}

export interface AssembleResult {
  readonly audioPath: string;
  readonly finalPath: string;
  readonly args: readonly string[];
}

/**
 * Конкат сегментов и ЕДИНСТВЕННЫЙ энкод аудио при муксе (**V6**, **R10**).
 *
 * Дорожка кладётся WAV'ом на диск: ffmpeg читает файл, а не наши байты в памяти, и `M-03`
 * даёт ровно один способ записать `PcmS16` в WAV — второго здесь не заводится.
 */
export async function assembleFinal(input: AssembleInput): Promise<AssembleResult> {
  const audioPath = path.join(input.layout.buildDir, 'audio', 'track.wav');
  mkdirSync(path.dirname(audioPath), { recursive: true });
  writeFileSync(audioPath, encodeWav(input.track));

  const finalPath = path.join(input.layout.buildDir, 'final.mp4');
  const run = await concatAndMux({
    segmentPaths: input.segments.map((segment) => segment.artifact.path),
    listPath: path.join(input.layout.tmpDir, 'concat.txt'),
    audioPath,
    audioProfile: input.audioProfile,
    outputPath: finalPath,
  });

  return { audioPath, finalPath, args: run.args };
}

export type { Sha256 };
