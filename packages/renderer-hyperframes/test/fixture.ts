// Синтетический запрос для тестов адаптера: минимальный, но НАСТОЯЩИЙ.
//
// `fixtures/minimal` здесь не читается ни символом (закрытая зона задания `H-01`) — образец
// `V-03`/`CP-03`: проект строится тестом во временном каталоге. Числа взяты из
// `fixtures/minimal/profiles/render.ac4.yaml` и `compile.yaml` как ДЕШЁВЫЙ набор пиксельных
// полей (270×480, `workers: 1`), а не как гейт: гейта шаблона V13 на профиле `ac4` нет и не
// заводится (решение владельца 12, RM1; строка R12 в docs/invariants.md).

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '@vpe/core-model';
import { layerRole } from '@vpe/templates-spec';

import type { SegmentRenderRequest } from '../src/contract.js';
import { renderSegment } from '../src/run.js';
import { rendererTemplates } from '../src/templates/index.js';
import { validateRequest } from '../src/validate.js';

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Минимальный валидный PNG 1×1 (RGBA, чёрный) — настоящие байты, а не заглушка. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Минимальный TTF: 12 байт заголовка `sfnt` с нулевым числом таблиц.
 *
 * Настоящим шрифтом он не является и им не притворяется: тесты, которым нужна ТИПОГРАФИКА,
 * — это `H-02`/`H-06`. Здесь проверяется РАСКЛАДКА каталога композиции и определение
 * расширения по магическим байтам, а для обоих достаточно верной сигнатуры `0x00010000`.
 */
