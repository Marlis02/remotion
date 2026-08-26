// Стадия `compileIr` на фикстуре (`CP-04`): числа T6, K4-матрица, AC4-b, D1/D2, D7.
//
// ЗДЕСЬ ПРОВЕРЯЮТСЯ УТВЕРЖДЕНИЯ О ПРОЕКТЕ, а не о формулах: формулы — в `render-ir.test.ts`,
// который гоняет их по диапазонам. Разделены они потому, что квантор у них разный: там —
// «при любом `L_i`», здесь — «на этой фикстуре получается вот это», и второе обязано быть
// ЧИСЛАМИ, иначе оно не проверяет ничего.

import { blake3, canonicalJson } from '@vpe/core-model';
import type { PixelProfileInput } from '@vpe/media';
import { afterAll, describe, expect, it } from 'vitest';

import {
  compileIr,
  compose,
  dumpIr,
  segmentIrHash,
  type BuildIrResult,
  type CompileProfileInput,
  type Timeline,
} from '../src/index.js';

import { fixtureCompileProfile, fixtureSeedRoot, readFixture } from './fixture.js';
import { buildProject, cleanupRoots, type ProjectExtra } from './project.js';

afterAll(cleanupRoots);

/** Полный путь фикстуры: разбор → дубли → Timeline → IR. */
async function compileFixture(
  text?: string,
  extra: ProjectExtra = {},
): Promise<{ timeline: Timeline; result: BuildIrResult; profile: CompileProfileInput }> {
  const built = await buildProject(text, undefined, extra);
  const timeline = compose(built.input);
  const profile = built.input.profile;
  return { timeline, result: compileIr({ timeline, profile, seedRoot: fixtureSeedRoot() }), profile };
}

/**
 * Отпечаток IR всего проекта: `segmentId=hash` через пробел.
 *
 * ПОЧЕМУ НЕ ОДИН ХЭШ ОДНОГО СЕГМЕНТА. Часть полей профиля двигает САМО РАЗБИЕНИЕ
 * (`minSegmentDurationFrames`), и тогда сегмента с прежним именем может не оказаться вовсе.
 * Отпечаток из пар переживает и это: он меняется и от содержимого, и от состава.
 */
function fingerprint(result: BuildIrResult): string {
  return result.segments.map((segment) => `${segment.segmentId}=${segmentIrHash(segment)}`).join(' ');
}

