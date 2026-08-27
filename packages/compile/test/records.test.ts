// Треки режиссуры: порядок ADR-0007 §5, `until` по умолчанию, alias `[img:]`, `params` данными.

import { afterAll, describe, expect, it } from 'vitest';

import { compose, type PlacedClip, type Timeline } from '../src/index.js';

import { buildProject, cleanupRoots } from './project.js';

afterAll(cleanupRoots);

const clipsOf = (timeline: Timeline, kind: string): readonly PlacedClip[] =>
  (timeline.tracks.find((track) => track.kind === kind)?.items ?? []).filter(
    (item): item is PlacedClip => item.kind === 'clip',
  );

describe('CP-01 — укладка режиссуры', () => {
  it('порядок на треке — `(z, sourceOrdinal, clipId)`, а не `recordId` первым ключом', async () => {
    const timeline = compose((await buildProject()).input);
    const visual = clipsOf(timeline, 'visual');
    expect(visual.map((clip) => clip.clipId)).toEqual([
      'img:b:img-harbour-1',
      'img:b:img-ledger-1',
      'img:b:img-sea-1',
      'r:a3f19c2b',
      'r:5d6e1130',
    ]);
    // Первичный ключ — АВТОРСКИЙ `z`: `kenburns@1` (z=10) стоит после всех `[img:]` (z=0),
    // хотя его якорь `sc:intro` — самая ранняя позиция в исходнике.
    expect(visual.map((clip) => clip.z)).toEqual([0, 0, 0, 10, 15]);
    for (let index = 1; index < visual.length; index += 1) {
      const left = visual[index - 1];
      const right = visual[index];
      if (left === undefined || right === undefined) continue;
      expect(left.z <= right.z).toBe(true);
      if (left.z === right.z) expect(left.sourceOrdinal < right.sourceOrdinal).toBe(true);
    }
    // Сортировка по `recordId` первым ключом дала бы `5d6e1130` перед `a3f19c2b`.
    expect(visual.map((clip) => clip.clipId).indexOf('r:a3f19c2b')).toBeLessThan(
      visual.map((clip) => clip.clipId).indexOf('r:5d6e1130'),
    );
  });

  it('`until` на scope-якоре = его конец: `bed@1` до `ch:main` тянется до конца дорожки', async () => {
    const timeline = compose((await buildProject()).input);
    const bed = clipsOf(timeline, 'music')[0];
    const turn = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:turn');
    expect(bed?.clipId).toBe('r:c81a05f7');
    expect(bed?.startSample).toBe(turn?.startSample);
    expect(bed?.endSample).toBe(timeline.durationSamples);
    expect(bed?.duration.samples).toBe((bed?.endSample ?? 0) - (bed?.startSample ?? 0));
  });

  it('`flash@1` без `until` берёт ОБЪЯВЛЕННУЮ длительность: 4800, а не конец области (№119)', async () => {
    const timeline = compose((await buildProject()).input);
    const flash = clipsOf(timeline, 'effect')[0];
    const intro = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:intro');
    const reveal = timeline.anchors.find((anchor) => anchor.anchorId === 'b:reveal');
    expect(flash?.clipId).toBe('r:7b20de44');
    expect(flash?.startSample).toBe(reveal?.startSample);

    // ЭТО И ЕСТЬ ЗАКРЫТИЕ ДОЛГА №119, и оно измеряется РАЗНОСТЬЮ. До `CP-07` клип кончался
    // на `intro?.endSample` (281 880 сэмплов, 11.7 с) — «до конца области», потому что читать
    // `params.durationSamples` компилятор не вправе. Читает его теперь СПЕК (`flash@1.
    // declareDuration`), и длина стала ровно объявленной: 4800 сэмплов = 0.2 с = 6 кадров.
    expect(flash?.duration.samples).toBe(4800);
    expect(flash?.endSample).toBe((flash?.startSample ?? 0) + 4800);
    expect(flash?.endSample).not.toBe(intro?.endSample);
    expect(4800 / (24000 / 30)).toBe(6);

    // `params` при этом остались АВТОРСКИМИ и в Timeline лежат как написаны (решение
    // владельца `CP-07`, вопрос 2): длительность приехала контрактом, а не подменой поля.
    expect(flash?.fill.kind).toBe('record');
    if (flash?.fill.kind === 'record') {
      expect(flash.fill.params['durationSamples']).toBe(4800);
      expect(flash.fill.contract.declaredDurationSamples).toBe(4800);
    }
  });

  it('остальные четыре шаблона длительности НЕ объявляют — область берётся, как была', async () => {
    const timeline = compose((await buildProject()).input);
    const declared = ['visual', 'music', 'caption'].flatMap((track) =>
      clipsOf(timeline, track).map((clip) => [clip.clipId, clip.fill.contract.declaredDurationSamples] as const),
    );
    // `still@1`, `kenburns@1`, `bed@1`, `captionEmphasis@1` — метода `declareDuration` нет
    // вовсе (различимо в контракте, а не выражено `null` четырьмя реализациями).
    expect(declared.every(([, value]) => value === null)).toBe(true);
    // И конец у них прежний: `bed@1` до конца дорожки, `still@1` записи — до конца `sc:turn`.
    const still = clipsOf(timeline, 'visual').find((clip) => clip.clipId === 'r:5d6e1130');
    const turn = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:turn');
    expect(still?.endSample).toBe(turn?.endSample);
  });

  it('`params` проходят сквозь Timeline ДАННЫМИ: alias внутри них не разрешается', async () => {
    const timeline = compose((await buildProject()).input);
    const bed = clipsOf(timeline, 'music')[0];
    expect(bed?.fill.kind).toBe('record');
    if (bed?.fill.kind !== 'record') return;
    // `bed@1.params.asset` и `params.inPoint.asset` остаются СТРОКАМИ-алиасами и после
    // `CP-07`: `params` в Timeline — АВТОРСКИЕ (решение владельца `CP-07`, вопрос 2). Sha
    // лежит рядом, в `contract.assets`, и подмена внутри `params` была бы интерпретацией
    // шаблона — компилятор решал бы, какое поле есть ссылка на файл.
    expect(bed.fill.params['asset']).toBe('pad-loop');
    const inPoint = bed.fill.params['inPoint'] as { asset?: unknown; offsetSamples?: unknown };
    expect(inPoint.asset).toBe('pad-loop');
    expect(inPoint.offsetSamples).toBe(96000);

    // Один alias, встреченный в `params` ДВАЖДЫ, даёт ОДНУ ссылку: список объявляет
    // `declareAssets`, а не обход `params` компилятором (долг №141 → `X-02`).
    expect(bed.fill.contract.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000004', role: 'asset' },
    ]);
  });

  it('порождённая `[img:]`-запись: alias разрешён в sha, `until` — следующий `[img:]` или конец сцены', async () => {
    const timeline = compose((await buildProject()).input);
    const [harbour, ledger, sea] = clipsOf(timeline, 'visual');
    const intro = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:intro');
    const bitSea = timeline.anchors.find((anchor) => anchor.anchorId === 'b:img-sea-1');

    expect(harbour?.fill.kind).toBe('generated');
    if (harbour?.fill.kind === 'generated') {
      expect(harbour.fill.template).toBe('still@1');
      // ОДИН ПУТЬ НА ВСЕ КЛИПЫ (`CP-07`, долг №120): полей `alias`/`assetSha` у порождённой
      // ветви больше нет. Alias живёт в АВТОРСКИХ `params` (форма `expandImg`), sha — в
      // `contract.assets`, куда его положил `still@1.declareAssets`, и роль назвал ШАБЛОН.
      expect(harbour.fill.params.asset).toBe('harbour');
      expect(harbour.fill.contract.assets).toEqual([
        { sha256: '0000000000000000000000000000000000000000000000000000000000000001', role: 'asset' },
      ]);
    }
    // В сцене `intro` следующего `[img:]` нет ⇒ конец сцены.
    expect(harbour?.endSample).toBe(intro?.endSample);
    // В сцене `turn` следующий `[img:]` есть ⇒ до него.
    expect(ledger?.endSample).toBe(bitSea?.startSample);
    expect(sea?.endSample).toBe(timeline.durationSamples);
  });

  it('дорожка `voice` директивна: клипов на ней нет', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.tracks.find((track) => track.kind === 'voice')?.items).toEqual([]);
  });

  it('все семь дорожек присутствуют в порядке `TRACK_KINDS`', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.tracks.map((track) => track.kind)).toEqual([
      'speech',
      'music',
      'sfx',
      'caption',
      'visual',
      'effect',
      'voice',
    ]);
  });
});