export const TTF_STUB = Buffer.from([
  0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export interface Workspace {
  readonly root: string;
  readonly tmpDir: string;
  readonly outDir: string;
  readonly storeDir: string;
}

/** Три каталога запроса: `tmpDir` (композиция + кадры), выход и «стор» с блобами. */
export function makeWorkspace(): Workspace {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-h01-'));
  const tmpDir = path.join(root, 'tmp');
  const outDir = path.join(root, 'out');
  const storeDir = path.join(root, 'store');
  for (const d of [tmpDir, outDir, storeDir]) mkdirSync(d, { recursive: true });
  return { root, tmpDir, outDir, storeDir };
}

/** Кладёт байты в «стор» под именем их sha256 и возвращает пару (sha, путь). */
export function putBlob(ws: Workspace, bytes: Buffer, name?: string): { sha256: string; path: string } {
  const sha = sha256Hex(bytes);
  const file = path.join(ws.storeDir, name ?? sha);
  writeFileSync(file, bytes);
  return { sha256: sha, path: file };
}

export interface FixtureOptions {
  /** Сколько кадров у сегмента. По умолчанию 30 — одна секунда при 30 fps. */
  readonly frames?: number;
  /** Класть ли ассет-картинку в запрос и в клип. */
  readonly withAsset?: boolean;
  /** Класть ли шрифт. */
  readonly withFont?: boolean;
  /** Имя вызова шаблона. По умолчанию `solid@1` — синтетический шаблон тестов. */
  readonly template?: string;
}

export interface Fixture {
  readonly ws: Workspace;
  readonly request: SegmentRenderRequest;
  readonly assetSha: string | null;
  readonly fontSha: string | null;
}

/**
 * Запрос без `bundle.hash`: его считает материализация, и подставить его должен тот, кто
 * каталог уже построил. До этого момента поле несёт заведомо неверное значение — так тест
 * «`bundle.hash` сверяется» невозможно сделать ложно-зелёным.
 *
 * Форма sha256 при этом ВЕРНА (64 нуля), иначе отказ случился бы на форме, а не на сверке, и
 * тест стерёг бы не то.
 */
export const UNSET_HASH = '0'.repeat(64);

export function makeFixture(options: FixtureOptions = {}): Fixture {
  const frames = options.frames ?? 30;
  const ws = makeWorkspace();
  const asset = options.withAsset === false ? null : putBlob(ws, PNG_1X1, 'photo.blob');
  const font = options.withFont === true ? putBlob(ws, TTF_STUB, 'font.blob') : null;

  const clipAssets = asset === null ? [] : [{ sha256: asset.sha256, role: 'image' }];
  const clipFonts =
    font === null ? [] : [{ sha256: font.sha256, family: 'Stub Sans', role: 'body' }];

  const raw = {
    requestVersion: 1,
    ir: {
      segmentId: 'seg:a1',
      segmentDurationInFrames: frames,
      clips: [
        {
          clipId: 'r:aaaa0001',
          track: 'visual',
          z: 10,
          frames: { frameStart: 0, frameEnd: frames },
          template: options.template ?? 'solid@1',
          params: { color: '#204080' },
          assets: clipAssets,
          fonts: clipFonts,
          seeds: {},
        },
        {
          clipId: 'r:aaaa0002',
          track: 'visual',
          z: 20,
          frames: { frameStart: Math.floor(frames / 2), frameEnd: frames },
          template: options.template ?? 'solid@1',
          params: { color: '#c0502a' },
          assets: [],
          fonts: [],
          seeds: {},
        },
      ],
      captions: [
        {
          frames: { frameStart: 0, frameEnd: Math.floor(frames / 2) },
          text: 'hello world',
          tokens: [
            { text: 'hello', highlight: { frameStart: 0, frameEnd: 6 } },
            { text: 'world', highlight: null },
          ],
        },
      ],
      assets: clipAssets,
      fonts: clipFonts,
    },
    compileProfile: { fps: { num: 30, den: 1 }, width: 1080, height: 1920 },
    // render.ac4.yaml: scale 0.25 ⇒ 270×480, png, без GPU.
    pixelProfile: { browserGpu: false, scale: 0.25, imageFormat: 'png' },
    executionProfile: { workers: 1, segmentTimeoutMs: 600_000 },
    bundle: {
      path: path.join(ws.tmpDir, 'composition'),
      hash: UNSET_HASH,
      compositionId: 'seg-a1',
    },
    assets: asset === null ? [] : [{ sha256: asset.sha256, path: asset.path, role: 'image' }],
    fonts: font === null ? [] : [{ sha256: font.sha256, path: font.path, family: 'Stub Sans' }],
    outputPath: path.join(ws.outDir, 'segment.mts'),
    tmpDir: ws.tmpDir,
  };

  // ФИКСТУРА ПРОХОДИТ ЧЕРЕЗ НАСТОЯЩИЙ ВАЛИДАТОР, а не приводится кастом. Два следствия, оба
  // нужные: (1) бренд `Sha256` берётся у функции, которая его выдаёт, — кастов в тесте нет
  // (`S-01` долг №3: «у тестов исключения нет»); (2) фикстура не может тихо разъехаться с
  // формой запроса — тест, строящий невалидный вход, покраснеет здесь, а не там, где его
  // используют.
  const request = validateRequest(raw);
  return { ws, request, assetSha: asset?.sha256 ?? null, fontSha: font?.sha256 ?? null };
}

/** Точечная правка запроса в тесте: заменить одно поле, не пересобирая всё. */
export function withPatch<T>(request: SegmentRenderRequest, patch: T): SegmentRenderRequest {
  return { ...request, ...patch } as SegmentRenderRequest;
}

// ───────────────────────────────────────────────────────────────────────────────
// `H-06`: запросы ПЯТИ настоящих шаблонов.
//
// **ДОБАВЛЕНО СЮДА, А НЕ ТРЕТЬИМ ФАЙЛОМ** — долг №179 дословно: «фикстуры запроса уже живут в
// двух копиях; условие открытия — ТРЕТЬЯ копия». Расширяется первая; `cli/test/fixture.ts` не
// трогается ни строкой.
//
// ПОЧЕМУ КАРТИНКА НЕ `PNG_1X1`. Однопиксельный PNG, растянутый на кадр, даёт РОВНУЮ заливку:
// Ken Burns на ней двигает нечего — все кадры совпадают, и гейт дал бы PASS, не измерив
// движения. Это ровно ложно-зелёный долга №164, только на другом входе. Поэтому здесь
// 32×32 с диагональным градиентом поверх шахматки: у каждой пары соседних кадров наезда
// разные пиксели, и PASS означает «одинаково ВОСПРОИЗВЕЛОСЬ», а не «нечего было различать».
//
// ПОЧЕМУ ШРИФТ — НАСТОЯЩИЙ, А НЕ `TTF_STUB`. `@font-face` с 12-байтовой подделкой не
// загрузится, а `font-display: block` держит текст невидимым ~3 с и лишь потом берёт запасной
// — то есть в кадры въезжает ТАЙМЕР, и гейт мерил бы гонку загрузки шрифта. `H-02` (**R13**)
// на таком входе не измерил бы ничего. Берётся DejaVu Sans Bold — тот же временный шрифт, что
// назван решением владельца 4 (RM2).
//
// ~~Берётся СИСТЕМНЫЙ DejaVu Sans Bold~~ *(изменено: `ENV-01`, 2026-08-31 — долг №187 закрыт.)*
// **ШРИФТ ГЕЙТА ПРИЕЗЖАЕТ ФАЙЛОМ РЕПОЗИТОРИЯ, А НЕ ИЗ МАШИНЫ.** Долг №187 назвал цену
// бездействия предсказанием; переезд канала на ноут превратил её в ИЗМЕРЕНИЕ (`ENV-01`, три
// системных DejaVu на трёх машинах владельца и приёмки). Контрольный опыт в mount-namespace,
// оба теста, 40 утверждений: системного шрифта нет вовсе — **10 красных** (падает вот этот
// билдер); по системному пути лежит ДРУГОЙ валидный DejaVu — **2 красных**, и `bundle.hash`
// обоих запросов `captionEmphasis@1` уезжает (`58e06db5…` → `07eadae8…`). Второе и есть
// условие приёмной машины. Теперь байты лежат в `gate-requests/assets/` рядом с картинкой, а
// путь шрифта в файле запроса — ОТНОСИТЕЛЬНЫЙ, как у ассета: его резолвит `resolveRequestPaths`
// команды от каталога файла запроса. Долг №13 (шрифт КАНАЛА) этим не закрыт и не затронут: это
// шрифт ГЕЙТА, вход прибора, а канал с `V-06` печатает Montserrat.

/**
 * 32×32 PNG, шахматка 4×4 с диагональным градиентом. Настоящие байты, собранные
 * детерминированно (`zlib.deflateSync`, level 9) и вписанные литералом — как `PNG_1X1`.
 */
export const PNG_PATTERN_32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAAAAABWESUoAAABd0lEQVR42j3QIWsCARjH4fsoS0uzXHFBBsIwzGLRIIIghlmuuCADYVyY5YoLMhCGYZYrLshAGIZZLi0t7dOM5w2+5Sm/8OdNLi6v0qqqqk5vMOLTc/HCj8+vbyaC0+l0ElBAASM4Ho9HAQUUMILD4XAQUEABk/1+v7++ub3jffbwyNe395LVz+9fstvtdgIKKGAEZVmWAgoocBFst9utgAIKGIGRm81mYySNpJGMYL1erwUUUMAIVqvVSkABBYxguVwuBRRQwKQoisJIGkkjGSMXi8VCQAEFjCDP81xAAQWMYD6fzwUUUMDzH2az2cxIGkkjGcF0Op0KKKCAEWRZlgkooIARTCaTiYACCpiMx+OxkTSSRjJGDofDoYACChhBv9/vCyiggBF0u92ugAIKeP5Dx/UGIxhJIxlBu91uCyiggBG0Wq2WgAIKGEGz2WwKKKCASaPRaBhJI2kkY2S9Xq8LKKCAEaRpmgoooIAR1Gq1moACCij4B8NA7xDgA4pJAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * **ДВА СЛОЯ ПАРАЛЛАКСА — СИНТЕТИЧЕСКИЕ PNG 32×32 С АЛЬФОЙ** (`E-02`).
 *
 * Собраны тем же способом, что `PNG_PATTERN_32`: настоящие байты, `zlib.deflateSync` уровня 9,
 * вписаны литералом. Фотографий в `gate-requests/` нет и не будет (решение владельца `E-02`):
 * гейт мерит ВОСПРОИЗВОДИМОСТЬ шаблона, а не красоту снимка, и мегабайтный PD-файл в
 * репозитории платил бы за это клоном.
 *
 * **РАЗНИЦА МЕЖДУ ДВУМЯ КАРТИНКАМИ — НЕСУЩАЯ, А НЕ ДЕКОРАТИВНАЯ.**
 *   * ДАЛЬНИЙ (`PARALLAX_FAR_32`) непрозрачен ЦЕЛИКОМ (альфа 255 во всех 1024 пикселях). Он и
 *     есть слой, который обязан закрывать кадр с запасом под `drift`; будь у него прозрачные
 *     края, пиксельный охранник углов (`parallax-cover.test.ts`) краснел бы от самой картинки,
 *     а не от пропавшего запаса, и измерял бы не то;
 *   * БЛИЖНИЙ (`PARALLAX_NEAR_32`) — ВЫРЕЗКА: ромб в центре непрозрачен, вокруг альфа 0. Это
 *     форма, в которой приезжает настоящий слой автора (`rembg`, PNG с альфой), и без неё
 *     гейт мерил бы стопку непрозрачных прямоугольников — то есть композитинг, которого у
 *     параллакса нет.
 */
export const PARALLAX_FAR_32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABzklEQVR42sXUbUvTARTG4fMhen7QNM01dU2dU9fUOXVNnVPX1Dl1Tl1Tl6VYiqZoipZYipVYipaERERERIhIRERESERE9HV+8f8AQW/kvD4vLjjnPreYkg5hTj5MVsoRLKlHsaYdIzf9OLaME9hNJyk0n8KReRpndhIllmRc1jO4c1KoyEvFYzuL155GdUE6vqJz+B0Z1DtNBIrPEyw10+TKJOTOIlyeTVulhYjnAlGvla6qHGI1ucR9eYgm3uu3IZp4oi4f0cT7G+yIJn49UIBo4oPBQkQTH2osQjTxm80O5F+DkdBFRsNObrUWM9FewmSklNtRFzOdZcx2u7kTK2c+XsFCTyX3+zwsJS6x3O/l4bUqVgaqWR2s4cmQj/UbtWwM+3k6UsfWaD3PxxrYHg/wYuIyLyeDiCb+aqoR0cRfTzchmvibmWZEE387G0I08XdzLYgm/v5uGNHEd+ZbkYMsmf/ZrmjixnZFEzdOK5q4kSvRxI1QiyZufJRo4sY7iyZudIkcZMnsLrSxd6+dD4sRPi518Gk5yucHnXx51MXXlW6+rcYQTXz/8RVEE/++Fkc08R/rPYgm/nOjF9HEf232IZr472cJRBP/s3WVv2a7cnnxqiTyAAAAAElFTkSuQmCC',
  'base64',
);

export const PARALLAX_NEAR_32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjUlEQVR42mNgGAWjgALwbELG/wG1/Nm0lP8D4gi45XMS6O8IFMsXxdDXERiWr4ignyOwWr4uhD6OwGn5lgDaOwKv5bt8aOsIgpYf8KCdI4iy/JgLbRxBtOVnHKjvCJIsv2QzCBwx4NEw4AlxwLPigBdGA14cD3iFNOBV8oA3Sga8WTbQDdPRvsEoGPIAACGn/dpvFsfcAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Слои по порядку ГЛУБИНЫ: индекс списка = индекс роли (`layer0` — самый дальний).
 *
 * Список, а не пара именованных констант: роль строится ИНДЕКСОМ (`layerRole`), и пара имён
 * заставила бы билдер выбирать между ними условием — то есть завела бы второе место, где
 * живёт соответствие «место в глубине → байты».
 */
export const PARALLAX_LAYER_PNGS: readonly Buffer[] = [PARALLAX_FAR_32, PARALLAX_NEAR_32];

/**
 * Шрифт гейта В КАТАЛОГЕ ЗАПРОСОВ — путём ОТ НЕГО, как ассет (`ENV-01`).
 *
 * Одно значение на две роли, и потому оно одно: этой строкой файл запроса адресует шрифт
 * (`GATE_REQUEST_PATHS.font`), и по ней же билдер находит байты (`GATE_FONT_PATH`). Две копии
 * строки разошлись бы молча — запрос указывал бы на один файл, а хэш считался бы по другому.
 */
const GATE_FONT_REL = 'assets/DejaVuSans-Bold.ttf';

/** DejaVu Sans Bold ИЗ РЕПОЗИТОРИЯ — временный шрифт гейта (решение владельца 4, RM2). */
export const GATE_FONT_PATH = fileURLToPath(
  new URL(`../gate-requests/${GATE_FONT_REL}`, import.meta.url),
);
export const GATE_FONT_FAMILY = 'DejaVu Sans';

/**
 * sha256 байтов, на которых сняты ДЕСЯТЬ записей гейта.
 *
 * Величина выписана ЛИТЕРАЛОМ, а не считается с файла: посчитанная с файла, она совпала бы с
 * любыми байтами, которые в нём окажутся, — то есть не проверяла бы ничего. Здесь она
 * УТВЕРЖДЕНИЕ: «в композиции лежит тот самый шрифт, под который посчитаны `bundle.hash`».
 */
export const GATE_FONT_SHA256 =
  'd1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b';

/**
 * Читает шрифт гейта из репозитория и СВЕРЯЕТ ЕГО БАЙТЫ.
 *
 * **Отсутствие или подмена — красный тест, а не пропуск**: тот же порядок, что у браузерных
 * файлов (решение владельца `H-01`, §4 п. 2) — «зелёный, потому что не гонялось» отличается от
 * «зелёного, потому что проверено», только если это написано.
 *
 * ЗАЧЕМ СВЕРКА ЗДЕСЬ, А НЕ ТОЛЬКО В ТЕСТЕ. Испорченный байт шрифта сдвигает `bundle.hash`, и
 * без сверки это выглядело бы как расхождение ДЕСЯТИ файлов запросов с билдером — сообщение
 * про запросы там, где виноват шрифт. Отказ называет ФАЙЛ и обе величины (протокол нарушений
 * `ENV-01`, Н1).
 */
export function gateFontBytes(): Buffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(GATE_FONT_PATH);
  } catch {
    throw new Error(
      `шрифт \`${GATE_FONT_PATH}\` не найден. Гейт \`captionEmphasis@1\` требует НАСТОЯЩИЙ ` +
        'шрифт: с подделкой `font-display: block` держит текст невидимым ~3 с, и в кадры ' +
        'въезжает таймер вместо типографики. Байты лежат в репозитории (`ENV-01`, долг №187) ' +
        '— значит, файл пропал из рабочего дерева, а не из системы',
    );
  }
  const actual = sha256Hex(bytes);
  if (actual !== GATE_FONT_SHA256) {
    throw new Error(
      `байты шрифта \`${GATE_FONT_PATH}\` разошлись с объявленными: посчитано ` +
        `\`${actual}\`, объявлено \`${GATE_FONT_SHA256}\`. Под объявленными байтами сняты ` +
        'ДЕСЯТЬ записей гейта — другой шрифт означает другой `bundle.hash` и устаревшие записи',
    );
  }
  return bytes;
}

