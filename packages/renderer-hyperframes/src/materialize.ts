// Материализация каталога композиции в `tmpDir` и `compositionHash`.
//
// КТО НАПОЛНЯЕТ КАТАЛОГ — АДАПТЕР, строго и только из полей `assets`/`fonts` ЭТОГО ЖЕ запроса
// (ADR-0008, «Кто наполняет каталог композиции», добавлено RM1 2026-08-22; ADR-0009,
// «Расположение композиции»). Это не новое правило, а прочтение двух принятых: **R2** («пишет
// только в `outputPath` и `tmpDir`» — каталог лежит в `tmpDir`) и **R3** («не открывает файлов
// вне `assets`/`fonts` запроса» — адаптер уже назван субъектом, который их открывает).
//
// ПОИСКА ПО CAS ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Ни `LocalStore`, ни разрешения alias'ов: и то и
// другое означало бы открытие файла, которого запрос не называл. `.store` этот модуль не знает
// даже по имени.
//
// РАСКЛАДКА КАТАЛОГА — ADR-0009 п. 2 (`FACT` SP-3f, SP-3c): в корне `index.html`, ассеты
// адресуются ОТНОСИТЕЛЬНЫМИ URL от него (`./assets/<sha>.png`, `./fonts/<sha>.ttf`,
// `./vendor/gsap.min.js`). Каталога `public/` нет: у HyperFrames нет ни его, ни `staticFile()`,
// ни привязки каталога ассетов к `package.json`.
//
// ИМЕНА ФАЙЛОВ — ASCII-SAFE ПО sha256 (ADR-0009, «Что из старого правила остаётся в силе»).
// Причина после смены рендерера другая, но правило то же: ассет адресуется обычным
// относительным URL, который разбирает браузер, и не-ASCII имя пришлось бы кодировать
// процентами руками — тот же класс ошибок двойного кодирования, что убирают sha-имена.
//
// `compositionHash` СЧИТАЕТСЯ ПО ГОТОВОМУ КАТАЛОГУ, А НЕ ПО НАМЕРЕНИЮ. Хэш перечня
// `(относительный путь, sha256 байт)`, отсортированного по пути. Хэш «того, что мы собирались
// положить» совпал бы с собой при любой ошибке записи; хэш того, что легло, — не совпадёт.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '@vpe/core-model';

import type { SegmentRenderRequest, VideoHolePlanInput } from './contract.js';
import { RenderAdapterError } from './errors.js';
import { extensionOf } from './magic.js';
import { resolveTemplate, type RendererTemplateRegistry } from './templates/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Корень пакета — каталог с его `package.json`.
 *
 * Считается ПОДЪЁМОМ, а не относительным путём от этого файла, потому что файл живёт в двух
 * раскладках: `src/materialize.ts` под vitest и `dist/src/materialize.js` после `tsc --build`.
 * Захардкоженный `../..` верен ровно в одной из них — и это ровно тот класс ошибки, который
 * ловится только на второй раскладке, то есть в подпроцессе, то есть позже всего.
 */
function packageRoot(): string {
  let dir = HERE;
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new RenderAdapterError(
    'preflight',
    `корень пакета не найден подъёмом от \`${HERE}\`: нет ни одного \`package.json\``,
  );
}

/**
 * Исходник runtime композиции.
 *
 * Он `.js`, а не `.ts`, и потому НЕ попадает в `dist/` при `tsc --build` — это данные, а не
 * код пакета: его исполняет браузер, а не Node. Поэтому он всегда читается из `src/`, в обеих
 * раскладках. Копирование в `dist/` отдельным шагом сборки завело бы вторую копию файла,
 * которая молча устаревала бы между `pnpm build` и правкой.
 */
function runtimeSourcePath(): string {
  return path.join(packageRoot(), 'src/composition/runtime.js');
}

/**
 * Исходник runtime-guard'а D4 (`H-05`, долг №2). Читается оттуда же и по той же причине.
 *
 * ВХОДИТ В `bundle.hash`. Guard встраивается в `index.html`, `index.html` попадает в перечень
 * каталога, перечень — в `compositionHash`, который сверяется с `bundle.hash` (**R2**). То есть
 * снятие заморозки МЕНЯЕТ КЛЮЧ и не может пройти незамеченным: сегмент, снятый без guard'а, и
 * сегмент, снятый с ним, — разные входы кэша. Это сказано вслух, потому что «часть
 * материализации» звучит как деталь размещения, а на деле это свойство ключа.
 */
