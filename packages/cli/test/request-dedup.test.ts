// **ОДИН ФАЙЛ В ДВУХ РОЛЯХ: КОМПИЛЯТОР ОБЪЯВЛЯЕТ ПАРЫ, АДАПТЕР ТРЕБУЕТ УНИКАЛЬНЫЙ SHA.**
//
// Охранник примирения (`E-02`, решение владельца — вариант «а»). Браузера здесь нет: рендерер
// не запускается, предмет — СБОРКА ЗАПРОСА из IR.
//
// ЧТО ЗА СТОЛКНОВЕНИЕ. Две стороны границы написали своё намерение словами, и они
// противоположны:
//   * `compile/src/render-ir/build.ts` (`unionOfRefs`): «ДЕДУПЛИКАЦИЯ ПО ПАРЕ, А НЕ ПО SHA:
//     один файл в двух ролях — две строки, потому что роль есть часть того, что просит
//     шаблон»;
//   * `renderer-hyperframes/src/validate.ts`: «sha256 уже объявлен в `assets[0]`. Два имени у
//     одного блоба означали бы два файла в каталоге композиции с одинаковым содержимым — и
//     второй вход в `compositionHash`».
//
// ДО `parallax25@1` ПРОТИВОРЕЧИЕ СПАЛО: ни один шаблон не просил один файл в двух ролях.
// Параллакс — первый, кто просит, и просит на штатном входе: дальний слой = сам оригинал
// (решение владельца `E-02`, В2 «а»), а `[img: alias]` той же сцены даёт `still@1` на тот же
// блоб. ИЗМЕРЕНО живой сборкой демо: `assets[1].sha256 — sha256 8e6317a2… уже объявлен в
// assets[0]`, сегмент `seg:work` не собирается.
//
// **ЗАЧЕМ ЭТОТ ФАЙЛ.** Правка без охранника — это правка, которая снова заснёт: сегодня
// столкновение даёт красную сборку демо, а завтра кто-нибудь вернёт `input.ir.assets` на
// место, и все юниты останутся зелёными, потому что ни одна фикстура репозитория одного
// блоба в двух ролях не строит. Здесь такой IR строится НАМЕРЕННО.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { asSha256, type Sha256 } from '@vpe/schema';
import { validateRequest } from '@vpe/renderer-hyperframes';
import { rendererTemplates } from '@vpe/renderer-hyperframes';

import { buildRequest } from '../src/build-stages/render.js';
import { tempDir } from './fixture.js';

/** Профиль рендера — ровно те поля, которые читает сборка запроса. */
const RENDER_PROFILE = {
  schema: 'render-profile/1',
  profileId: 'final',
  pixelProfile: { browserGpu: false, scale: 1, imageFormat: 'png' },
  executionProfile: { workers: 1, segmentTimeoutMs: 900_000 },
} as unknown as Parameters<typeof buildRequest>[0]['renderProfile'];

const COMPILE_PROFILE = { fps: { num: 30, den: 1 }, width: 1080, height: 1920 };

/** Настоящие байты: `store.path` отдаёт файл, а `materializeComposition` его читает. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Бренд берётся у КОНСТРУКТОРА, а не кастом: у тестов исключения нет (`S-01`, долг №3), и
// греп-охранник `tests/lints/brand-casts.test.ts` ловит `as Sha256` в любом файле репозитория.
const FAR = asSha256('a'.repeat(64));
const NEAR = asSha256('b'.repeat(64));

/** CAS-двойник: кладёт байты по sha и отдаёт путь. Ничего, кроме `path`, сборка не зовёт. */
function storeOf(root: string): Parameters<typeof buildRequest>[0]['store'] {
  const dir = path.join(root, 'store');
  mkdirSync(dir, { recursive: true });
  for (const sha of [FAR, NEAR]) writeFileSync(path.join(dir, sha), PNG_1X1);
  // Функция объявлена ОТДЕЛЬНО от каста: селектор `TSAsExpression TSTypeReference` из
  // `eslint.config.js` смотрит на всё поддерево утверждения, и аннотация `sha: Sha256`
  // внутри объектного литерала считалась бы снятым брендом (`S-01` долг №3), хотя это
  // объявление типа, а не каст. Вне утверждения аннотация сохраняется как есть.
  const pathOf = (sha: Sha256): Promise<string> => Promise.resolve(path.join(dir, sha));
  return { path: pathOf } as unknown as Parameters<typeof buildRequest>[0]['store'];
}