/** Клип запроса — форма `IrClip` модели; её же читает `runtime.js` (долг №168, `L-01`). */
export interface TemplateClip {
  readonly template: string;
  readonly params: Record<string, unknown>;
  readonly z: number;
  readonly withAsset?: boolean;
  readonly withFont?: boolean;
  /**
   * Сколько СЛОЁВ параллакса объявляет клип: роли `layer0`…`layer<n-1>` (`E-02`).
   *
   * Число, а не `boolean`, потому что число здесь и есть предмет: у `parallax25@1` ассетов от
   * одного до четырёх, и «сколько» — часть запроса, а не деталь фикстуры. Роли строит
   * `layerRole` СПЕКА, а не литерал: разойдись они, спек объявлял бы `layer0`, а запрос нёс
   * бы `layer_0`, и обе стороны были бы зелены поодиночке.
   */
  readonly withLayers?: number;
  /**
   * Окно клипа. По умолчанию — весь сегмент; нужен тем тестам, где окно и есть предмет.
   *
   * Форма — МОДЕЛЬНАЯ (`FrameInterval`), с `L-01`: до неё фикстура была написана по форме
   * рантайма (`{start, end}`), и это была вторая половина долга №168.
   */
  readonly window?: { readonly frameStart: number; readonly frameEnd: number };
}

