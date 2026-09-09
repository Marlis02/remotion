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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { segmentIrHash } from '@vpe/compile';
import type { RenderIrSegment } from '@vpe/core-model';
import {
  StageCache,
  buildSegmentArtifact,
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
   * Материализация каталога композиции нужна ВСЕГДА: `bundle.hash` иначе неизвестен, а по нему
   * решается «промах по композиции». Число печатается в `reports/timings.txt`, чтобы «сколько
   * стоит прогретая сборка» отвечалось измерением, а не оценкой.
   */
  readonly requestMs: number;
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
  readonly deps: RenderDeps;
  /** Печать хода: сегмент за сегментом. Рендер идёт минутами — молчать нельзя. */
  readonly out: (text: string) => void;
}

/**
 * Вход `segmentKey` НА НАСТОЯЩИХ ВЕЛИЧИНАХ — семь слагаемых ADR-0006 §2 (`CACHE-01`).
 *
 * ═══ РЕЦЕПТ ОДИН НА РЕПОЗИТОРИЙ, И ЭТО ГЛАВНОЕ СВОЙСТВО ФУНКЦИИ ═══
 * Тем же составом ключ собирает golden blast radius (**K9**,
 * [`blast-radius.test.ts`](../../test/blast-radius.test.ts)): `segmentIrHash(segment)`,
 * ПОЛНЫЙ профиль компиляции, `pixelProfile` целиком, отсортированные списки sha ассетов и
 * шрифтов, пустой `gridShas`, `engineFingerprint`. Разойдись эти два места хоть одним полем —
 * golden охранял бы множество промахов ДРУГОГО ключа, то есть не того, по которому кэш
 * решает, рендерить или нет.
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
  readonly compileProfile: CompileProfile;
  readonly pixelProfile: RenderProfile['pixelProfile'];
  readonly engineFingerprint: string;
}): string {
  const key = {
    segmentIrHash: segmentIrHash(input.ir),
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
 * ТРИ ИСХОДА ВОПРОСА К КЭШУ, И КАЖДЫЙ ПЕЧАТАЕТСЯ СВОИМ СЛОВОМ:
 *   * `попадание` — ключ есть, композиция та же: байты кладутся по ТОМУ ЖЕ пути, что дал бы
 *     рендер, и ниже по течению никто не знает, откуда они;
 *   * `промах по композиции` — ключ есть, а `bundleHash` записи не равен `bundle.hash` этого
 *     запроса. `bundle.hash` в `segmentKey` НЕ ВХОДИТ (ADR-0006 §2 после `DOC-06`), а правка
 *     кода шаблона меняет именно его: без этой ветки кэш отдавал бы кадры предыдущей
 *     реализации шаблона молча (долги №155, №196);
 *   * `промах` — записи нет либо байты значения исчезли (`get` вернул `undefined`).
 *
 * ЦЕНА, КОТОРУЮ ПЛАТИТ И ПОПАДАНИЕ: `buildRequest` зовётся ВСЕГДА, потому что `bundle.hash`
 * иначе неизвестен, а он и есть половина вопроса выше. То есть прогретая сборка всё равно
 * материализует каталог композиции каждого сегмента. Величина измеряется и печатается —
 * `requestMs` в `reports/timings.txt`.
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
        compileProfile: input.compileProfileFull,
        pixelProfile: input.renderProfile.pixelProfile,
        engineFingerprint: input.engineFingerprint,
      });
      const hitStarted = input.deps.clock();
      const entry = await cache.lookup(key);
      if (entry !== undefined && entry.bundleHash !== request.bundle.hash) {
        input.out(
          `  кэш: промах по композиции (запись снята на bundle ` +
            `${(entry.bundleHash ?? 'нет в записи').slice(0, 12)}…)\n`,
        );
      } else if (entry !== undefined) {
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

    const artifact = await buildSegmentArtifact({
      frames: response.frames,
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

    out.push({
      segmentId: ir.segmentId,
      bundleHash: request.bundle.hash,
      artifact,
      engineCompositionHash: response.engineCompositionHash,
      browserLaunchLine: response.browserLaunchLine,
      cache: cache === null ? 'off' : 'miss',
      requestMs,
    });
  }

  return out;
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
