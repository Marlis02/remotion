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

import type { SegmentRenderRequest } from './contract.js';
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
}

/**
 * Строит каталог композиции и возвращает его `compositionHash`.
 *
 * Порядок шагов не произволен: сначала РЕАЛИЗАЦИИ ШАБЛОНОВ (отказ `V3` обязан случиться до
 * того, как на диск лёг хоть один байт), затем файлы, затем перечень.
 *
 * @throws {RenderAdapterError} `V3` — шаблон без реализации; `ADR-0008 форма` — неопознанный
 *   формат файла; `R2` — `bundle.hash` не совпал с посчитанным по каталогу.
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
    // и CSS-трансформом. Тест раскрытия — `H-02`; здесь механизм.
    scale: request.pixelProfile.scale,
    width,
    height,
    baseWidth: request.compileProfile.width,
    baseHeight: request.compileProfile.height,
    assets: assetUrls,
    fonts: fontEntries,
  };
  const manifestJson = canonicalJson(manifest);
  writeFileSync(path.join(dir, 'manifest.json'), manifestJson + '\n');

  // ── 6. index.html ──────────────────────────────────────────────────────────
  writeFileSync(
    path.join(dir, 'index.html'),
    indexHtml(manifest, manifestJson, irJson, used, runtimeSource),
  );

  // ── 7. перечень и хэш ──────────────────────────────────────────────────────
  const listing = listDirectory(dir);
  const hash = compositionHashOf(listing);

  if (request.bundle.hash !== hash) {
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

  // `transform: scale()` — раскрытие `scale` профиля; при `scale === 1` трансформа нет вовсе,
  // чтобы у полного профиля не появлялось лишнего слоя композитинга.
  const transform =
    manifest.scale === 1
      ? ''
      : `\n      #root { transform: scale(${String(manifest.scale)}); transform-origin: 0 0; }`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${String(manifest.width)}, height=${String(manifest.height)}" />
    <title>${manifest.compositionId}</title>
    <script src="./vendor/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${String(manifest.width)}px; height: ${String(manifest.height)}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${String(manifest.baseWidth)}px; height: ${String(manifest.baseHeight)}px; overflow: hidden; background: #000; }
      .layer { position: absolute; inset: 0; width: ${String(manifest.baseWidth)}px; height: ${String(manifest.baseHeight)}px; }${transform}
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
      window.__VPE_TEMPLATES = {
${registry}
      };
    </script>
    <script>
${runtimeSource}
    </script>
  </body>
</html>
`;
}
