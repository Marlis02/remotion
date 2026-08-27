// Синтетический запрос для тестов адаптера: минимальный, но НАСТОЯЩИЙ.
//
// `fixtures/minimal` здесь не читается ни символом (закрытая зона задания `H-01`) — образец
// `V-03`/`CP-03`: проект строится тестом во временном каталоге. Числа взяты из
// `fixtures/minimal/profiles/render.ac4.yaml` и `compile.yaml` как ДЕШЁВЫЙ набор пиксельных
// полей (270×480, `workers: 1`), а не как гейт: гейта шаблона V13 на профиле `ac4` нет и не
// заводится (решение владельца 12, RM1; строка R12 в docs/invariants.md).

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SegmentRenderRequest } from '../src/contract.js';
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
