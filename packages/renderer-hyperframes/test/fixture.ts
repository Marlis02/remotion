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
          frames: { start: 0, end: frames },
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
          frames: { start: Math.floor(frames / 2), end: frames },
          template: options.template ?? 'solid@1',
          params: { color: '#c0502a' },
          assets: [],
          fonts: [],
          seeds: {},
        },
      ],
      captions: [
        {
          frames: { start: 0, end: Math.floor(frames / 2) },
          text: 'hello world',
          tokens: [
            { text: 'hello', highlight: { start: 0, end: 6 } },
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
// на таком входе не измерил бы ничего. Берётся системный DejaVu Sans Bold — тот же временный
// шрифт, что назван решением владельца 4 (RM2). Долг заведён: когда шрифт канала выбран
// (№13, `M-02`), он обязан приезжать записью проекта, а не из `/usr/share/fonts`.

/**
 * 32×32 PNG, шахматка 4×4 с диагональным градиентом. Настоящие байты, собранные
 * детерминированно (`zlib.deflateSync`, level 9) и вписанные литералом — как `PNG_1X1`.
 */
export const PNG_PATTERN_32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAAAAABWESUoAAABd0lEQVR42j3QIWsCARjH4fsoS0uzXHFBBsIwzGLRIIIghlmuuCADYVyY5YoLMhCGYZYrLshAGIZZLi0t7dOM5w2+5Sm/8OdNLi6v0qqqqk5vMOLTc/HCj8+vbyaC0+l0ElBAASM4Ho9HAQUUMILD4XAQUEABk/1+v7++ub3jffbwyNe395LVz+9fstvtdgIKKGAEZVmWAgoocBFst9utgAIKGIGRm81mYySNpJGMYL1erwUUUMAIVqvVSkABBYxguVwuBRRQwKQoisJIGkkjGSMXi8VCQAEFjCDP81xAAQWMYD6fzwUUUMDzH2az2cxIGkkjGcF0Op0KKKCAEWRZlgkooIARTCaTiYACCpiMx+OxkTSSRjJGDofDoYACChhBv9/vCyiggBF0u92ugAIKeP5Dx/UGIxhJIxlBu91uCyiggBG0Wq2WgAIKGEGz2WwKKKCASaPRaBhJI2kkY2S9Xq8LKKCAEaRpmgoooIAR1Gq1moACCij4B8NA7xDgA4pJAAAAAElFTkSuQmCC',
  'base64',
);

/** Системный DejaVu Sans Bold — временный шрифт проекта (решение владельца 4, RM2). */
export const SYSTEM_FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
export const SYSTEM_FONT_FAMILY = 'DejaVu Sans';

/**
 * Читает системный шрифт. **Отсутствие — красный тест, а не пропуск**: тот же порядок, что у
 * браузерных файлов (решение владельца `H-01`, §4 п. 2) — «зелёный, потому что не гонялось»
 * отличается от «зелёный, потому что проверено», только если это написано.
 */
export function systemFontBytes(): Buffer {
  try {
    return readFileSync(SYSTEM_FONT_PATH);
  } catch {
    throw new Error(
      `шрифт \`${SYSTEM_FONT_PATH}\` не найден. Гейт \`captionEmphasis@1\` требует НАСТОЯЩИЙ ` +
        'шрифт: с подделкой `font-display: block` держит текст невидимым ~3 с, и в кадры ' +
        'въезжает таймер вместо типографики',
    );
  }
}

/** Клип запроса — форма `RenderIrClip`, как её читает `runtime.js`. */
interface TemplateClip {
  readonly template: string;
  readonly params: Record<string, unknown>;
  readonly z: number;
  readonly withAsset?: boolean;
  readonly withFont?: boolean;
  /** Окно клипа. По умолчанию — весь сегмент; нужен тем тестам, где окно и есть предмет. */
  readonly window?: { readonly start: number; readonly end: number };
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
  const font = putBlob(ws, systemFontBytes(), 'font.blob');

  const assetRef = { sha256: asset.sha256, role: 'asset' };
  const fontRef = { sha256: font.sha256, family: SYSTEM_FONT_FAMILY, role: 'caption' };

  const usesAsset = clips.some((c) => c.withAsset === true);
  const usesFont = clips.some((c) => c.withFont === true);

  const raw = {
    requestVersion: 1,
    ir: {
      segmentId: 'seg:h06',
      segmentDurationInFrames: frames,
      clips: clips.map((clip, i) => ({
        clipId: `r:h060${String(i + 1).padStart(3, '0')}`,
        track: 'visual',
        z: clip.z,
        frames: clip.window ?? { start: 0, end: frames },
        template: clip.template,
        params: clip.params,
        assets: clip.withAsset === true ? [assetRef] : [],
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
              frames: { start, end },
              text: i === 0 ? 'the ledger' : 'and the sea',
              tokens:
                i === 0
                  ? [
                      { text: 'the', highlight: null },
                      { text: 'ledger', highlight: { start, end } },
                    ]
                  : [{ text: 'sea', highlight: null }],
            }))
          : [],
      assets: usesAsset ? [assetRef] : [],
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
    assets: usesAsset ? [{ sha256: asset.sha256, path: asset.path, role: 'asset' }] : [],
    fonts: usesFont ? [{ sha256: font.sha256, path: font.path, family: SYSTEM_FONT_FAMILY }] : [],
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