export interface TemplateFixtureOptions {
  readonly frames?: number;
  /** Геометрия композиции. По умолчанию 1080×1920 — та же, что у профилей фикстуры. */
  readonly width?: number;
  readonly height?: number;
  /** `scale` пиксельного профиля: 0.25 у дешёвых прогонов, 1 у `final`. */
  readonly scale?: number;
  readonly workers?: number;
  /** Класть ли группы субтитров в IR. */
  readonly withCaptions?: boolean;
  /** Своя раскладка групп: `[кадр начала, кадр конца]` на группу. */
  readonly captionWindows?: readonly (readonly [number, number])[];
}

/** `params` пяти шаблонов — ДОСЛОВНО из `fixtures/minimal/direction/01-intro.yaml`. */
export const FIXTURE_PARAMS = {
  kenburns: {
    from: { scale: 1.0, x: 0.0, y: 0.0 },
    to: { scale: 1.12, x: 0.03, y: -0.02 },
    easing: 'power2.inOut',
  },
  flash: { strengthPct: 35, durationSamples: 4800 },
  still: { asset: 'ledger', fit: 'cover' },
  captionEmphasis: { style: 'bold' },
  /**
   * **`grade@1` — ЕДИНСТВЕННЫЙ, ЧЬИ `params` ВЗЯТЫ НЕ ИЗ ФИКСТУРЫ, И ПРИЧИНА НАЗВАНА**
   * (`E-07`). `fixtures/minimal` его не зовёт вовсе: это шаблон среза `mvp`, а фикстура —
   * Week-1, и править её задание `E-07` запрещает. Числа поэтому взяты у ЕДИНСТВЕННОЙ
   * настоящей режиссуры, которая шаблон зовёт, — `examples/vertical-v1/direction/01-archive.yaml`
   * («тёплый архив»), и это то же правило, что действовало для пяти прежних: гейт снимается
   * на той паре (шаблон, `params`), которую зовёт настоящая режиссура (ADR-0008 п. 1).
   *
   * `grain` здесь НЕ нулевой намеренно: зерно есть самая дорогая и самая сомнительная часть
   * шаблона (детерминизм `feTurbulence` в headless Chrome — `INFERENCE` до гейта), и гейт,
   * снятый без него, отвечал бы не на тот вопрос.
   */
  grade: {
    saturate: 0.85,
    contrast: 1.08,
    sepia: 0.28,
    hueRotate: -6,
    vignette: 0.35,
    grain: 0.15,
  },
  /**
   * **`parallax25@1` — ВТОРОЙ, ЧЬИ `params` ВЗЯТЫ НЕ ИЗ ФИКСТУРЫ, И ПРИЧИНА ТА ЖЕ** (`E-02`).
   * `fixtures/minimal` его не зовёт (шаблон среза `r`, а её режиссура правке не подлежит),
   * поэтому числа взяты у ЕДИНСТВЕННОЙ настоящей режиссуры, которая шаблон зовёт, —
   * `examples/vertical-v1/direction/01-archive.yaml`, сцена «улица 1900». Правило то же, что
   * действовало для шести прежних: гейт снимается на той паре (шаблон, `params`), которую
   * зовёт настоящая режиссура (ADR-0008 п. 1).
   *
   * `layers` здесь — ДВА alias'а демо, и это не украшение: длина списка есть число слоёв, то
   * есть главный вход цены шаблона. Сами alias'ы в рендерере не читаются (ассеты приезжают в
   * IR уже разрешёнными, по ролям), но написать вместо них `['a', 'b']` значило бы снять гейт
   * на паре, которой никто не зовёт.
   *
   * `scale: 1.04` — «дыхание» есть намеренно: это второй вход в расчёт запаса покрытия кадра
   * (`worstScale` реализации), и гейт, снятый без него, отвечал бы не на тот вопрос.
   */
  parallax25: {
    layers: ['street', 'street-figure'],
    drift: 0.05,
    depthSpread: 2.4,
    easing: 'power2.inOut',
    scale: 1.04,
  },
} as const;

