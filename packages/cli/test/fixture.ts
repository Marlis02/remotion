// Фикстура тестов команды: запрос гейта файлом + `render-profile/1` файлом + tmp-каталоги.
//
// ПОЧЕМУ ОНА СВОЯ, А НЕ ОБЩАЯ С `renderer-hyperframes/test/fixture.ts`. Общая потребовала бы
// импорта ЧЕРЕЗ границу пакета в тестовую зону чужого `rootDir` — `tsc --build` такой импорт
// не собирает (файл вне `rootDir` проекта), а тянуть тестовые файлы в публичную поверхность
// пакета ради этого нельзя: они не часть контракта. Цена — вторая фикстура запроса в
// репозитории; она названа долгом, а не спрятана.
//
// ЗАПРОС ПРОХОДИТ НАСТОЯЩИЙ `validateRequest` (в самой команде, не здесь): числа взяты
// дешёвые (270×480 при `scale: 0.25`), потому что юнитам команды рендер не нужен вовсе —
// гейт у них подменён.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Каталог tmp с меткой задачи: всё, что пишут тесты, живёт под `os.tmpdir()`. */
export function tempDir(tag: string): string {
  return mkdtempSync(path.join(tmpdir(), `vpe-e00-${tag}-`));
}

export const UNSET_HASH = '0'.repeat(64);

export interface RequestOptions {
  /** Имя вызова шаблона во ВСЕХ клипах. */
  readonly template?: string;
  /** Имя вызова второго клипа — для охранника «запрос зовёт чужой шаблон». */
  readonly second?: string;
  readonly frames?: number;
  readonly bundleHash?: string;
  readonly scale?: number;
  readonly imageFormat?: string;
}

/** Тело запроса рендерера — ровно та форма, что у `SegmentRenderRequest` (ADR-0008). */
export function makeRequest(root: string, options: RequestOptions = {}): unknown {
  const frames = options.frames ?? 6;
  const template = options.template ?? 'still@1';
  const tmp = path.join(root, 'tmp');
  const out = path.join(root, 'out');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(out, { recursive: true });

  const clipOf = (id: string, call: string, start: number): unknown => ({
    clipId: id,
    track: 'visual',
    z: 10,
    frames: { start, end: frames },
    template: call,
    params: { color: '#204080' },
    assets: [],
    fonts: [],
    seeds: {},
  });

  return {
    requestVersion: 1,
    ir: {
      segmentId: 'seg:e00',
      segmentDurationInFrames: frames,
      clips: [
        clipOf('r:e0000001', template, 0),
        clipOf('r:e0000002', options.second ?? template, Math.floor(frames / 2)),
      ],
      captions: [],
      assets: [],
      fonts: [],
    },
    compileProfile: { fps: { num: 30, den: 1 }, width: 1080, height: 1920 },
    pixelProfile: {
      browserGpu: false,
      scale: options.scale ?? 0.25,
      imageFormat: options.imageFormat ?? 'png',
    },
    executionProfile: { workers: 1, segmentTimeoutMs: 600_000 },
    bundle: {
      path: path.join(tmp, 'composition'),
      hash: options.bundleHash ?? UNSET_HASH,
      compositionId: 'seg-e00',
    },
    assets: [],
    fonts: [],
    outputPath: path.join(out, 'segment.mts'),
    tmpDir: tmp,
  };
}

/** Кладёт запрос файлом и возвращает путь. */
export function writeRequest(root: string, options: RequestOptions = {}): string {
  const file = path.join(root, 'request.json');
  writeFileSync(file, JSON.stringify(makeRequest(root, options)), 'utf8');
  return file;
}

export interface ProfileOptions {
  readonly profileId?: string;
  readonly scale?: number;
  readonly imageFormat?: string;
  readonly threads?: number;
}

/**
 * `render-profile/1` файлом — НАСТОЯЩИЙ, он проходит `RenderProfileSchema`.
 *
 * Числа — с `fixtures/minimal/profiles/render.final.yaml`, кроме `profileId` и `scale`:
 * гейт тестов снимается на `draftHalf` (N = 3, дешевле) и на четверти кадра.
 */
export function writeRenderProfile(root: string, options: ProfileOptions = {}): string {
  const file = path.join(root, 'render.test.yaml');
  writeFileSync(
    file,
    [
      'schema: render-profile/1',
      `profileId: ${options.profileId ?? 'draftHalf'}`,
      'pixelProfile:',
      '  browserGpu: false',
      `  imageFormat: ${options.imageFormat ?? 'png'}`,
      `  scale: ${String(options.scale ?? 0.25)}`,
      '  colorSpace: bt709',
      '  pixelFormat: yuv420p',
      '  codec: h264',
      '  crf: 18',
      '  gopSize: 30',
      '  encoder:',
      `    threads: ${String(options.threads ?? 1)}`,
      '    preset: medium',
      '    tune: none',
      '    rcLookahead: 40',
      '    aqMode: 1',
      '    psy: 1',
      '    bitexact: true',
      'executionProfile:',
      '  workers: 1',
      '  chapterParallelism: 1',
      '  segmentTimeoutMs: 900000',
      '',
    ].join('\n'),
    'utf8',
  );
  return file;
}
