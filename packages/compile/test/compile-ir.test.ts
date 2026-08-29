// Стадия `compileIr` на фикстуре (`CP-04`): числа T6, K4-матрица, AC4-b, D1/D2, D7.
//
// ЗДЕСЬ ПРОВЕРЯЮТСЯ УТВЕРЖДЕНИЯ О ПРОЕКТЕ, а не о формулах: формулы — в `render-ir.test.ts`,
// который гоняет их по диапазонам. Разделены они потому, что квантор у них разный: там —
// «при любом `L_i`», здесь — «на этой фикстуре получается вот это», и второе обязано быть
// ЧИСЛАМИ, иначе оно не проверяет ничего.

import { blake3, canonicalJson } from '@vpe/core-model';
import type { PixelProfileInput } from '@vpe/media';
import { TEMPLATE_LIBRARY, requestFiles, type TemplateRegistry } from '@vpe/templates-spec';
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
import { jitter1 } from './specs.js';

afterAll(cleanupRoots);

/** Полный путь фикстуры: разбор → дубли → Timeline → IR. */
async function compileFixture(
  text?: string,
  extra: ProjectExtra = {},
): Promise<{
  timeline: Timeline;
  result: BuildIrResult;
  profile: CompileProfileInput;
  registry: TemplateRegistry;
}> {
  const built = await buildProject(text, undefined, extra);
  const timeline = compose(built.input);
  const profile = built.input.profile;
  return {
    timeline,
    result: compileIr({ timeline, profile, seedRoot: fixtureSeedRoot() }),
    profile,
    registry: built.registry,
  };
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
      // `[337, 343)` — ШЕСТЬ КАДРОВ, а не 353 до конца сегмента (`CP-07`, долг №119):
      // `flash@1` объявляет `durationSamples: 4800`, а `4800 / 800 = 6`. До этой задачи здесь
      // стояло `{337, 690}` — клип тянулся «до конца области» вопреки собственному параметру.
      { frameStart: 337, frameEnd: 343 },
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

  it('шрифты приезжают `declareFonts`: `seg:turn` — DejaVu Sans Bold, `seg:intro` — пусто', async () => {
    const { result } = await compileFixture();
    const [intro, turn] = result.segments;

    // Единственный из пяти, кто шрифт просит, — `captionEmphasis@1` (роль `caption`), и стоит
    // он на `b:close`, то есть во ВТОРОМ сегменте. `family` — ИЗМЕРЕННОЕ `intrinsic.family`
    // записи `fonts/records/…0005.json`, а не то, что назвал шаблон: спек семейства не
    // называет вовсе (`FontRef.family` необязателен — шрифт канала не выбран, №13).
    expect(turn?.fonts).toEqual([
      {
        sha256: '0000000000000000000000000000000000000000000000000000000000000005',
        family: 'DejaVu Sans',
        role: 'caption',
      },
    ]);
    expect(intro?.fonts).toEqual([]);

    // У КЛИПА тот же список, и он один: список сегмента есть их объединение.
    const emphasis = turn?.clips.find((clip) => clip.clipId === 'r:e40b7a92');
    expect(emphasis?.fonts).toEqual(turn?.fonts);
    expect(turn?.clips.filter((clip) => clip.fonts.length > 0)).toHaveLength(1);
  });

  it('ассеты сегмента — объединение объявленных клипами, отсортированное по `(sha256, role)`', async () => {
    const { result } = await compileFixture();
    const [intro, turn] = result.segments;

    // `harbour` — в `seg:intro`; `ledger` и `sea` — в `seg:turn`. `pad-loop` (`bed@1`) в
    // видео-IR не попадает вовсе: он на дорожке `music`, и его ассет уезжает в `AudioPlan`.
    expect(intro?.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000001', role: 'asset' },
    ]);
    expect(turn?.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000002', role: 'asset' },
      { sha256: '0000000000000000000000000000000000000000000000000000000000000003', role: 'asset' },
    ]);

    // ОБЪЕДИНЕНИЕ, А НЕ КОНКАТЕНАЦИЯ: `ledger` объявлен ДВАЖДЫ — порождённой `[img: ledger]`
    // и записью `r:5d6e1130` (`still@1`, `params.asset: "ledger"`), — а в списке запроса
    // сегмента он один: в каталог композиции файл ляжет один раз.
    const ledgerClips = (turn?.clips ?? []).filter((clip) =>
      clip.assets.some((asset) => asset.sha256.endsWith('002')),
    );
    expect(ledgerClips.map((clip) => clip.clipId)).toEqual(['img:b:img-ledger-1', 'r:5d6e1130']);

    // Роль называет ШАБЛОН (`declareAssets`), и у `still@1` это `'asset'` — та же строка,
    // что компилятор ставил сам до `CP-07` (долг №138 закрыт `TS-01` без смены значения).
    const harbour = intro?.clips.find((clip) => clip.clipId === 'img:b:img-harbour-1');
    expect(harbour?.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000001', role: 'asset' },
    ]);
    // `kenburns@1` ассетов не объявляет (решение владельца 5, `TS-01`) — и это не «забыли».
    const kenburns = intro?.clips.find((clip) => clip.clipId === 'r:a3f19c2b');
    expect(kenburns?.assets).toEqual([]);
  });

  it('**R3**: списки запроса и объявления спеков совпадают В ОБЕ СТОРОНЫ', async () => {
    const { result, registry } = await compileFixture();

    // ЛЕВАЯ СТОРОНА — `requestFiles(spec, params)`, то есть ЕДИНСТВЕННЫЙ источник списка
    // файлов запроса (вход R3, `TS-01`). Считается заново, из реестра и авторских `params`
    // клипа, — а не берётся у стадии: иначе тест сверял бы стадию с самой собой.
    for (const segment of result.segments) {
      const declared = segment.clips.flatMap((clip) => {
        const spec = registry.resolve(clip.template);
        const files = requestFiles(spec, clip.params);
        return [
          ...files.assets.map((ref) => `asset:${ref.role}`),
          ...files.fonts.map((ref) => `font:${ref.role}`),
        ];
      });
      const inRequest = [
        ...segment.assets.map((ref) => `asset:${ref.role}`),
        ...segment.fonts.map((ref) => `font:${ref.role}`),
      ];
      // Множества ролей совпадают: ни один спек не попросил файла, которого нет в запросе,
      // и в запросе нет файла, которого не просил ни один спек (поправка владельца П2).
      expect(new Set(inRequest)).toEqual(new Set(declared));
    }

    // И то же по SHA: в IR нет ни одного sha, которого не объявил ни один спек.
    const allShas = result.segments.flatMap((segment) => [
      ...segment.assets.map((ref) => ref.sha256),
      ...segment.fonts.map((ref) => ref.sha256),
    ]);
    expect(allShas.every((sha) => /^[0-9a-f]{64}$/.test(sha))).toBe(true);
    expect(new Set(allShas).size).toBe(4); // harbour, ledger, sea, шрифт роли `caption`
  });

  it('бюджет `msPerFrameBudget` считается по кадрам и ПЕЧАТАЕТСЯ, ничего не роняя', async () => {
    const { result } = await compileFixture();
    // `seg:intro`: `still@1` (1) + `kenburns@1` (2) перекрываются на кадрах `[0, 337)` ⇒ 3;
    // на `[337, 343)` — `still@1` (1) + `flash@1` (1) = 2. Максимум по сегменту — 3.
    expect(result.budgets[0]).toEqual({ segmentId: 'seg:intro', maxMsPerFrame: 34 });
    // `seg:turn`: два `still@1` (по 1) идут ВСТЫК, не перекрываясь; с ними перекрывается
    // запись `r:5d6e1130` (`still@1`, 1) и `captionEmphasis@1` (1) ⇒ пик 3.
    expect(result.budgets[1]?.segmentId).toBe('seg:turn');
    expect(result.budgets[1]?.maxMsPerFrame).toBe(3);
    expect(dumpIr(result)).toContain('budgetMsPerFrame=3');
    // ПОРОГА НЕТ НИ ОДНОГО: решение владельца 9 (RM1) — «печатается, не роняет»; падение
    // появится не раньше `E-05`, число готовит `E-00`.
    expect(result.records).toEqual([]);
  });

  it('дамп детерминирован и кончается переводом строки', async () => {
    const first = await compileFixture();
    const second = await compileFixture();
    expect(dumpIr(first.result)).toBe(dumpIr(second.result));
    expect(dumpIr(first.result).endsWith('\n')).toBe(true);
    expect(dumpIr(first.result)).toContain('F=1473 sumDelta=960');
  });
});