/**
 * Запрос ИЗ ПРОИЗВОЛЬНЫХ КЛИПОВ — вход живого гейта `H-06`.
 *
 * `params` берутся из фикстуры проекта, а не выдумываются: гейт снимается на той паре
 * (шаблон, `params`), которую зовёт настоящая режиссура (ADR-0008 п. 1, «зафиксированные
 * `params`»). Геометрия по умолчанию — 1080×1920 `compileProfile` фикстуры; `scale` подаётся
 * вызывающим, потому что он и есть разница между `draftHalf` и `final`.
 */
export function makeTemplateFixture(
  clips: readonly TemplateClip[],
  options: TemplateFixtureOptions = {},
): Fixture {
  const frames = options.frames ?? 12;
  const ws = makeWorkspace();
  const asset = putBlob(ws, PNG_PATTERN_32, 'pattern.blob');
  const font = putBlob(ws, gateFontBytes(), 'font.blob');
  // Слои параллакса кладутся ВСЕГДА, но в запрос попадают только по требованию клипа: два
  // лишних файла во временном каталоге ничего не стоят, а ветвление на `putBlob` стоило бы
  // второго места, где живёт список байтов.
  const layerBlobs = PARALLAX_LAYER_PNGS.map((bytes, index) =>
    putBlob(ws, bytes, `parallax-${String(index)}.blob`),
  );

  const assetRef = { sha256: asset.sha256, role: 'asset' };
  const fontRef = { sha256: font.sha256, family: GATE_FONT_FAMILY, role: 'caption' };
  /** Ссылки слоёв клипа: роль строит `layerRole` СПЕКА (см. `TemplateClip.withLayers`). */
  const layerRefsOf = (count: number): { sha256: string; role: string }[] =>
    Array.from({ length: count }, (_, index) => {
      const blob = layerBlobs[index];
      if (blob === undefined) {
        throw new Error(
          `фикстура несёт ${String(layerBlobs.length)} байтовых слоя, а клип просит ` +
            `${String(count)}. Больше слоёв — больше литералов в этом файле, а не «повторим ` +
            'первый»: два одинаковых слоя дали бы гейт, на котором глубину нечем отличить от ' +
            'её отсутствия',
        );
      }
      return { sha256: blob.sha256, role: layerRole(index) };
    });

  const usesAsset = clips.some((c) => c.withAsset === true);
  const usesFont = clips.some((c) => c.withFont === true);
  /** Все роли слоёв, встреченные в клипах, — по одной ссылке на роль, порядок ролей. */
  const layerRefs = layerRefsOf(
    clips.reduce((most, clip) => (clip.withLayers !== undefined && clip.withLayers > most ? clip.withLayers : most), 0),
  );

  const raw = {
    requestVersion: 1,
    ir: {
      segmentId: 'seg:h06',
      segmentDurationInFrames: frames,
      clips: clips.map((clip, i) => ({
        clipId: `r:h060${String(i + 1).padStart(3, '0')}`,
        track: 'visual',
        z: clip.z,
        frames: clip.window ?? { frameStart: 0, frameEnd: frames },
        template: clip.template,
        params: clip.params,
        assets:
          clip.withLayers === undefined
            ? clip.withAsset === true
              ? [assetRef]
              : []
            : layerRefsOf(clip.withLayers),
        fonts: clip.withFont === true ? [fontRef] : [],
        seeds: {},
      })),
      captions:
        options.withCaptions === true
          ? (
              options.captionWindows ?? [
                [0, Math.floor(frames / 2)],
                [Math.floor(frames / 2), frames],
              ]
            ).map(([start, end], i) => ({
              frames: { frameStart: start, frameEnd: end },
              text: i === 0 ? 'the ledger' : 'and the sea',
              tokens:
                i === 0
                  ? [
                      { text: 'the', highlight: null },
                      { text: 'ledger', highlight: { frameStart: start, frameEnd: end } },
                    ]
                  : [
                      // Слова группы ОБЯЗАНЫ складываться в её `text` через пробел: это
                      // гарантия входа (`compile/src/timeline/captions.ts`, `textOf`), и с
                      // `H-07` `runtime.js` её ПРОВЕРЯЕТ — без пословной разметки эмфаза
                      // активного слова невыразима. До `H-07` здесь стоял один токен `sea`
                      // на текст «and the sea»: прибор врал о форме входа, а не измерял её.
                      { text: 'and', highlight: null },
                      { text: 'the', highlight: null },
                      { text: 'sea', highlight: null },
                    ],
            }))
          : [],
      assets: [...(usesAsset ? [assetRef] : []), ...layerRefs],
      fonts: usesFont ? [fontRef] : [],
    },
    compileProfile: {
      fps: { num: 30, den: 1 },
      width: options.width ?? 1080,
      height: options.height ?? 1920,
    },
    pixelProfile: {
      browserGpu: false,
      scale: options.scale ?? 0.25,
      imageFormat: 'png',
    },
    executionProfile: { workers: options.workers ?? 1, segmentTimeoutMs: 900_000 },
    bundle: {
      path: path.join(ws.tmpDir, 'composition'),
      hash: UNSET_HASH,
      compositionId: 'seg-h06',
    },
    assets: [
      ...(usesAsset ? [{ sha256: asset.sha256, path: asset.path, role: 'asset' }] : []),
      ...layerRefs.map((ref, index) => ({
        sha256: ref.sha256,
        path: layerBlobs[index]?.path ?? '',
        role: ref.role,
      })),
    ],
    fonts: usesFont ? [{ sha256: font.sha256, path: font.path, family: GATE_FONT_FAMILY }] : [],
    outputPath: path.join(ws.outDir, 'segment.mts'),
    tmpDir: ws.tmpDir,
  };

  const request = validateRequest(raw);
  return { ws, request, assetSha: asset.sha256, fontSha: font.sha256 };
}