describe('`compileIr` на `fixtures/minimal` — числа T6 названы, а не подразумеваются', () => {
  it('два сегмента, `d_i`/`A_i`/`δ_i` совпадают с арифметикой T6 до сэмпла', async () => {
    const { result } = await compileFixture();
    const [intro, turn] = result.manifest.segments;

    // `S = 24000 · 1/30 = 800`. `L_1 = 551760 = 689·800 + 560` ⇒ `d_1 = ceil(689.7) = 690`,
    // `A_1 = 690·800 = 552000`, `δ_1 = 240`.
    expect(intro?.segmentId).toBe('seg:intro');
    expect(intro?.nominalSamples).toBe(551760);
    expect(intro?.segmentDurationInFrames).toBe(690);
    expect(intro?.alignedSamples).toBe(552000);
    expect(intro?.correctionSamples).toBe(240);
    expect(intro?.firstFrame).toBe(0);
    expect(intro?.firstSample).toBe(0);

    // `L_2 = 625680 = 782·800 + 80` ⇒ `d_2 = ceil(782.1) = 783`, `A_2 = 626400`, `δ_2 = 720`.
    expect(turn?.segmentId).toBe('seg:turn');
    expect(turn?.nominalSamples).toBe(625680);
    expect(turn?.segmentDurationInFrames).toBe(783);
    expect(turn?.alignedSamples).toBe(626400);
    expect(turn?.correctionSamples).toBe(720);
    expect(turn?.firstFrame).toBe(690);
    expect(turn?.firstSample).toBe(552000);

    // `F = 690 + 783 = 1473` кадра = 49.1 с. `Σ δ = 960` сэмплов = 40 мс — это и есть «цена,
    // принимаемая явно» (ADR-0003 T6). `Σ A_i = 1178400 = frameStartSample(1473)`, хвост 0.
    expect(result.manifest.totalFrames).toBe(1473);
    expect(result.manifest.totalCorrectionSamples).toBe(960);
    expect(result.manifest.trackTailSamples).toBe(0);
    expect(result.manifest.audioTrack).toBeNull();
  });

  it('`F ≤ maxDurationFrames` — величина T9 сходится, хотя падает по ней `CP-05`', async () => {
    const { result } = await compileFixture();
    const declared = /^maxDurationFrames:\s*(\d+)/m.exec(readFixture('fixtures/minimal/profiles/compile.yaml'));
    expect(result.manifest.totalFrames).toBeLessThanOrEqual(Number(declared?.[1]));
  });

  it('клипы видео-домена уложены segment-relative; аудио-дорожки в IR нет вовсе', async () => {
    const { timeline, result } = await compileFixture();
    const [intro, turn] = result.segments;

    expect(intro?.clips.map((clip) => clip.clipId)).toEqual([
      'img:b:img-harbour-1', // z=0, ord=1
      'r:a3f19c2b', // z=10, ord=0 — `z` первичен, меньший ординал его не перебивает
      'r:7b20de44', // z=20, ord=38
    ]);
    expect(intro?.clips.map((clip) => clip.frames)).toEqual([
      { frameStart: 0, frameEnd: 690 },
      { frameStart: 0, frameEnd: 337 },
      { frameStart: 337, frameEnd: 690 },
    ]);

    // Клип `bed@1` дорожки `music` лежит на всём втором сегменте Timeline — и в IR его нет:
    // звук не режется вообще (ADR-0008), сегменты немые (**R5**), музыку собирает `CP-05`.
    const music = timeline.tracks.find((track) => track.kind === 'music');
    expect(music?.items).toHaveLength(1);
    expect(turn?.clips.map((clip) => clip.clipId)).not.toContain('r:c81a05f7');
    expect(turn?.clips.map((clip) => clip.clipId)).toEqual([
      'img:b:img-ledger-1',
      'img:b:img-sea-1',
      'r:5d6e1130',
      'r:e40b7a92',
    ]);

    // Второй сегмент начинается с нуля СВОИХ кадров — это и есть T3.
    expect(turn?.clips[0]?.frames.frameStart).toBe(0);
  });

  it('группы субтитров — готовые диапазоны кадров, у каждой группы свои токены', async () => {
    const { timeline, result } = await compileFixture();
    const total = result.segments.reduce((sum, segment) => sum + segment.captions.length, 0);
    expect(total).toBe(timeline.captionGroups.length);

    const first = result.segments[0]?.captions[0];
    expect(first?.text).toBe('The morning began');
    expect(first?.frames).toEqual({ frameStart: 0, frameEnd: 27 });
    expect(first?.tokens).toHaveLength(3);
    // Подсветки на фикстуре все ненулевые: речь мока не настолько быстра.
    expect(first?.tokens.every((token) => token.highlight !== null)).toBe(true);
  });

  it('на фикстуре компилятор НИ ВО ЧТО не вмешался: `records` пуст', async () => {
    const { result } = await compileFixture();
    expect(result.records).toEqual([]);
  });

  it('шрифты — пустой список с пометкой типом: `declareFonts` приезжает с `TS-01`', async () => {
    const { result } = await compileFixture();
    expect(result.segments.every((segment) => segment.fonts.length === 0)).toBe(true);
  });

  it('ассеты несут sha и роль; порождённая `[img:]` — единственная, у кого они есть до `TS-01`', async () => {
    const { result } = await compileFixture();
    const harbour = result.segments[0]?.clips.find((clip) => clip.clipId === 'img:b:img-harbour-1');
    expect(harbour?.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000001', role: 'asset' },
    ]);
    const kenburns = result.segments[0]?.clips.find((clip) => clip.clipId === 'r:a3f19c2b');
    expect(kenburns?.assets).toEqual([]);
  });

  it('дамп детерминирован и кончается переводом строки', async () => {
    const first = await compileFixture();
    const second = await compileFixture();
    expect(dumpIr(first.result)).toBe(dumpIr(second.result));
    expect(dumpIr(first.result).endsWith('\n')).toBe(true);
    expect(dumpIr(first.result)).toContain('F=1473 sumDelta=960');
  });
});