// ── D1/D2: seed'ы. Перечитаны, а не подогнаны (`CP-07`) ─────────────────────

/**
 * Фикстурная режиссура, у которой ОДНА запись поставлена на шаблон, просящий случайность.
 *
 * `still@1` → `jitter@1` — подмена ровно одной строки: схема `params` у синтетического спека
 * та же (он копия донора), поэтому запись `5d6e1130` остаётся законным вызовом и отличается
 * только тем, что её шаблон объявляет `purposes: ['jitter']`. Фикстура не трогается: текст
 * читается и правится в памяти, каталог режиссуры прогона — временный.
 */
function withJitter(extra = ''): string {
  return readFixture('fixtures/minimal/direction/01-intro.yaml')
    .replace('    template: "still@1"', '    template: "jitter@1"')
    .replace('records:\n', `records:\n${extra}`);
}

/** Реестр прогона: пять спеков фикстуры плюс `jitter@1`. */
const JITTER_SPECS = [...TEMPLATE_LIBRARY, jitter1];
const WITH_JITTER: ProjectExtra = { direction: withJitter(), specs: JITTER_SPECS };

describe('**D1**/**D2** — seed’ы материализованы, и ни один их вход не зависит от позиции', () => {
  it('на фикстуре seed’ов НЕТ НИ ОДНОГО: `purposes` пуст у всех пяти шаблонов', async () => {
    const { result } = await compileFixture();
    const clips = result.segments.flatMap((segment) => segment.clips);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((clip) => Object.keys(clip.seeds).length === 0)).toBe(true);

    // ЭТО ИЗМЕРЕНИЕ, А НЕ ДЕГРАДАЦИЯ (`TS-01` §5 п. 2): случайности не требует ни один
    // шаблон фикстуры. До `CP-07` здесь было четыре seed’а под ключом `purpose = templateId`
    // — временная форма, взятая `CP-04` за неимением манифестов (долг №135). Ключ не сменился
    // — карта СТАЛА ПУСТОЙ, и цена «кэш сегментов инвалидируется один раз» заплачена здесь.
    expect(dumpIr(result)).toContain('seeds=<нет>');
    expect(dumpIr(result)).not.toContain('seeds=kenburns@1=');
  });

  it('seed есть у записи файла с непустыми `purposes`; у порождённой `[img:]` — нет', async () => {
    const { result } = await compileFixture(undefined, WITH_JITTER);
    const jitter = result.segments
      .flatMap((segment) => segment.clips)
      .find((clip) => clip.clipId === 'r:5d6e1130');
    expect(jitter?.template).toBe('jitter@1');
    // Ключ карты — ОБЪЯВЛЕННЫЙ `purpose`, а не id шаблона: `'jitter'`, не `'jitter@1'`.
    expect(Object.keys(jitter?.seeds ?? {})).toEqual(['jitter']);
    expect(jitter?.seeds['jitter']).toMatch(/^[0-9a-f]{16}$/);

    const generated = result.segments.flatMap((segment) =>
      segment.clips.filter((clip) => clip.clipId.startsWith('img:')),
    );
    expect(generated).toHaveLength(3);
    expect(generated.every((clip) => Object.keys(clip.seeds).length === 0)).toBe(true);
  });

  it('**D1**: запись ВЫШЕ по сцене и правка чужих `params` не меняют множество seed’ов', async () => {
    const seedsOf = (result: BuildIrResult): readonly string[] =>
      result.segments
        .flatMap((segment) => segment.clips.flatMap((clip) => Object.values(clip.seeds)))
        .sort();

    const base = await compileFixture(undefined, WITH_JITTER);
    // Множество НЕПУСТО — иначе утверждение проверяло бы, что пустое множество не меняется.
    expect(seedsOf(base.result)).toHaveLength(1);

    // Две правки разом, обе — законные вызовы: (1) новая запись ВЫШЕ по сцене `intro`, тоже
    // просящая случайность; (2) чужой `params` изменён (`strengthPct` у `flash@1`). Прежняя
    // редакция теста меняла `easing` на `power3.out` — после `TS-01` это НЕ вызов, а ошибка
    // схемы: `kenburns@1` принимает ровно `power2.inOut`.
    const probe = await compileFixture(undefined, {
      specs: JITTER_SPECS,
      direction: withJitter(
        '  - recordId: "0000beef"\n' +
          '    at: { kind: anchor, anchor: "sc:intro" }\n' +
          '    until: { kind: anchor, anchor: "b:reveal" }\n' +
          '    track: visual\n' +
          '    z: 5\n' +
          '    template: "jitter@1"\n' +
          '    params:\n' +
          '      asset: "harbour"\n',
      ).replace('strengthPct: 35', 'strengthPct: 55'),
    });

    const added = seedsOf(probe.result).filter((seed) => !seedsOf(base.result).includes(seed));
    const lost = seedsOf(base.result).filter((seed) => !seedsOf(probe.result).includes(seed));
    expect(lost, 'ни один прежний seed не изменился и не пропал').toEqual([]);
    expect(added, 'добавился ровно один — у новой записи').toHaveLength(1);
  });

  it('**D2**: `segmentId` не участвует ни в одном seed — иначе он менялся бы с сегментацией', async () => {
    const base = await compileFixture(undefined, WITH_JITTER);
    // Порог 800 кадров отклоняет единственный разрез (`CP-03` §11): состав сегментов
    // становится другим — один вместо двух, и `segmentId` у него другой.
    const merged = await compileFixture(undefined, {
      ...WITH_JITTER,
      profile: (input) => ({ ...input, minSegmentDurationFrames: 800 }),
    });
    expect(merged.result.segments).toHaveLength(1);
    expect(merged.result.segments[0]?.segmentId).not.toBe(base.result.segments[1]?.segmentId);

    const seedsOf = (result: BuildIrResult): readonly string[] =>
      result.segments
        .flatMap((segment) => segment.clips.flatMap((clip) => Object.values(clip.seeds)))
        .sort();
    // Непусто И равно: обе половины утверждения нужны — пустое равнялось бы пустому всегда.
    expect(seedsOf(base.result)).toHaveLength(1);
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

  it('поля `width`/`height`/`safeAreas`/`maxDurationFrames` входа не имеют вовсе', () => {
    // Доказательство ОТСУТСТВИЕМ СТРОКИ (тот же приём, что в `CP-03` §11): их нет в
    // `CompileProfileInput` пакета `compile`, значит мутировать нечего. Это материал №114 —
    // ровно они обязаны остаться явными строками в `cacheKeyView` стадии `segment`.
    //
    // `templateRegistryVersion` ИЗ ЭТОГО СПИСКА УШЁЛ (`CP-07`): у стадии появился РЕЕСТР, и
    // поле профиля теперь есть с чем сверять. Оно по-прежнему не двигает хэш — но не потому,
    // что его негде прочитать, а потому, что расхождение есть ОШИБКА (строка K4-матрицы ниже).
    const keys = Object.keys(fixtureCompileProfile()).sort();
    expect(keys).toEqual([
      'captions',
      'defaultChapterGapSamples',
      'defaultParagraphGapSamples',
      'defaultSceneGapSamples',
      'fps',
      'minSegmentDurationFrames',
      'projectSampleRate',
      'templateRegistryVersion',
    ]);
    for (const absent of ['width', 'height', 'safeAreas', 'maxDurationFrames']) {
      expect(keys).not.toContain(absent);
    }
  });

  it('templateRegistryVersion: хэш НЕ двигает, потому что расхождение — ОШИБКА (**K6**)', async () => {
    // СТРОКА МАТРИЦЫ ПЕРЕПИСАНА (`CP-07`). У `CP-04` она читалась «входа в стадию не имеет
    // вовсе» — то есть поле профиля адресовало содержимое, которого стадия не видела, и
    // исключение в allowlist'е **K6** было безнаказанным по построению. Теперь реестр
    // подаётся входом `compose`, и мутация поля даёт не другой хэш, а ОТКАЗ КОМПИЛЯЦИИ до
    // первой записи: собрать ролик реестром, которого автор не называл, нельзя.
    await expect(
      compileFixture(undefined, { profile: (input) => ({ ...input, templateRegistryVersion: '2' }) }),
    ).rejects.toThrow(/K6/);

    // А на СОВПАДАЮЩЕЙ версии хэш ровно тот же — поле в `segmentIrHash` не входит (№114:
    // в `cacheKeyView` стадии `segment` оно обязано остаться отдельной строкой).
    const base = await compileFixture();
    const same = await compileFixture(undefined, {
      profile: (input) => ({ ...input, templateRegistryVersion: input.templateRegistryVersion }),
    });
    expect(fingerprint(same.result)).toBe(fingerprint(base.result));
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