/**
 * Запрос с ВЕРНЫМ `bundle.hash`.
 *
 * Хэш каталога композиции считает материализация, поэтому подставить его может только тот,
 * кто каталог уже построил. Приём — пробный прогон с подставным запускателем: рендера нет,
 * отказ по `bundle.hash` есть, и в его тексте лежит фактический хэш. Тот же приём, что в
 * `render.test.ts` и `gate-render.test.ts`; вынесен сюда, потому что его зовут ДВА браузерных
 * файла `H-06`, а импорт из `*.test.ts` прогнал бы чужие `describe` второй раз.
 */
export async function readyRequest(
  request: SegmentRenderRequest,
  registry = rendererTemplates,
): Promise<SegmentRenderRequest> {
  const probe = await renderSegment(request, {
    clock: (() => {
      let t = 0;
      return () => (t += 10);
    })(),
    gate: {
      mode: 'skip',
      why: 'подготовка запроса к гейту `H-06`: считается `bundle.hash`, рендера ещё не было',
    },
    registry,
    spawnRenderer: () => Promise.resolve(0),
  });
  if (probe.ok) throw new Error('ожидался отказ по `bundle.hash`');
  const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
  if (hash === undefined) throw new Error(probe.error.message);
  return validateRequest(withPatch(request, { bundle: { ...request.bundle, hash } }));
}

// ───────────────────────────────────────────────────────────────────────────────
// `GATE-PREP`: ВОСЕМЬ ЗАПРОСОВ ГЕЙТА — ФАЙЛАМИ РЕПОЗИТОРИЯ.
//
// **ЗАЧЕМ.** До этой задачи запросы гейта существовали только как КОД: `templates-gate.test.ts`
// строил их в памяти и звал `runGate` мимо команды. Владелец снимает записи гейта командой
// `vpe template gate --request <файл>` — значит файл обязан существовать, иначе каждый ручной
// гейт начинается с сочинения запроса заново, и сочинённый разъедется с измеренным.
//
// **ЕДИНСТВЕННЫЙ ИСТОЧНИК — ЭТОТ ФАЙЛ** (долг №179: третьей копии фикстуры не заводится).
// Файлы в `gate-requests/` — ПРОИЗВОДНЫЕ: их порождает `buildGateRequestFile`, сверяет
// побайтово `test/gate-requests.test.ts`, а правка билдера без перегенерации красит его.
//
// **ПУТИ В ФАЙЛЕ ОТНОСИТЕЛЬНЫЕ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА, А НЕ УДОБСТВО.** `validateRequest`
// требует абсолютных путей — но абсолютный путь в коммиченном файле привязал бы запросы к
// ОДНОМУ чекауту: владелец работает с двух машин, и на второй побайтовая сверка была бы
// красной, а runbook — неисполнимым. Поэтому команда резолвит относительные пути от каталога
// САМОГО ФАЙЛА ЗАПРОСА (`resolveRequestPaths` в `cli/src/template-gate.ts`, правка по
// разрешению владельца `GATE-PREP`), и в `validateRequest` уходят уже абсолютные.
// Исключение — шрифт: он системный и абсолютный по построению (долг №187).