describe('**D1**/**D2** — seed’ы материализованы, и ни один их вход не зависит от позиции', () => {
  it('seed’ы есть у клипов записей файла и отсутствуют у порождённых `[img:]`', async () => {
    const { result } = await compileFixture();
    const withSeeds = result.segments.flatMap((segment) =>
      segment.clips.filter((clip) => Object.keys(clip.seeds).length > 0).map((clip) => clip.clipId),
    );
    // Четыре, а не пять записей фикстуры: `bed@1` лежит на дорожке `music`, и в видео-IR её нет.
    expect(withSeeds).toEqual(['r:a3f19c2b', 'r:7b20de44', 'r:5d6e1130', 'r:e40b7a92']);

    const generated = result.segments.flatMap((segment) =>
      segment.clips.filter((clip) => clip.clipId.startsWith('img:')),
    );
    expect(generated).toHaveLength(3);
    expect(generated.every((clip) => Object.keys(clip.seeds).length === 0)).toBe(true);

    // `purpose = templateId` (решение владельца 1, вариант «а»): один seed на клип, ключ —
    // id шаблона. `TS-01` объявит настоящие purposes, и карта вырастет числом ключей.
    const kenburns = result.segments[0]?.clips.find((clip) => clip.clipId === 'r:a3f19c2b');
    expect(Object.keys(kenburns?.seeds ?? {})).toEqual(['kenburns@1']);
    expect(kenburns?.seeds['kenburns@1']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('**D1**: запись ВЫШЕ по сцене и правка чужих `params` не меняют множество seed’ов', async () => {
    const base = await compileFixture();
    const seedsOf = (result: BuildIrResult): readonly string[] =>
      result.segments
        .flatMap((segment) => segment.clips.flatMap((clip) => Object.values(clip.seeds)))
        .sort();

    // Своя режиссура: фикстурные записи ПЛЮС новая, стоящая выше по сцене `intro`, плюс
    // изменённый `params` у чужой записи. Фикстура при этом не трогается ни символом.
    const direction = readFixture('fixtures/minimal/direction/01-intro.yaml')
      .replace('      easing: "power2.inOut"', '      easing: "power3.out"')
      .replace(
        'records:\n',
        'records:\n' +
          '  - recordId: "0000beef"\n' +
          '    at: { kind: anchor, anchor: "sc:intro" }\n' +
          '    until: { kind: anchor, anchor: "b:reveal" }\n' +
          '    track: effect\n' +
          '    z: 5\n' +
          '    template: "grade@1"\n' +
          '    params:\n' +
          '      saturate: 1\n',
      );
    const probe = await compileFixture(undefined, { direction });

    const added = seedsOf(probe.result).filter((seed) => !seedsOf(base.result).includes(seed));
    const lost = seedsOf(base.result).filter((seed) => !seedsOf(probe.result).includes(seed));
    expect(lost, 'ни один прежний seed не изменился и не пропал').toEqual([]);
    expect(added, 'добавился ровно один — у новой записи').toHaveLength(1);
  });

  it('**D2**: `segmentId` не участвует ни в одном seed — иначе он менялся бы с сегментацией', async () => {
    const base = await compileFixture();
    // Порог 800 кадров отклоняет единственный разрез (`CP-03` §11): состав сегментов
    // становится другим — один вместо двух, и `segmentId` у него другой.
    const merged = await compileFixture(undefined, {
      profile: (input) => ({ ...input, minSegmentDurationFrames: 800 }),
    });
    expect(merged.result.segments).toHaveLength(1);
    expect(merged.result.segments[0]?.segmentId).not.toBe(base.result.segments[1]?.segmentId);

    const seedsOf = (result: BuildIrResult): readonly string[] =>
      result.segments
        .flatMap((segment) => segment.clips.flatMap((clip) => Object.values(clip.seeds)))
        .sort();
    expect(seedsOf(merged.result)).toEqual(seedsOf(base.result));
  });
});

describe('**T3**/AC4-b — тот же сегмент в двух проектах даёт побайтово тот же IR (закрывает №38)', () => {
  /**
   * Тот же исходник плюс сцена ВЫШЕ `intro`.
   *
   * СВОИ ALIAS'Ы У НОВОЙ СЦЕНЫ НЕ НУЖНЫ, И ЭТО ЧАСТЬ УТВЕРЖДЕНИЯ (поправка владельца П2):
   * счётчик неявного бита `b:img-<alias>-<n>` документный (`C-04`), поэтому повтор alias'а
   * `harbour` выше по тексту ПЕРЕИМЕНОВАЛ бы `img:b:img-harbour-1` — и IR разошёлся бы
   * законно, по смене имени клипа, а не из-за квантования. Граница AC4-b названа в отчёте.
   */
  const withSceneAbove = (): string =>
    readFixture('fixtures/minimal/source/01-intro.md').replace(
      '## scene: intro',
      '## scene: prologue\n\nBefore any of this there was only water and a long grey line of shore ' +
        'where the boats waited for the wind to turn and the tide to fall.\n\n## scene: intro',
    );

  it('сцена выше по тексту не меняет ни IR, ни хэш `seg:intro` и `seg:turn`', async () => {
    const base = await compileFixture();
    const probe = await compileFixture(withSceneAbove());

    expect(probe.result.segments.map((segment) => segment.segmentId)).toEqual([
      'seg:prologue',
      'seg:intro',
      'seg:turn',
    ]);

    for (const id of ['seg:intro', 'seg:turn']) {
      const left = base.result.segments.find((segment) => segment.segmentId === id);
      const right = probe.result.segments.find((segment) => segment.segmentId === id);
      expect(left, id).toBeDefined();
      // ПОБАЙТОВО: сравнивается каноническая форма, а не структурное равенство. Это то самое
      // «тот же сегмент в двух проектах» строки **T3**, и оно же — полный охранник **D2**,
      // которого грепу не хватало (долг №38: греп видит файл формулы и не видит вызывающих).
      expect(canonicalJson(right), `${id}: канонический JSON разошёлся`).toBe(canonicalJson(left));
      expect(segmentIrHash(right!), `${id}: segmentIrHash разошёлся`).toBe(segmentIrHash(left!));
    }
  });

  it('и `d_i` этих сегментов тоже не изменился — их `L_i` от чужой сцены не зависит (**T6a**)', async () => {
    const base = await compileFixture();
    const probe = await compileFixture(withSceneAbove());
    const durations = (result: BuildIrResult): Record<string, number> =>
      Object.fromEntries(result.manifest.segments.map((row) => [row.segmentId, row.segmentDurationInFrames]));

    expect(durations(probe.result)['seg:intro']).toBe(durations(base.result)['seg:intro']);
    expect(durations(probe.result)['seg:turn']).toBe(durations(base.result)['seg:turn']);
    // А `f_i` изменился — сегмент СТОИТ в другом месте ролика, и это не противоречие:
    // манифест знает порядок, IR сегмента — нет.
    const introRow = probe.result.manifest.segments.find((row) => row.segmentId === 'seg:intro');
    expect(introRow?.firstFrame).toBeGreaterThan(0);
  });
});

describe('**D7** — правка одного слова не меняет порядок слоёв ни в одном IR', () => {
  it('«list» → «record» в третьем абзаце `sc:intro`: порядок клипов тот же', async () => {
    const base = await compileFixture();
    const edited = await compileFixture(
      readFixture('fixtures/minimal/source/01-intro.md').replace('kept a list of those goods', 'kept a record of those goods'),
    );

    const order = (result: BuildIrResult): readonly string[][] =>
      result.segments.map((segment) => segment.clips.map((clip) => clip.clipId));
    expect(order(edited.result)).toEqual(order(base.result));

    // Правка при этом НЕ бесследна — иначе тест был бы зелёным на пустоте: субтитры сцены
    // `intro` изменились, значит и хэш её сегмента обязан отличаться.
    const introBase = base.result.segments.find((segment) => segment.segmentId === 'seg:intro');
    const introEdited = edited.result.segments.find((segment) => segment.segmentId === 'seg:intro');
    expect(segmentIrHash(introEdited!)).not.toBe(segmentIrHash(introBase!));
  });
});

// ── K4: что двигает `segmentIrHash`, а что нет ──────────────────────────────

/**
 * Строка K4-матрицы: поле `compileProfile`, мутация и ОЖИДАНИЕ с объяснением.
 *
 * `moves: false` — это не «поле лишнее», а материал долга №114: поле входит в `segmentKey`
 * отдельной строкой и хэшем IR НЕ поглощается, то есть в `cacheKeyView` стадии `segment` оно
 * обязано остаться явным. `moves: true` — наоборот: величина учтена дважды.
 */
interface K4Row {
  readonly field: string;
  readonly mutate: (input: CompileProfileInput) => CompileProfileInput;
  readonly moves: boolean;
  readonly why: string;
}

const K4_MATRIX: readonly K4Row[] = [
  {
    field: 'fps',
    mutate: (input) => ({ ...input, fps: { num: 60, den: 1 } }),
    moves: true,
    why: 'кадры И ЕСТЬ содержимое IR: при 60 fps `d_i` и все интервалы клипов другие',
  },
  {
    field: 'defaultParagraphGapSamples',
    mutate: (input) => ({ ...input, defaultParagraphGapSamples: input.defaultParagraphGapSamples * 2 }),
    moves: true,
    why: 'позиции всех клипов ниже точки сдвигаются, значит и их кадры',
  },
  {
    field: 'defaultSceneGapSamples',
    mutate: (input) => ({ ...input, defaultSceneGapSamples: input.defaultSceneGapSamples * 2 }),
    moves: true,
    why: 'длина хвостового gap’а входит в `L_i` предшествующего сегмента (T6)',
  },
  {
    field: 'defaultChapterGapSamples',
    mutate: (input) => ({ ...input, defaultChapterGapSamples: input.defaultChapterGapSamples * 2 }),
    moves: false,
    why: 'на `minimal` одна глава — стыка глав нет вовсе; на двухглавой синтетике двигает',
  },
  {
    field: 'minSegmentDurationFrames',
    mutate: (input) => ({ ...input, minSegmentDurationFrames: 800 }),
    moves: true,
    why: 'двигает САМО РАЗБИЕНИЕ: разрез отклонён, сегмент один вместо двух',
  },
  {
    field: 'captions.tokensPerGroupMax',
    mutate: (input) => ({ ...input, captions: { ...input.captions, tokensPerGroupMax: 2 } }),
    moves: true,
    why: 'состав групп субтитров другой, а группы лежат в IR',
  },
  {
    field: 'captions.maxGroupChars',
    mutate: (input) => ({ ...input, captions: { ...input.captions, maxGroupChars: 10 } }),
    moves: true,
    why: 'потолок символов дробит группы, то есть меняет их состав',
  },
  {
    field: 'captions.minGroupDurationFrames',
    mutate: (input) => ({ ...input, captions: { ...input.captions, minGroupDurationFrames: 600 } }),
    moves: false,
    why: 'ПОРОГ ЗАПИСИ В ОТЧЁТ, а не правило: `belowMinimum` живёт в `CaptionReport`, не в IR',
  },
];

describe('**K4** — матрица: `compileProfile` двигает `segmentIrHash`, `pixelProfile` не виден вовсе', () => {
  for (const row of K4_MATRIX) {
    it(`${row.field}: хэш ${row.moves ? 'МЕНЯЕТСЯ' : 'НЕ меняется'} — ${row.why}`, async () => {
      const base = await compileFixture();
      const probe = await compileFixture(undefined, { profile: row.mutate });
      const assertion = expect(fingerprint(probe.result), row.why);
      if (row.moves) assertion.not.toBe(fingerprint(base.result));
      else assertion.toBe(fingerprint(base.result));
    });
  }

  it('projectSampleRate: мутация в изоляции НЕВЫРАЗИМА, и это доказательство, а не пропуск', async () => {
    // Дубли сняты на частоте проекта; подменить одну частоту, не пересняв дубли, — значит
    // получить `ADR-0003 T1` от `compose` раньше, чем IR вообще посчитается. Измерено так же
    // в `CP-03` §11. Поле несущее: доказано отказом пути, а не молчанием.
    await expect(
      compileFixture(undefined, { profile: (input) => ({ ...input, projectSampleRate: 48000 }) }),
    ).rejects.toThrow(/T1/);
  });

  it('pixelProfile: хэшу негде измениться — ДОКАЗАТЕЛЬСТВО ТИПОМ, а не перебором', async () => {
    // Полный `PixelProfileInput` (`media`, ADR-0006 §5) собирается здесь целиком и мутируется
    // поле за полем. Ни одна из мутаций не может дойти до `compileIr`: у стадии нет ни поля,
    // ни типа `pixelProfile` — это ADR-0002 §7 и роадмап-строка «renderIr не видит
    // pixelProfile», исполненные сигнатурой, а не дисциплиной.
    const pixel: PixelProfileInput = {
      browserGpu: false,
      imageFormat: 'jpeg',
      jpegQuality: 90,
      scale: 1,
      colorSpace: 'bt709',
      pixelFormat: 'yuv420p',
      codec: 'h264',
      crf: 18,
      gopSize: 30,
      encoder: {
        threads: 1,
        preset: 'slow',
        tune: 'film',
        rcLookahead: 40,
        aqMode: 1,
        psy: 1,
        bitexact: true,
      },
    };
    const base = await compileFixture();

    const mutants: PixelProfileInput[] = [
      { ...pixel, browserGpu: true },
      { ...pixel, imageFormat: 'png' },
      { ...pixel, jpegQuality: 50 },
      { ...pixel, scale: 0.5 },
      { ...pixel, colorSpace: 'bt2020' },
      { ...pixel, pixelFormat: 'yuv444p' },
      { ...pixel, codec: 'h265' },
      { ...pixel, crf: 28 },
      { ...pixel, gopSize: 60 },
      { ...pixel, encoder: { ...pixel.encoder, threads: 8 } },
      { ...pixel, encoder: { ...pixel.encoder, preset: 'fast' } },
      { ...pixel, encoder: { ...pixel.encoder, tune: 'grain' } },
      { ...pixel, encoder: { ...pixel.encoder, rcLookahead: 10 } },
      { ...pixel, encoder: { ...pixel.encoder, aqMode: 2 } },
      { ...pixel, encoder: { ...pixel.encoder, psy: 0 } },
      { ...pixel, encoder: { ...pixel.encoder, bitexact: false } },
    ];
    // Все шестнадцать мутантов РАЗЛИЧНЫ — иначе утверждение «хэш не изменился» было бы
    // зелёным на пустоте: мутировать надо то, что действительно меняется.
    expect(new Set(mutants.map((mutant) => blake3(canonicalJson(mutant)))).size).toBe(mutants.length);

    // А ПОДАТЬ их в стадию не во что, и это не «мы не стали»: у `compileIr` три входа, и
    // `pixelProfile` среди них отсутствует. Перебирать мутантов прогонами бессмысленно —
    // прогон был бы буквально одним и тем же вычислением шестнадцать раз. Утверждение
    // проверяется там, где оно живёт: в форме входа.
    const input = { timeline: base.timeline, profile: base.profile, seedRoot: fixtureSeedRoot() };
    expect(Object.keys(input).sort()).toEqual(['profile', 'seedRoot', 'timeline']);
  });

  it('поля `width`/`height`/`safeAreas`/`templateRegistryVersion`/`maxDurationFrames` входа не имеют вовсе', () => {
    // Доказательство ОТСУТСТВИЕМ СТРОКИ (тот же приём, что в `CP-03` §11): их нет в
    // `CompileProfileInput` пакета `compile`, значит мутировать нечего. Это материал №114 —
    // ровно они обязаны остаться явными строками в `cacheKeyView` стадии `segment`.
    const keys = Object.keys(fixtureCompileProfile()).sort();
    expect(keys).toEqual([
      'captions',
      'defaultChapterGapSamples',
      'defaultParagraphGapSamples',
      'defaultSceneGapSamples',
      'fps',
      'minSegmentDurationFrames',
      'projectSampleRate',
    ]);
    for (const absent of ['width', 'height', 'safeAreas', 'templateRegistryVersion', 'maxDurationFrames']) {
      expect(keys).not.toContain(absent);
    }
  });
});

describe('**№132** — порог в кадрах на фикстуре и на её сегментации', () => {
  it('оба сегмента фикстуры длиннее порога, и порог им ПРЕДЪЯВЛЯЛСЯ', async () => {
    const { result, profile } = await compileFixture();
    for (const row of result.manifest.segments) {
      expect(row.segmentDurationInFrames).toBeGreaterThanOrEqual(profile.minSegmentDurationFrames);
    }
  });

  it('единственный сегмент (разрезов ноль) порога не обязан достигать — исключение по таблице', async () => {
    // Порог 800 кадров отклоняет единственный кандидат: сегмент остаётся один. Ассерт при
    // этом молчит, потому что объединять было не с чем.
    const merged = await compileFixture(undefined, {
      profile: (input) => ({ ...input, minSegmentDurationFrames: 800 }),
    });
    expect(merged.result.segments).toHaveLength(1);
    expect(merged.result.manifest.segments[0]?.segmentDurationInFrames).toBe(1472);
  });

  it('и вот сколько стоит разрез: `F` при двух сегментах на КАДР больше, чем при одном', async () => {
    // 1473 против 1472 на `fixtures/minimal`. Это и есть `Σ δ`, увиденная с другой стороны:
    // `ceil(1177440/800) = 1472`, а `ceil(551760/800) + ceil(625680/800) = 690 + 783 = 1473`.
    // Цена, названная ADR-0003 T6 («до одного кадра на границу сегмента»), — измерена.
    const two = await compileFixture();
    const one = await compileFixture(undefined, {
      profile: (input) => ({ ...input, minSegmentDurationFrames: 800 }),
    });
    expect(two.result.manifest.totalFrames - one.result.manifest.totalFrames).toBe(1);
    expect(two.result.manifest.totalCorrectionSamples).toBe(960);
    expect(one.result.manifest.totalCorrectionSamples).toBe(160);
  });
});