/**
 * IR сегмента, в котором ОДИН блоб стоит в ДВУХ ролях — ровно то, что порождает `unionOfRefs`
 * на сцене демо: `still@1` от `[img:]` берёт снимок ролью `asset`, `parallax25@1` берёт его же
 * ролью `layer0` дальним планом, а ближним — вырезку.
 *
 * Порядок `assets` — сортировка по `(sha256, role)`, как у компилятора: список здесь обязан
 * быть тем же, что приедет живьём, иначе охранник стерёг бы форму, которой не бывает.
 */
function irWithSharedBlob(): Parameters<typeof buildRequest>[0]['ir'] {
  const frames = { frameStart: 0, frameEnd: 6 };
  return {
    segmentId: 'seg:e02',
    segmentDurationInFrames: 6,
    clips: [
      {
        clipId: 'img:b:img-photo-1',
        track: 'visual',
        z: 0,
        frames,
        template: 'still@1',
        params: { asset: 'photo' },
        assets: [{ sha256: FAR, role: 'asset' }],
        fonts: [],
        seeds: {},
      },
      {
        clipId: 'r:e0200001',
        track: 'visual',
        z: 10,
        frames,
        template: 'parallax25@1',
        params: {
          layers: ['photo', 'photo-figure'],
          drift: 0.045,
          depthSpread: 2.6,
          easing: 'power2.inOut',
          scale: 1.06,
        },
        assets: [
          { sha256: FAR, role: 'layer0' },
          { sha256: NEAR, role: 'layer1' },
        ],
        fonts: [],
        seeds: {},
      },
    ],
    captions: [],
    // Пары `(sha, role)` — три строки на ДВА файла. Это и есть вход столкновения.
    assets: [
      { sha256: FAR, role: 'asset' },
      { sha256: FAR, role: 'layer0' },
      { sha256: NEAR, role: 'layer1' },
    ],
    fonts: [],
  } as unknown as Parameters<typeof buildRequest>[0]['ir'];
}

describe('`E-02` — один блоб в двух ролях: IR перечисляет ССЫЛКИ, запрос — ФАЙЛЫ', () => {
  it('запрос несёт блоб ОДИН раз, `validateRequest` принимает, роли клипов целы', async () => {
    const root = tempDir('e02-dedup');
    const ir = irWithSharedBlob();

    // 0. ВХОД ТОТ САМЫЙ: три ссылки на два файла. Проверяется здесь, а не подразумевается, —
    //    иначе тест мог бы стать зелёным от того, что фикстура перестала строить столкновение.
    expect(ir.assets).toHaveLength(3);
    expect(new Set(ir.assets.map((ref) => ref.sha256)).size).toBe(2);

    const request = await buildRequest({
      ir,
      index: 0,
      layout: {
        buildDir: path.join(root, 'build'),
        segmentsDir: path.join(root, 'build', 'segments'),
        tmpDir: path.join(root, 'build', 'tmp'),
      },
      compileProfile: COMPILE_PROFILE,
      renderProfile: RENDER_PROFILE,
      store: storeOf(root),
      templates: rendererTemplates,
    });

    // 1. СПИСОК ФАЙЛОВ — ПО ОДНОМУ НА БЛОБ.
    expect(request.assets.map((asset) => asset.sha256)).toEqual([FAR, NEAR]);

    // 2. АДАПТЕР ПРИНИМАЕТ. Это половина, ради которой правка и делалась: до неё
    //    `validateRequest` отвергал запрос правилом «два имени у одного блоба».
    expect(() => validateRequest(request)).not.toThrow();

    // 3. РОЛИ КЛИПОВ ЦЕЛЫ — склейка не потеряла ни одного факта. `parallax25@1` по-прежнему
    //    видит ОБА слоя и различает их ролями, хотя `layer0` указывает на тот же блоб, что и
    //    `still@1` под ним. Без этого утверждения дедуп мог бы «починить» сборку, отняв у
    //    шаблона глубину.
    const parallax = request.ir.clips.find((clip) => clip.template === 'parallax25@1');
    expect(parallax?.assets.map((ref) => ref.role)).toEqual(['layer0', 'layer1']);
    expect(parallax?.assets[0]?.sha256).toBe(FAR);
    const still = request.ir.clips.find((clip) => clip.template === 'still@1');
    expect(still?.assets.map((ref) => ref.role)).toEqual(['asset']);
    expect(still?.assets[0]?.sha256).toBe(FAR);

    // 4. ВЫЖИВАЕТ ПЕРВОЕ ВХОЖДЕНИЕ, то есть лексикографически меньшая роль (`IR.assets`
    //    отсортирован по `(sha256, role)`). Величина ни на что не влияет и потому названа:
    //    «какая роль осталась» не должно выясняться чтением двух пакетов.
    expect(request.assets[0]?.role).toBe('asset');
  });
});