/** Один случай гейта: НАЗВАННЫЙ шаблон и клипы, которыми он снимается. */
export interface GateRequestCase {
  /** Имя вызова, по которому пишется запись гейта. */
  readonly call: string;
  readonly clips: readonly TemplateClip[];
  readonly captions: boolean;
}

/**
 * ~~Четыре~~ ~~пять~~ **ШЕСТЬ** визуальных шаблонов *(дополнено: `E-07` — `grade@1`; `E-02` —
 * `parallax25@1`)*. `bed@1` СЮДА НЕ
 * ВХОДИТ — гейт на нём неисполним по построению (долг №189): он аудио-домена, в
 * `RenderIR.clips` не попадает, а его реализация есть отказ.
 *
 * `kenburns@1` — СМЕШАННЫЙ запрос (`still@1` основанием, поправка владельца П2 `H-06`):
 * шаблон двигает слой НИЖЕ себя, и запрос из одних `kenburns@1` вырожден. Охранник команды
 * такой запрос пропускает с `FIX-01` (долг №181 закрыт).
 *
 * **`grade@1` — ТОЖЕ СМЕШАННЫЙ, И ПО ТОЙ ЖЕ ПРИЧИНЕ.** Он красит `backdrop`, то есть то, что
 * лежит НИЖЕ него; над пустотой backdrop пуст, и гейт мерил бы воспроизводимость ничего —
 * ровно ложно-зелёный долга №164 в третий раз. Основанием стоит тот же `still@1` с той же
 * картинкой 32×32, что и у `kenburns@1`: у грейда обязано быть, что грейдить.
 *
 * **`parallax25@1` — НЕ СМЕШАННЫЙ, И ЭТО РАЗНИЦА ПО СУЩЕСТВУ, А НЕ ПО ВКУСУ** (`E-02`). Двум
 * шаблонам выше основание нужно потому, что своих ассетов у них нет: один двигает соседа
 * снизу, другой красит backdrop. У параллакса ассеты СВОИ — два слоя, объявленные
 * `declareAssets`, — и `still@1` под ним не дал бы гейту ничего, кроме лишнего клипа в
 * измеряемой композиции. Клип одиночный, `withLayers: 2`. Шаблонов стало ШЕСТЬ.
 */
export const GATE_REQUEST_CASES: readonly GateRequestCase[] = [
  {
    call: 'still@1',
    clips: [{ template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true }],
    captions: false,
  },
  {
    call: 'kenburns@1',
    clips: [
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      { template: 'kenburns@1', params: FIXTURE_PARAMS.kenburns, z: 10 },
    ],
    captions: false,
  },
  {
    call: 'flash@1',
    clips: [{ template: 'flash@1', params: FIXTURE_PARAMS.flash, z: 20 }],
    captions: false,
  },
  {
    call: 'captionEmphasis@1',
    clips: [
      {
        template: 'captionEmphasis@1',
        params: FIXTURE_PARAMS.captionEmphasis,
        z: 30,
        withFont: true,
      },
    ],
    captions: true,
  },
  {
    call: 'grade@1',
    clips: [
      { template: 'still@1', params: FIXTURE_PARAMS.still, z: 0, withAsset: true },
      { template: 'grade@1', params: FIXTURE_PARAMS.grade, z: 25 },
    ],
    captions: false,
  },
  {
    call: 'parallax25@1',
    clips: [
      { template: 'parallax25@1', params: FIXTURE_PARAMS.parallax25, z: 10, withLayers: 2 },
    ],
    captions: false,
  },
];

/** Профиль пары: то, чем `draftHalf` отличается от `final` в ЗАПРОСЕ. */
export interface GateRequestProfile {
  readonly profileId: string;
  /** `scale` — из yaml-профиля гейта, а не из тестовых чисел `H-06`: команда их СВЕРЯЕТ (**K4**). */
  readonly scale: number;
  readonly workers: number;
  readonly frames: number;
}

/**
 * Два профиля гейта. Числа — не выдумка:
 *
 * * `scale` и `workers` дословно из `gate-profiles/draftHalf.yaml` и
 *   `fixtures/minimal/profiles/render.final.yaml`. `scale: 0.5` (а не 0.25 из
 *   `templates-gate.test.ts`) — потому что команда сверяет тройку **K4** запроса с yaml, а
 *   тест звал `runGate` напрямую и сверки не проходил.
 * * кадры — как в живых тестах `H-06`: 12 у `draftHalf` (0.4 с при 30 fps) и 6 у `final`
 *   (там в шестнадцать раз больше пикселей на кадр и N = 10 вместо 3).
 */