function freezeSourcePath(): string {
  return path.join(packageRoot(), 'src/composition/freeze.js');
}

/** Один файл каталога композиции: относительный путь и sha256 ЛЁГШИХ байтов. */
export interface CompositionListing {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface MaterializedComposition {
  /** Абсолютный путь каталога (== `request.bundle.path`). */
  readonly dir: string;
  /** sha256 канонического перечня — величина ВХОДА, сверяемая с `bundle.hash`. */
  readonly compositionHash: string;
  /** Перечень целиком: печатается в отчёте сборки. */
  readonly listing: readonly CompositionListing[];
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Канонический перечень каталога → sha256.
 *
 * Форма строки — `<относительный путь>\0<sha256>\n`, разделители — NUL и перевод строки.
 * NUL взят не для красоты: в именах файлов он невозможен, поэтому разбор перечня однозначен,
 * и «`a/b` + sha» нельзя спутать с «`a` + `b/sha`». (В исходнике NUL записан escape'ом
 * `\u0000`, а не байтом: охранник `tests/lints/nul-in-sources.test.ts`.)
 */
export function compositionHashOf(listing: readonly CompositionListing[]): string {
  const sorted = [...listing].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  for (const entry of sorted) {
    h.update(entry.path).update('\u0000').update(entry.sha256).update('\n');
  }
  return h.digest('hex');
}

/** Рекурсивный обход готового каталога: то, что ЛЕГЛО, а не то, что собирались положить. */
function listDirectory(root: string, sub = ''): CompositionListing[] {
  const out: CompositionListing[] = [];
  const dir = path.join(root, sub);
  for (const name of readdirSync(dir).sort()) {
    const rel = sub === '' ? name : `${sub}/${name}`;
    const abs = path.join(root, rel);
    if (statSync(abs).isDirectory()) {
      out.push(...listDirectory(root, rel));
      continue;
    }
    const bytes = readFileSync(abs);
    out.push({ path: rel, sha256: sha256Hex(bytes), bytes: bytes.length });
  }
  return out;
}

/** Путь к `gsap.min.js` внутри `node_modules` пакета. */
function gsapDistPath(): string {
  // Сначала резолвером Node: при pnpm пакет лежит в `packages/*/node_modules/gsap`, но
  // раскладка — свойство менеджера, а не наше, и хардкодить её значит ломаться на смене
  // `node-linker`. Подъём к корню пакета — запасной путь на случай, если `exports` у `gsap`
  // когда-нибудь закроет прямой доступ к файлу дистрибутива.
  try {
    return require.resolve('gsap/dist/gsap.min.js');
  } catch {
    /* пробуем вторым путём */
  }
  const candidate = path.join(packageRoot(), 'node_modules/gsap/dist/gsap.min.js');
  try {
    statSync(candidate);
    return candidate;
  } catch {
    throw new RenderAdapterError(
      'preflight',
      `\`gsap.min.js\` не найден по пути \`${candidate}\`. GSAP — источник кривых движения ` +
        '(ADR-0009 M6, инвариант D5), и композиция без него не строится; проверьте `pnpm install`',
    );
  }
}

export interface MaterializeOptions {
  /** Реестр реализаций шаблонов. Вход, а не глобал: тест регистрирует свой (образец `CP-07`). */
  readonly registry: RendererTemplateRegistry;
  /**
   * Сверять ли посчитанный хэш каталога с `request.bundle.hash` (**R2**). Умолчание — `true`.
   *
   * *(Добавлено: `L-01`, 2026-08-30, по явному разрешению владельца.)*
   *
   * ЗАЧЕМ ПОНАДОБИЛОСЬ. `bundle.hash` — величина ВХОДА: вызывающий обязан знать её ДО рендера.
   * Посчитать её может только материализация — то есть тот, кто СОБИРАЕТ ролик, обязан один
   * раз построить каталог «вхолостую», взять хэш и положить его в запрос. До этой правки такой
   * возможности не было вовсе, и оба существующих способа плохи: тесты (`readyRequest` в
   * `test/fixture.ts`) вынимают хэш РЕГУЛЯРКОЙ ИЗ ТЕКСТА отказа `R2`, а сборка не может
   * позволить себе разбор текста ошибки (это класс долга №164).
   *
   * **R2 НЕ ОСЛАБЛЕНА НИ НА ШАГ.** Умолчание — сверка; путь рендера (`renderSegment`) ничего
   * не подаёт и потому сверяет как прежде. `false` подаёт РОВНО подготовка запроса, у которой
   * сверять нечего по построению: хэша ещё не существует. Каталог при этом собирается тот же
   * самый — `renderSegment` пересоберёт его из тех же полей и сверит; расхождение двух сборок
   * одного запроса по-прежнему есть отказ **R2**.
   */
  readonly verifyHash?: boolean;
}

/**
 * Строит каталог композиции и возвращает его `compositionHash`.
 *
 * Порядок шагов не произволен: сначала РЕАЛИЗАЦИИ ШАБЛОНОВ (отказ `V3` обязан случиться до
 * того, как на диск лёг хоть один байт), затем файлы, затем перечень.
 *
 * @throws {RenderAdapterError} `V3` — шаблон без реализации; `ADR-0008 форма` — неопознанный
 *   формат файла; `R2` — `bundle.hash` не совпал с посчитанным по каталогу (кроме
 *   `verifyHash: false`, см. поле).
 */
export function materializeComposition(
  request: SegmentRenderRequest,
  options: MaterializeOptions,
): MaterializedComposition {
  const dir = request.bundle.path;

  // ── 1. шаблоны: отказ ДО диска ─────────────────────────────────────────────
  const used = new Map<string, string>();
  request.ir.clips.forEach((clip, i) => {
    if (used.has(clip.template)) return;
    const impl = resolveTemplate(options.registry, clip.template, `ir.clips[${String(i)}].template`);
    used.set(clip.template, impl.mountSource);
  });

  // ── 2. каталог с нуля ──────────────────────────────────────────────────────
  // `rmSync` перед созданием: остаток прошлого сегмента в каталоге — это лишний вход в
  // `compositionHash`, то есть тихая смена ключа кэша.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  mkdirSync(path.join(dir, 'vendor'), { recursive: true });

  // ── 3. ассеты и шрифты — ТОЛЬКО из запроса ─────────────────────────────────
  const assetUrls: Record<string, string> = {};
  request.assets.forEach((asset, i) => {
    const bytes = readFileSync(asset.path);
    const ext = extensionOf(bytes, `assets[${String(i)}]`);
    const rel = `assets/${asset.sha256}.${ext}`;
    writeFileSync(path.join(dir, rel), bytes);
    assetUrls[asset.sha256] = `./${rel}`;
  });

  const fontEntries: Record<string, { url: string; family: string }> = {};
  request.fonts.forEach((font, i) => {
    const bytes = readFileSync(font.path);
    const ext = extensionOf(bytes, `fonts[${String(i)}]`);
    const rel = `fonts/${font.sha256}.${ext}`;
    writeFileSync(path.join(dir, rel), bytes);
    fontEntries[font.sha256] = { url: `./${rel}`, family: font.family };
  });

  // ── 4. код рендерера: GSAP и runtime ───────────────────────────────────────
  // ЭТО НЕ ФАЙЛЫ ПРОЕКТА, а исходники самого адаптера, и под R3 они не подпадают ПО
  // ОПРЕДЕЛЕНИЮ: правило говорит «файлов вне `assets`/`fonts` ЗАПРОСА», то есть про входы
  // сегмента. Собственный код рендерера входом сегмента не является — иначе адаптер не имел
  // бы права прочитать даже себя. Сказано вслух, потому что различие проходит по границе,
  // которую тест перехвата обязан знать (`test/r2-r3.test.ts`, белый список).
  copyFileSync(gsapDistPath(), path.join(dir, 'vendor/gsap.min.js'));
  const runtimeSource = readFileSync(runtimeSourcePath(), 'utf8');
  const freezeSource = readFileSync(freezeSourcePath(), 'utf8');

  // ── 5. IR данными, а не кодом ──────────────────────────────────────────────
  const irJson = canonicalJson(request.ir);
  writeFileSync(path.join(dir, 'ir.json'), irJson + '\n');

  const width = Math.round(request.compileProfile.width * request.pixelProfile.scale);
  const height = Math.round(request.compileProfile.height * request.pixelProfile.scale);
  // ЕДИНСТВЕННЫЙ ПЕРЕВОД ВРЕМЕНИ НА NODE-СТОРОНЕ: `кадр n → t = n/fps` (ADR-0008, обязанность
  // адаптера 1). Он нужен здесь, а не только в браузере, потому что `data-duration` корня
  // обязана стоять в СТАТИЧЕСКОЙ разметке — ИЗМЕРЕНО (`H-01`): компилятор рендерера читает
  // её до запуска браузера, и выставленная скриптом она для него не существует. Формула
  // одна и та же по обе стороны границы; тест обеих — `H-02` (**R13**).
  const durationSeconds =
    (Number(request.ir.segmentDurationInFrames) * request.compileProfile.fps.den) /
    request.compileProfile.fps.num;

  const manifest = {
    compositionId: request.bundle.compositionId,
    fps: request.compileProfile.fps,
    durationSeconds,
    // РАСКРЫТИЕ `scale` В ГЕОМЕТРИЮ — обязанность АДАПТЕРА (ADR-0008): `--resolution` у
    // HyperFrames умеет только целые множители ВВЕРХ, аналога `scale: 0.5` нет
    // (`FACT` SP-3c §6.2 п. 8), поэтому половинный профиль выражается геометрией композиции
    // ~~и CSS-трансформом~~ *(изменено: `FIX-01`, 2026-08-29 — трансформы больше нет, долг
    // №182: она была ВТОРОЙ простановкой поверх рендереровой, и вместе они давали `scale` в
    // квадрате).* Число едет в `manifest.json` и в `width`/`height` выше; в `index.html`
    // множителем оно НЕ раскрывается ни разу — разбор в комментарии у `indexHtml`.
    // ~~Тест раскрытия — `H-02`~~ *(изменено там же: тест есть, и он браузерный —
    // [`scale-render.test.ts`](../test/scale-render.test.ts)).*
    scale: request.pixelProfile.scale,
    width,
    height,
    baseWidth: request.compileProfile.width,
    baseHeight: request.compileProfile.height,
    assets: assetUrls,
    fonts: fontEntries,
    // ПЛАНЫ ДЫР `video@1` (`VID-02c`) — ПЕРЕЕЗЖАЮТ ИЗ ЗАПРОСА В МАНИФЕСТ КАК ЕСТЬ.
    //
    // Через манифест, а не через `ir.json`, по той же причине, по какой через него едут
    // `baseWidth`/`scale`: IR — это то, что посчитал КОМПИЛЯТОР, и адаптер не вправе ничего
    // туда дописывать (**R4**, круговой JSON). Манифест же есть собственный словарь адаптера.
    //
    // **ПРОПУСК ПОЛЯ, А НЕ ПУСТОЙ МАССИВ, И ЭТО ИСПРАВЛЕНИЕ ИЗМЕРЕННОГО ПОБОЧНОГО ЭФФЕКТА.**
    // Первая версия писала `videoHoles: []` ВСЕГДА — «чтобы шаблон читал поле без проверки».
    // Цена оказалась не нулевой: поле попадало в `manifest.json` и в `index.html` КАЖДОЙ
    // композиции, значит `compositionHash` сдвигался у ВСЕХ шаблонов, а не только у видео, —
    // и записи гейта шести шаблонов, к которым эта задача не притрагивалась, стали бы
    // «снятыми на другой композиции». Измерено `git diff` по `gate-requests/*.json`: шесть
    // пар файлов разошлись одним лишь `bundle.hash`.
    //
    // Теперь сегмент без `video@1` даёт композицию, побайтово равную прежней. Читатель поля
    // на той стороне и так защищён (`window.__VPE_MANIFEST.videoHoles || []`).
    ...(request.videoHoles === undefined || request.videoHoles.length === 0
      ? {}
      : { videoHoles: request.videoHoles }),
  };
  const manifestJson = canonicalJson(manifest);
  writeFileSync(path.join(dir, 'manifest.json'), manifestJson + '\n');

  // ── 6. index.html ──────────────────────────────────────────────────────────
  writeFileSync(
    path.join(dir, 'index.html'),
    indexHtml(manifest, manifestJson, irJson, used, runtimeSource, freezeSource),
  );

  // ── 7. перечень и хэш ──────────────────────────────────────────────────────
  const listing = listDirectory(dir);
  const hash = compositionHashOf(listing);

  if ((options.verifyHash ?? true) && request.bundle.hash !== hash) {
    throw new RenderAdapterError(
      'R2',
      `\`bundle.hash\` запроса — \`${request.bundle.hash}\`, а каталог композиции, собранный ` +
        `из полей ЭТОГО ЖЕ запроса, имеет \`${hash}\``,
      [
        {
          rule: 'R2',
          at: 'bundle.hash',
          message:
            'расхождение означает, что вызывающий и адаптер собрали РАЗНЫЕ каталоги из одного ' +
            'запроса, — то есть вход рендера не определяется запросом однозначно, и ключ ' +
            'сегмента (ADR-0006 §2) адресует не то, что отрендерилось',
        },
      ],
    );
  }

  return { dir, compositionHash: hash, listing };
}

interface CompositionManifest {
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly videoHoles?: readonly VideoHolePlanInput[];
  readonly scale: number;
  readonly durationSeconds: number;
  readonly fonts: Record<string, { url: string; family: string }>;
}

/**
 * Экранирование JSON, встраиваемого в `<script>`.
 *
 * `<` → `\u003c` — иначе строка, содержащая `</script>`, закрыла бы тег и превратила данные
 * в разметку. Это не паранойя: текст субтитров приходит из сценария автора, то есть из
 * произвольного пользовательского ввода. JSON-эквивалентность при этом не страдает —
 * `\u003c` разбирается в тот же символ, и `JSON.parse` даёт РАВНЫЙ объект.
 */
function embedJson(json: string): string {
  return json.replace(/</gu, '\\u003c');
}

/**
 * `index.html` композиции.
 *
 * Сборщика нет: HTML собирается конкатенацией, а данные приезжают в него уже каноническим
 * JSON. Внутри — ноль логики: она вся в `runtime.js`, чтобы D4-греп стерёг ОДИН файл, а не
 * строку внутри шаблона.
 *
 * `data-*` НА `#root` СТОЯТ СТАТИЧЕСКИ, А `runtime.js` ВСТРОЕН. Оба — следствие одного
 * ИЗМЕРЕНИЯ (`H-01`, `hyperframes@0.8.5`): компилятор рендерера читает композицию ДО запуска
 * браузера и ищет в разметке `data-composition-id`, `data-width`/`data-height`,
 * `data-duration` и регистрацию `window.__timelines[…]`. Ничего из этого он не находит, если
 * это выставляет скрипт: печатает `root_missing_composition_id`, `root_missing_dimensions`,
 * `missing_timeline_registry` и уходит «калибровать» длительность браузером — рендер при этом
 * не падает, а идёт неограниченно долго (наблюдалось 0–2 кадра из 30 за 13 минут). Отдельный
 * `<script src="./runtime.js">` он тоже не разворачивает, поэтому текст встраивается.
 *
 * ~~**`html`/`body` СТОЯТ В БАЗОВОЙ ГЕОМЕТРИИ, И ЭТО НЕ ПОЛОВИНА ЛЕЧЕНИЯ №182, А
 * КОГЕРЕНТНОСТЬ.** … Дефект «композиция в четверти кадра» чинится РОВНО снятием
 * `transform: scale()` с `#root`…~~ *(изменено: `FIX-02`, 2026-09-11 — вторая половина этого
 * абзаца ОПРОВЕРГНУТА измерением, долг №265.)*
 *
 * **`html`, `body` И `#root` СТОЯТ В ГЕОМЕТРИИ ВЫХОДА (`width × height`), А СЛОИ — В БАЗОВОЙ.**
 * Это не вкус, а согласие с вендором: инжектируемый рантайм HyperFrames всё равно ПЕРЕЗАПИШЕТ
 * `#root.style.width/height` инлайном на `data-width`/`data-height` (измерено `FIX-02`), и
 * объявлять корню другой размер значило бы держать в таблице стилей число, которое заведомо
 * не доживает до первого кадра. Слои остаются 1080×1920 РАСКЛАДКОЙ и уменьшаются рисованием —
 * `zoom` на `.layer`, ровно один раз. При `scale === 1` все три строки не
 * отличаются от прежних ни байтом (`width === baseWidth`), то есть цены у правки нет.
 *
 * Что здесь ОПРОВЕРГНУТО: снятием трансформы (`FIX-01`) дефект не чинился, а МЕНЯЛ ФОРМУ —
 * вместо «содержимое сжато в четверть» получалось «содержимое не сжато вовсе, кадр обрезан
 * корнем». Опыт «Б» `FIX-01` этого не увидел, потому что мерил долю НЕЧЁРНЫХ пикселей, а она
 * равна `100 / 100 / 100 / 100` в обоих случаях. Измерение, которое видит разницу, — линейка
 * `FIX-02` §1.2 (маркеры по углам); разбор — в комментарии у `layerScale` ниже.
 *
 * ПОЧЕМУ IR ЛЕЖИТ И ФАЙЛОМ, И ВСТАВКОЙ. `ir.json` в каталоге — вход рендера, который входит в
 * `compositionHash` и который можно прочитать глазами при разборе; вставка в HTML — то, что
 * читает браузер. Байты у обоих ОДНИ И ТЕ ЖЕ (одна строка `irJson`, разойтись им негде), а
 * загрузка `ir.json` из композиции по сети (пусть и по локальному `file_server`) добавила бы
 * асинхронный шаг между загрузкой страницы и готовностью таймлайна — то есть ещё одно место,
 * где рендер может начаться раньше данных. Побочно: греп-охранник **M4**
 * (`tests/boundaries/m4-network-only-voice.test.ts`) идёт по СЫРОМУ тексту и краснеет даже на
 * упоминании сетевого вызова в комментарии. Ослаблять его ради удобства комментария
 * неправильно — правило сильнее в том виде, в каком оно есть, поэтому переформулирован
 * комментарий, а не охранник.
 */
function indexHtml(
  manifest: CompositionManifest,
  manifestJson: string,
  irJson: string,
  templates: ReadonlyMap<string, string>,
  runtimeSource: string,
  freezeSource: string,
): string {
  const faces = Object.values(manifest.fonts)
    .map(
      (f) =>
        `      @font-face { font-family: ${canonicalJson(f.family)}; ` +
        `src: url('${f.url}'); font-display: block; }`,
    )
    .join('\n');

  const registry = [...templates.entries()]
    .map(([call, source]) => `      ${canonicalJson(call)}: ${source},`)
    .join('\n');

  // ~~`transform: scale()` — раскрытие `scale` профиля; при `scale === 1` трансформа нет
  // вовсе, чтобы у полного профиля не появлялось лишнего слоя композитинга.~~
  // *(изменено: `FIX-01`, 2026-08-29 — трансформа СНЯТА, долг №182.)*
  // *(изменено: `FIX-02`, 2026-09-11 — трансформа ВЕРНУЛАСЬ, долг №265; разбор ниже.)*
  //
  // ~~**ЗДЕСЬ МАСШТАБА НЕТ И БЫТЬ НЕ ДОЛЖНО: ЕГО РАСКРЫВАЕТ САМ РЕНДЕРЕР.**~~
  // **ЗДЕСЬ МАСШТАБ ЕСТЬ, И ОН ЕДИНСТВЕННЫЙ: РЕНДЕРЕР ЕГО НЕ РАСКРЫВАЕТ ВОВСЕ.**
  //
  // **ЧТО ИЗМЕРЕНО (`FIX-02` §1.2, линейка `work/fix-02/`: четыре цветных квадрата 100×100 по
  // углам БАЗОВОЙ композиции 1080×1920 и полоса 1080×120 на `bottom: 500px`).** При
  // `scale: 0.5` кадр выходит 540×960 — и в нём лежит ЛЕВЫЙ ВЕРХНИЙ квадрат размером
  // **100×100**, то есть 1:1, а трёх других углов и полосы в кадре НЕТ ВОВСЕ. Это не
  // «содержимое уменьшено не туда»: содержимое не уменьшено НИ РАЗУ, кадр просто обрезан по
  // вьюпорту.
  //
  // **СЛЕДСТВИЕ ДЛЯ ДИАГНОЗА `FIX-01` (№182), НАЗВАННОЕ ВСЛУХ.** Тот диагноз читался «масштаб
  // применяется дважды: рендерер уменьшает вьюпорт И мы масштабируем `#root`». Первая
  // половина верна, вторая — НЕТ: «рендерер уменьшает вьюпорт» ≠ «рендерер уменьшает
  // содержимое», и второго раскрытия у рендерера не существует. Числа `FIX-01` при этом не
  // выдуманы: до него композиция авторилась в МАСШТАБИРОВАННОЙ геометрии (`#root` и `.layer`
  // = `width × height`) и вдобавок жала трансформой, отчего содержимое занимало 270×480 —
  // `100 / 0 / 0 / 0`. `FIX-01` снял ОДНУ из двух половин квадрата и перевёл авторинг в
  // базовую геометрию; вместе это дало множитель 1 там, где нужен 0.5, а прибор из четырёх
  // квадрантов разницу «занят целиком» / «занят целиком, но не тем» показать не мог по
  // построению (долг №265).
  //
  // **ГДЕ ИМЕННО СТОИТ МАСШТАБ И ПОЧЕМУ НЕ НА `#root`.** Раскрыть `scale` на самом `#root`
  // НЕЛЬЗЯ, и это ИЗМЕРЕНО (`FIX-02`, три прогона линейки): и при
  // `#root { transform: scale(0.5) }`, и при `#root { zoom: 0.5 }` кадр 540×960 содержит
  // верную по масштабу картинку, но только в левой верхней ЧЕТВЕРТИ — 270×480. Причина
  // найдена в самом вендоре: инжектируемый рантайм HyperFrames 0.8.5 в своей инициализации
  // выполняет `root.style.overflow = 'hidden'` и `root.style.width/height =
  // data-width/data-height`, то есть ПЕРЕЗАПИСЫВАЕТ размер корня ИНЛАЙНОМ на 540×960 поверх
  // нашей таблицы стилей (`RUNTIME_IIFE` в `hyperframes/dist/cli.js`). После этого корень
  // обрезает содержимое до 540×960 в НЕмасштабированных координатах, а наш масштаб поверх
  // обрезанного даёт ещё раз ×0.5. Это же объясняет и симптом №265 без всякого масштаба: слои
  // 1080×1920 внутри инлайново ужатого до 540×960 корня — ровно «левый верхний квадрант
  // композиции».
  //
  // Поэтому масштаб раскрывается НА СЛОЯХ (`.layer`), а не на корне: отрисованный
  // прямоугольник слоя (540×960) в точности совпадает с корнем, каким его сделал вендор, и ни
  // одна наша величина не спорит с вендорской — `#root` мы не трогаем вовсе.
  //
  // **ПОЧЕМУ `zoom`, А НЕ `transform`, — ЭТО ИЗМЕРЕНИЕ, И ОНО СТОИЛО ОДНОЙ ЛОЖНОЙ ПРАВКИ.**
  // Первым здесь стоял `transform: scale(); transform-origin: 0 0`, и на линейке он давал
  // безупречные числа. Но `kenburns@1` анимирует слой НИЖЕ себя через GSAP (`x`, `y`,
  // `scale`), а GSAP пишет ИНЛАЙНОВЫЙ `transform` — и инлайн затирает нашу таблицу стилей
  // целиком. `FACT` (`FIX-02`, дифференциальная проба на `still@1` + `kenburns@1`): средняя
  // абсолютная разность яркости между кадром `draftHalf` и уменьшенным кадром `final`
  // равнялась **34.41** при `transform` и **0.3184** при `zoom` (контроль без `kenburns@1` —
  // 0.1947, это цена самого ресемплинга фотографии). То есть на КАЖДОМ сегменте с движением
  // черновой профиль показывал двукратный кроп — тот же дефект №265 другими словами.
  //
  // `zoom` от этого свободен по построению: GSAP его не пишет и не читает, свойства
  // ортогональны, и инлайновая трансформа шаблона применяется ВНУТРИ уменьшенной системы
  // координат. Цена, которую `zoom` берёт взамен, названа честно: он меняет РАСКЛАДКУ, то
  // есть вычисленные размеры внутри слоя половинные. Для `host.offsetWidth`, которым
  // реализации считают доли кадра, это оказалось безразлично — измерение выше и есть проверка
  // этого: доли считаются от той же геометрии, в которой потом рисуются.
  //
  // `data-*` корня масштаб слоя не задевает по построению — они атрибуты разметки, и
  // компилятор рендерера читает их статически (`H-01`).
  //
  // **ПРИ `scale === 1` НЕ МЕНЯЕТСЯ НИ ОДНОГО БАЙТА**, и это не аккуратность, а требование:
  // `bundle.hash` полного профиля обязан остаться прежним, иначе десять записей гейта `final`
  // и весь кэш сегментов `final` стали бы недействительными. Поэтому строка масштаба
  // ПОРОЖДАЕТСЯ ПО УСЛОВИЮ (пустая при `scale === 1`), а не пишется как `zoom: 1`.
  //
  // ЧЕМ РЕНДЕРЕР УЗНАЁТ РАЗМЕР ВЫХОДА: `data-width`/`data-height` корня (и `meta viewport`) —
  // они остаются МАСШТАБИРОВАННЫМИ, и это по-прежнему вход, а не забытая половина. Аналога
  // `scale: 0.5` у `--resolution` нет (`FACT` SP-3c §6.2 п. 8) — и теперь ясно, что он и не
  // подошёл бы: `--resolution` задал бы РАЗМЕР КАДРА, а уменьшать содержимое всё равно
  // пришлось бы нам.
  //
  // Охранник — браузерный [`scale-render.test.ts`](../test/scale-render.test.ts): он
  // ПИКСЕЛЬНЫЙ (маркеры по углам половинного кадра + сверка с уменьшенным `final`-кадром), и
  // с этой находки он мерит MAD НЕ ТОЛЬКО на неподвижной линейке, но и на ДВИЖУЩЕЙСЯ связке
  // `still@1` + `kenburns@1` — иначе он снова остался бы зелёным на том, что уже случилось.
  const layerScale = manifest.scale === 1 ? '' : ` zoom: ${String(manifest.scale)};`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${String(manifest.width)}, height=${String(manifest.height)}" />
    <title>${manifest.compositionId}</title>
    <script src="./vendor/gsap.min.js"></script>
    <!--
      Заморозка глобалей (D4, ADR-0007 параграф 4). Устанавливается ПОСЛЕ GSAP и ДО всего
      нашего, а БРОСАЕТ только во взведённом окне: реестр шаблонов ниже, вызов mount и колбэки
      таймлайна (их взводит runtime). Так — по измерению H-05, а не из осторожности:
      безусловный бросок ломает инжектируемый рантайм самого HyperFrames, который читает часы
      на своей инициализации (страница падает с PAGEERROR про чтение часов, следом
      window.__hf not ready 45000ms, и рендер не стартует). Что при этом НЕ покрыто, названо в клетке D4 реестра инвариантов и долгом 167.
    -->
    <script>
${freezeSource}
    </script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${String(manifest.width)}px; height: ${String(manifest.height)}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${String(manifest.width)}px; height: ${String(manifest.height)}px; overflow: hidden; background: #000; }
      .layer { position: absolute; inset: 0; width: ${String(manifest.baseWidth)}px; height: ${String(manifest.baseHeight)}px;${layerScale} }
${faces}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${manifest.compositionId}"
      data-start="0"
      data-duration="${String(manifest.durationSeconds)}"
      data-width="${String(manifest.width)}"
      data-height="${String(manifest.height)}"
    ></div>
    <script id="vpe-ir" type="application/json">${embedJson(irJson)}</script>
    <script id="vpe-manifest" type="application/json">${embedJson(manifestJson)}</script>
    <script>
      window.__VPE_IR = JSON.parse(document.getElementById('vpe-ir').textContent);
      window.__VPE_MANIFEST = JSON.parse(document.getElementById('vpe-manifest').textContent);
      // МОДУЛЬНЫЙ КОД ШАБЛОНОВ — ПОД ОХРАНОЙ (D4, вариант «б», условие владельца H-05):
      // шаблон, укравший случайность в замыкание на ЗАГРУЗКЕ, ловится здесь, а не остаётся
      // невидимым до первого кадра.
      window.__VPE_TEMPLATES = window.__VPE_FREEZE.run('модульный код шаблонов', function () {
        return {
${registry}
        };
      });
    </script>
    <script>
${runtimeSource}
    </script>
  </body>
</html>
`;
}