export const GATE_REQUEST_PROFILES: readonly GateRequestProfile[] = [
  { profileId: 'draftHalf', scale: 0.5, workers: 4, frames: 12 },
  { profileId: 'final', scale: 1, workers: 4, frames: 6 },
];

/**
 * Пути ФАЙЛА запроса. Относительные — от каталога файла (см. шапку раздела).
 *
 * ~~Настоящий здесь ровно один — `asset`~~ *(изменено: `ENV-01`, 2026-08-31.)* **Настоящих
 * теперь ДВА — `asset` и `font`**, и оба относительные: шрифт переехал в репозиторий и
 * адресуется точно так же, как картинка (долг №187 закрыт). Остальные три ПЛЕЙСХОЛДЕРЫ: гейт
 * перекрывает `tmpDir`, `outputPath` и `bundle.path` под своим `runRoot` (`requestForRun` в
 * `src/gate.ts`), поэтому их значения в файле не читает никто, кроме валидатора формы. Имя
 * `.gate-run` выбрано говорящим, а `outputPath` вынесен ИЗ `tmpDir` — **R2** этого требует.
 *
 * Долг №192 (три плейсхолдера видны только по имени каталога) правкой НЕ закрыт и не сужен:
 * он про `tmpDir`/`outputPath`/`bundle.path`, а изменилось четвёртое поле. Его вторая половина
 * — «плюс абсолютный системный шрифт» — с этой правки неверна, и строка долга это говорит.
 *
 * *(дополнено: `E-02`, 2026-08-31.)* **Настоящих файлов стало ЧЕТЫРЕ** — картинка, шрифт и два
 * слоя параллакса. Путь слоя выбирается ПО РОЛИ, а не по порядку списка `assets` в запросе
 * (`relPathForRole` ниже). Порядок в запросе задаёт билдер, и сегодня он совпадает с порядком
 * глубины, — но опереться на это значило бы связать имя файла с местом в массиве и молча
 * перепутать дальний слой с ближним на первой же перестановке.
 */
export const GATE_REQUEST_PATHS = {
  asset: 'assets/pattern-32.png',
  /** Слои параллакса — по одному пути на РОЛЬ, порядок глубины (`E-02`). */
  layers: ['assets/parallax-far-32.png', 'assets/parallax-near-32.png'],
  font: GATE_FONT_REL,
  tmpDir: '.gate-run/tmp',
  bundlePath: '.gate-run/tmp/composition',
  outputPath: '.gate-run/segment.mts',
} as const;

/**
 * Относительный путь файла ассета ПО ЕГО РОЛИ — единственное место, где роль становится именем.
 *
 * Отказ на незнакомой роли, а не «положим рядом с картинкой»: путь, выбранный умолчанием, дал
 * бы файл запроса, который резолвится и указывает не на те байты, — то есть `bundle.hash`,
 * посчитанный по одной картинке, и гейт, снятый по другой.
 */
export function relPathForRole(role: string): string {
  if (role === 'asset') return GATE_REQUEST_PATHS.asset;
  const found = GATE_REQUEST_PATHS.layers.find((_, index) => layerRole(index) === role);
  if (found !== undefined) return found;
  throw new Error(
    `роль ассета \`${role}\` не имеет файла в \`gate-requests/\`. Роли объявляют СПЕКИ ` +
      '(`declaredAssets`), а файлы кладёт этот билдер — новая роль означает новый файл, а не ' +
      'путь по умолчанию: умолчание дало бы запрос, который резолвится и указывает не на те байты',
  );
}

/** Каталог файлов запросов — от исходника фикстуры, а не от `cwd`. */
export function gateRequestsDir(): string {
  return fileURLToPath(new URL('../gate-requests', import.meta.url));
}

/** Имя файла запроса: `<шаблон>.<профиль>.json`, например `still@1.draftHalf.json`. */
export function gateRequestFileName(kase: GateRequestCase, profile: GateRequestProfile): string {
  return `${kase.call}.${profile.profileId}.json`;
}

/**
 * **ПОРОЖДЕНИЕ ФАЙЛА ЗАПРОСА** — билдер, `bundle.hash` измерением, `canonicalJson`.
 *
 * `bundle.hash` не выдумывается и не копируется: его считает МАТЕРИАЛИЗАЦИЯ (`readyRequest`),
 * то есть тот же код, который построит каталог композиции при живом гейте. Браузера здесь нет
 * — `spawnRenderer` подставной, отказ по `bundle.hash` наступает до запуска рендерера.
 *
 * Сериализация — `canonicalJson`, а не `JSON.stringify`: файл лежит в git, и две формы записи
 * одного факта дали бы два диффа на одно измерение (ADR-0007 §3).
 */
export async function buildGateRequestFile(
  kase: GateRequestCase,
  profile: GateRequestProfile,
): Promise<string> {
  const fixture = makeTemplateFixture([...kase.clips], {
    frames: profile.frames,
    scale: profile.scale,
    workers: profile.workers,
    withCaptions: kase.captions,
  });
  const request = await readyRequest(fixture.request);
  const file = {
    ...request,
    tmpDir: GATE_REQUEST_PATHS.tmpDir,
    outputPath: GATE_REQUEST_PATHS.outputPath,
    bundle: { ...request.bundle, path: GATE_REQUEST_PATHS.bundlePath },
    assets: request.assets.map((asset) => ({ ...asset, path: relPathForRole(asset.role) })),
    fonts: request.fonts.map((font) => ({ ...font, path: GATE_REQUEST_PATHS.font })),
  };
  return `${canonicalJson(file)}\n`;
}
