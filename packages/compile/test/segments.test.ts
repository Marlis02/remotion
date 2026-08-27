// Сегментация (`CP-03`): разрезы только на чистых границах сцен, V4 ошибкой, порог обеим
// частям, таблица кандидатов с причиной у каждого отклонённого.
//
// ФИКСТУРА `fixtures/minimal` НЕ ИЗМЕНЯЕТСЯ НИ СИМВОЛОМ. Всё, чего в ней нет — восемь сцен, две
// главы, короткая сцена, клип поперёк границы, — строится ТЕСТОМ во временном каталоге
// (`ProjectExtra` в `project.ts`). Прецедент — рефрен `V-03` и быстрый дубль `CP-02`.
//
// ПОЧЕМУ АССЕРТ «≥ 6» ЖИВЁТ ЗДЕСЬ, А НЕ НА `minimal`. Roadmap §4.7 требует «на `fixtures/minimal`
// сегментов ≥ 6», и это ИЗМЕРИМО НЕДОСТИЖИМО: по ADR-0008 кандидат на разрез — только граница
// СЦЕНЫ, а сцен в фикстуре две, то есть сценный кандидат ровно один (шесть остальных —
// абзацные). Честный максимум — 2. Ассерт T8 («фикстура AC1 несёт ассерт „сегментов ≥ 6“»)
// перенесён туда, где он исполним: на синтетику из восьми сцен. Решение владельца 2026-08-26,
// вопрос 5; кандидат в правку roadmap и ADR-0003 T8 — в отчёте.

import { afterAll, describe, expect, it } from 'vitest';

import { TRACK_KINDS, asFrames, frameStartSample, timeGrid } from '@vpe/core-model';

import {
  CHAPTER_PARALLELISM,
  CROSSING_TRACKS,
  CompileError,
  NON_CROSSING_TRACKS,
  compose,
  dumpTimeline,
  type CompileProfileInput,
  type PlacedSilence,
  type Timeline,
} from '../src/index.js';

import { readFixture } from './fixture.js';
import { buildProject, cleanupRoots, type ProjectExtra } from './project.js';

afterAll(cleanupRoots);

// ── Синтетический материал (только во временных каталогах прогона) ───────────

/** Абзац «обычной» сцены: его области хватает на порог с запасом (измерено — 58320 сэмплов). */
const PARAGRAPH = 'Alpha beta gamma delta epsilon zeta here.';
/** Абзац «короткой» сцены: её области на порог НЕ хватает (измерено — 14400 сэмплов). */
const SHORT = 'Short.';

interface SynthScene {
  readonly id: string;
  readonly text?: string;
}

/** Исходник из глав и сцен. Строкой, а не файлом: в репозиторий не попадает ничего. */
function source(chapters: readonly { readonly id: string; readonly scenes: readonly SynthScene[] }[]): string {
  const body = chapters
    .map(
      (chapter) =>
        `# chapter: ${chapter.id}\n\n` +
        chapter.scenes.map((scene) => `## scene: ${scene.id}\n\n${scene.text ?? PARAGRAPH}\n`).join('\n'),
    )
    .join('\n');
  return `schema: source-dialect/1\n\n${body}`;
}

/** Одна глава `one` со сценами `s1…sN`, из которых названные — короткие. */
function oneChapter(count: number, short: readonly string[] = []): string {
  const scenes: SynthScene[] = [];
  for (let n = 1; n <= count; n += 1) {
    const id = `s${String(n)}`;
    scenes.push(short.includes(id) ? { id, text: SHORT } : { id });
  }
  return source([{ id: 'one', scenes }]);
}

/** Запись режиссуры `direction/1`. `params.asset` сквозь Timeline идёт ДАННЫМИ (`CP-01`). */
/**
 * `params` синтетической записи — ПО СХЕМЕ ЕЁ ШАБЛОНА (`CP-07`).
 *
 * До `CP-07` здесь стояло `asset: "harbour"` у любого шаблона: `params` шли сквозь Timeline
 * данными, и `bed@1` с одним полем компилировался. Теперь вызов проходит `paramsSchema` спека,
 * и «`bed@1` без `inPoint`/`gainDb`/`duckUnderSpeechDb`» — ошибка компиляции. Это не издержка
 * теста, а его же утверждение: синтетика обязана быть таким же законным вызовом, как фикстура.
 */
const PARAMS_OF: Readonly<Record<string, string>> = {
  'still@1': '      asset: "harbour"\n',
  'bed@1':
    '      asset: "harbour"\n' +
    '      inPoint: { kind: mediaTime, asset: "harbour", offsetSamples: 0 }\n' +
    '      gainDb: -18\n' +
    '      duckUnderSpeechDb: -6\n',
};

function record(
  recordId: string,
  at: string,
  until: string | null,
  track: string,
  template: string,
): string {
  const params = PARAMS_OF[template];
  if (params === undefined) throw new Error(`тест не знает \`params\` шаблона \`${template}\``);
  return (
    `  - recordId: "${recordId}"\n` +
    `    at: { kind: anchor, anchor: "${at}" }\n` +
    (until === null ? '' : `    until: { kind: anchor, anchor: "${until}" }\n`) +
    `    track: ${track}\n    z: 10\n    template: "${template}"\n    params:\n${params}`
  );
}

const direction = (...records: string[]): string => `schema: direction/1\n\nrecords:\n${records.join('\n')}`;

const build = async (text: string, extra: ProjectExtra = { direction: null }): Promise<Timeline> =>
  compose((await buildProject(text, undefined, extra)).input);

/** Ловит `CompileError` и отдаёт его — иначе `toThrow` прячет список проблем (образец `CP-01`). */
function caught(run: () => unknown): CompileError {
  try {
    run();
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error('ожидался `CompileError`, а вызов прошёл');
}

const segmentIds = (timeline: Timeline): string[] => timeline.segments.map((segment) => segment.segmentId);

/** Блок сегментов из дампа — им сравниваются раскладки, посчитанные при разных `fps`. */
function segmentBlock(timeline: Timeline): string[] {
  const lines = dumpTimeline(timeline).split('\n');
  const from = lines.findIndex((line) => line.startsWith('segments count='));
  return lines.slice(from, from + timeline.segments.length + 1);
}

// ── `fixtures/minimal` ──────────────────────────────────────────────────────

describe('CP-03 — `fixtures/minimal`: ровно два сегмента', () => {
  it('разбиение тотально, встык, и разрез стоит в КОНЦЕ сценного gap\'а (T6)', async () => {
    const timeline = compose((await buildProject()).input);
    expect(segmentIds(timeline)).toEqual(['seg:intro', 'seg:turn']);

    const [first, second] = timeline.segments;
    expect(first?.startSample).toBe(0);
    // 551760 == `atSample` (544080) + `durationSamples` (7680) сценного кандидата, а не 544080:
    // по **T6** gap принадлежит ПРЕДШЕСТВУЮЩЕМУ сегменту, значит шов идёт ЗА ним.
    expect(first?.endSample).toBe(551760);
    expect(second?.startSample).toBe(551760);
    expect(second?.endSample).toBe(timeline.durationSamples);
    expect(first?.sceneIds).toEqual(['intro']);
    expect(second?.sceneIds).toEqual(['turn']);
    expect(first?.chapterId).toBe('main');
    expect(second?.chapterId).toBe('main');
  });

  it('`Σ nominalSamples == L`, и оба числа сходятся с длинами клипов дорожки', async () => {
    const timeline = compose((await buildProject()).input);
    const sum = timeline.segments.reduce((total, segment) => total + segment.nominalSamples, 0);
    expect(sum).toBe(timeline.durationSamples);
    // `L_i` — сумма номинальных длин, и сегодня она совпадает с длиной сегмента: клипов
    // `boundary-correction` не существует до `CP-04`. Проверяется ИМЕННО совпадение двух
    // способов посчитать, а не одно число: разойтись они смогут только вместе с ошибкой.
    for (const segment of timeline.segments) {
      expect(segment.nominalSamples).toBe(segment.endSample - segment.startSample);
    }
  });

  it('`tailGap` не-последнего сегмента — ТОТ ЖЕ клип тишины, что лежит на дорожке', async () => {
    const timeline = compose((await buildProject()).input);
    const items = timeline.tracks.find((track) => track.kind === 'speech')?.items ?? [];
    const gap = items.find(
      (item): item is PlacedSilence => item.kind === 'silence' && item.startSample === 544080,
    );
    expect(gap?.boundary).toBe('scene');
    expect(gap?.endSample).toBe(551760);
    // Тождество объектов, а не равенство полей: копия клипа в сегменте могла бы разойтись
    // с дорожкой, а ссылка — нет.
    expect(timeline.segments[0]?.tailGap).toBe(gap);
    expect(timeline.segments[1]?.tailGap).toBeNull();
  });

  it('на разрезе 551760 не пересекает НИКТО, и три клипа стоят к нему вплотную (T4)', async () => {
    const timeline = compose((await buildProject()).input);
    const clips = timeline.tracks.flatMap((track) => track.items.filter((item) => item.kind === 'clip'));
    const crossing = clips.filter((clip) => clip.startSample < 551760 && 551760 < clip.endSample);
    expect(crossing).toEqual([]);
    // Полуоткрытость здесь не теория: нестрогое сравнение запретило бы единственный законный
    // разрез фикстуры сразу по трём клипам.
    //
    // ИХ СТАЛО ТРИ, А БЫЛО ЧЕТЫРЕ (`CP-07`), и ушедший назван: `r:7b20de44` (`flash@1`)
    // кончался ровно на разрезе, пока тянулся «до конца области» вопреки собственному
    // `params.durationSamples` (долг №119). Теперь он длится объявленные 4800 сэмплов и до
    // разреза не достаёт. Утверждение теста от этого не слабеет — оно про ПЕРЕСЕЧЕНИЕ, а
    // пересекающих по-прежнему ноль; список «вплотную» перечислен, чтобы полуоткрытость
    // проверялась на непустом множестве.
    const touching = clips.filter((clip) => clip.startSample === 551760 || clip.endSample === 551760);
    expect(touching.map((clip) => clip.clipId).sort()).toEqual([
      'img:b:img-harbour-1',
      'img:b:img-ledger-1',
      'r:c81a05f7',
    ]);
    const flash = clips.find((clip) => clip.clipId === 'r:7b20de44');
    expect(flash?.duration.samples).toBe(4800);
    expect(flash?.endSample).toBeLessThan(551760);
  });

  it('таблица несёт ВСЕ семь кандидатов `CP-01`, и у каждого отклонённого — причина', async () => {
    const timeline = compose((await buildProject()).input);
    const table = timeline.cutTable;
    expect(table.rows).toHaveLength(timeline.cutCandidates.length);
    expect(table.rows).toHaveLength(7);
    // Порядок строк — порядок дорожки: таблица читается вместе с дампом клипов.
    expect(table.rows.map((row) => row.atSample)).toEqual(
      timeline.cutCandidates.map((candidate) => candidate.atSample),
    );
    expect(table.cutsAccepted).toBe(1);
    expect(table.segments).toBe(2);
    expect(table.segments).toBe(timeline.segments.length);
    expect(table.rejectedByReason).toEqual({
      'not-scene-boundary': 6,
      'crossed-by-clips': 0,
      'left-too-short': 0,
      'right-too-short': 0,
    });
    const cut = table.rows.find((row) => row.decision === 'cut');
    expect(cut?.atSample).toBe(544080);
    expect(cut?.cutSample).toBe(551760);
    expect(cut?.boundary).toBe('scene');
    expect(cut?.reason).toBeNull();
    expect(cut?.leftSamples).toBe(551760);
    expect(cut?.rightSamples).toBe(625680);
    // Отклонённые не исчезают: «сегментов меньше, чем я ждал» — вопрос к отчёту, а не к коду.
    for (const row of table.rows.filter((candidate) => candidate.decision === 'rejected')) {
      expect(row.reason).toBe('not-scene-boundary');
      expect(row.boundary === 'paragraph' || row.boundary === 'intra-paragraph').toBe(true);
      expect(row.leftSamples).toBeNull();
      expect(row.rightSamples).toBeNull();
    }
  });

  it('порог берётся ИЗ ПРОФИЛЯ и переводится в сэмплы одной функцией `core-model`', async () => {
    const timeline = compose((await buildProject()).input);
    const text = readFixture('fixtures/minimal/profiles/compile.yaml');
    expect(text).toContain('minSegmentDurationFrames: 45');
    expect(timeline.cutTable.minSegmentSamples).toBe(
      frameStartSample(timeGrid(24000, { num: 30, den: 1 }), asFrames(45)),
    );
    expect(timeline.cutTable.minSegmentSamples).toBe(36000);
  });
});

// ── Ассерт T8 там, где он исполним: восемь сцен ─────────────────────────────

describe('CP-03 — синтетика: восемь сцен дают сегментов ≥ 6', () => {
  it('восемь ровных сцен ⇒ восемь сегментов, все разрезы приняты', async () => {
    const timeline = await build(oneChapter(8));
    expect(timeline.segments.length).toBeGreaterThanOrEqual(6);
    expect(segmentIds(timeline)).toEqual([
      'seg:s1', 'seg:s2', 'seg:s3', 'seg:s4', 'seg:s5', 'seg:s6', 'seg:s7', 'seg:s8',
    ]);
    expect(timeline.cutTable.cutsAccepted).toBe(7);
    expect(timeline.cutTable.rejectedByReason['left-too-short']).toBe(0);
    expect(timeline.cutTable.rejectedByReason['right-too-short']).toBe(0);
    for (const segment of timeline.segments) {
      expect(segment.endSample - segment.startSample).toBeGreaterThanOrEqual(
        timeline.cutTable.minSegmentSamples,
      );
    }
  });

  it('короткая сцена В СЕРЕДИНЕ ⇒ разрез за ней отклонён `left-too-short`, сегментов на 1 меньше', async () => {
    const timeline = await build(oneChapter(8, ['s4']));
    expect(timeline.segments).toHaveLength(7);
    // Сцена не исчезла — она приклеилась к соседке слева, и это видно в составе сегмента.
    expect(timeline.segments[3]?.sceneIds).toEqual(['s4', 's5']);
    const rejected = timeline.cutTable.rows.filter((row) => row.decision === 'rejected');
    expect(rejected).toHaveLength(1);
    const [row] = rejected;
    expect(row?.reason).toBe('left-too-short');
    // Поправка П3: автор читает ОБЕ длины и порог, а не одно слово «коротко».
    expect(row?.leftSamples).toBe(14400);
    expect(row?.rightSamples).toBeGreaterThan(timeline.cutTable.minSegmentSamples);
    expect(timeline.cutTable.minSegmentSamples).toBe(36000);
    const line = dumpTimeline(timeline)
      .split('\n')
      .find((candidate) => candidate.includes('reason=left-too-short'));
    expect(line).toContain('left=14400');
    expect(line).toContain('min=36000');
  });

  it('короткая сцена ПОСЛЕДНЯЯ ⇒ разрез перед ней отклонён `right-too-short`', async () => {
    const timeline = await build(oneChapter(8, ['s8']));
    expect(timeline.segments).toHaveLength(7);
    expect(timeline.segments.at(-1)?.sceneIds).toEqual(['s7', 's8']);
    const [row] = timeline.cutTable.rows.filter((candidate) => candidate.decision === 'rejected');
    expect(row?.reason).toBe('right-too-short');
    expect(row?.rightSamples).toBe(6720);
    expect(row?.leftSamples).toBeGreaterThanOrEqual(timeline.cutTable.minSegmentSamples);
    // Без этой проверки последний сегмент мог бы оказаться короче порога — ровно то, ради чего
    // «обе части», а не одна.
    for (const segment of timeline.segments) {
      expect(segment.endSample - segment.startSample).toBeGreaterThanOrEqual(
        timeline.cutTable.minSegmentSamples,
      );
    }
  });
});

// ── R7: что мешает разрезу, а что нет ───────────────────────────────────────

describe('CP-03 — R7: разрез только на ЧИСТОЙ границе сцены', () => {
  const spanning = (track: string, template: string): ProjectExtra => ({
    direction: direction(record('a1b2c3d4', 'sc:s1', 'sc:s2', track, template)),
  });

  it('`music` поверх сценной границы разрезу НЕ мешает: аудио не сегментируется', async () => {
    const timeline = await build(oneChapter(8), spanning('music', 'bed@1'));
    const music = timeline.tracks.find((track) => track.kind === 'music')?.items[0];
    expect(music?.startSample).toBe(0);
    // Клип действительно идёт СКВОЗЬ первый разрез — иначе тест проверял бы пустоту.
    expect(music?.endSample).toBeGreaterThan(58320);
    expect(timeline.segments).toHaveLength(8);
    expect(timeline.cutTable.rejectedByReason['crossed-by-clips']).toBe(0);
  });

  it('`visual` поверх той же границы мешает, и таблица называет `clipId` пересекающего', async () => {
    const timeline = await build(oneChapter(8), spanning('visual', 'still@1'));
    expect(timeline.segments).toHaveLength(7);
    expect(timeline.segments[0]?.sceneIds).toEqual(['s1', 's2']);
    const [row] = timeline.cutTable.rows.filter((candidate) => candidate.decision === 'rejected');
    expect(row?.reason).toBe('crossed-by-clips');
    expect(row?.crossedBy.map((clip) => clip.clipId)).toEqual(['r:a1b2c3d4']);
    expect(row?.crossedBy[0]?.track).toBe('visual');
    expect(row?.crossedBy[0]?.at).toBe('sc:s1');
    expect(row?.crossedBy[0]?.startSample).toBe(0);
    // Поправка П3: интервал каждого пересекающего клипа печатается.
    const line = dumpTimeline(timeline)
      .split('\n')
      .find((candidate) => candidate.includes('reason=crossed-by-clips'));
    expect(line).toContain('crossed=[r:a1b2c3d4 visual [0, ');
  });

  it('состав `CROSSING_TRACKS` тотален: каждое имя `TRACK_KINDS` классифицировано ровно раз', () => {
    const all = [...CROSSING_TRACKS, ...NON_CROSSING_TRACKS];
    expect([...all].sort()).toEqual([...TRACK_KINDS].sort());
    expect(new Set(all).size).toBe(all.length);
    expect([...CROSSING_TRACKS].sort()).toEqual(['caption', 'effect', 'visual']);
  });
});

// ── R6: граница главы ───────────────────────────────────────────────────────

describe('CP-03 — R6: пересечение границы главы есть ОШИБКА, а не WARN', () => {
  const twoChapters = (a2 = PARAGRAPH, b1 = PARAGRAPH): string =>
    source([
      { id: 'one', scenes: [{ id: 'a1' }, { id: 'a2', text: a2 }] },
      { id: 'two', scenes: [{ id: 'b1', text: b1 }] },
    ]);

  it('клип из главы 1 в главу 2 роняет компиляцию, называя `clipId` и ОБЕ главы', async () => {
    const extra: ProjectExtra = {
      direction: direction(record('aaaa0001', 'sc:a1', 'ch:two', 'visual', 'still@1')),
    };
    const project = await buildProject(twoChapters(), undefined, extra);
    const error = caught(() => compose(project.input));
    expect(error.rule).toBe('Charter V4');
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.address).toBe('r:aaaa0001');
    const message = error.problems[0]?.message ?? '';
    expect(message).toContain('`ch:one`');
    expect(message).toContain('`ch:two`');
    expect(message).toContain('`visual`');
    expect(message).toContain('`at` = `sc:a1`');
    // Норма названа дословно, и названа как ПРАВИЛО, а не как следствие.
    expect(message).toContain('**V4** в исходной силе');
    expect(message).toContain('а не WARN');
  });

  it('тот же клип, обрезанный до конца главы 1, собирается: граница главы — разрез', async () => {
    const timeline = await build(twoChapters(), {
      direction: direction(record('aaaa0001', 'sc:a1', 'sc:a2', 'visual', 'still@1')),
    });
    expect(segmentIds(timeline)).toEqual(['seg:a1', 'seg:b1']);
    expect(timeline.segments[0]?.chapterId).toBe('one');
    expect(timeline.segments[1]?.chapterId).toBe('two');
    // Границы сегментов ⊇ границы глав: разрез на стыке глав стоит безусловно.
    const chapterRow = timeline.cutTable.rows.find((row) => row.boundary === 'chapter');
    expect(chapterRow?.decision).toBe('cut');
    expect(chapterRow?.reason).toBe('chapter-forced');
    expect(chapterRow?.cutSample).toBe(timeline.segments[1]?.startSample);
    // А сценный разрез внутри главы 1 при этом отклонён — тем же клипом.
    const sceneRow = timeline.cutTable.rows.find((row) => row.boundary === 'scene');
    expect(sceneRow?.reason).toBe('crossed-by-clips');
  });

  it('`music` поперёк границы ГЛАВ ошибкой не является (V4 — инвариант видео-домена)', async () => {
    const timeline = await build(twoChapters(), {
      direction: direction(record('cccc0003', 'sc:a1', 'ch:two', 'music', 'bed@1')),
    });
    expect(segmentIds(timeline)).toEqual(['seg:a1', 'seg:a2', 'seg:b1']);
  });

  it('глава короче порога — законный сегмент с записью `chapter-forced` (вопрос 2 (а))', async () => {
    const timeline = await build(twoChapters(PARAGRAPH, SHORT));
    expect(segmentIds(timeline)).toEqual(['seg:a1', 'seg:a2', 'seg:b1']);
    const last = timeline.segments.at(-1);
    expect((last?.endSample ?? 0) - (last?.startSample ?? 0)).toBe(6720);
    expect((last?.endSample ?? 0) - (last?.startSample ?? 0)).toBeLessThan(
      timeline.cutTable.minSegmentSamples,
    );
    const chapterRow = timeline.cutTable.rows.find((row) => row.boundary === 'chapter');
    expect(chapterRow?.decision).toBe('cut');
    expect(chapterRow?.reason).toBe('chapter-forced');
    expect(chapterRow?.rightSamples).toBe(6720);
    // Порог — эвристика стоимости рендера, глава — авторская единица: короткая глава не роняет
    // компиляцию, но и не исчезает из отчёта.
    expect(timeline.cutTable.rejectedByReason['right-too-short']).toBe(0);
  });

  it('П1: сценная граница ПЕРЕД короткой главой принимается', async () => {
    const timeline = await build(twoChapters(PARAGRAPH, SHORT));
    const sceneRow = timeline.cutTable.rows.find((row) => row.boundary === 'scene');
    expect(sceneRow?.decision).toBe('cut');
    // Правая часть померена ДО границы главы (65040), а не до конца дорожки (71760): короткая
    // глава справа законному сценному разрезу слева не мешает.
    expect(sceneRow?.rightSamples).toBe(65040);
    expect(timeline.durationSamples - (sceneRow?.cutSample ?? 0)).toBe(71760);
  });

  it('П1 на различающем случае: короткий ХВОСТ главы отклоняет разрез `right-too-short`', async () => {
    const timeline = await build(twoChapters(SHORT, PARAGRAPH));
    const sceneRow = timeline.cutTable.rows.find((row) => row.boundary === 'scene');
    expect(sceneRow?.decision).toBe('rejected');
    expect(sceneRow?.reason).toBe('right-too-short');
    // Вот здесь два чтения расходятся: «до конца дорожки» дало бы 71760 ≥ 36000 и приняло бы
    // разрез, создав сегмент в 21120 сэмплов, которого не требовала НИ ОДНА глава. П1 инвариант
    // «каждый сегмент ≥ порога, кроме вынужденных главой» сохраняет.
    expect(sceneRow?.rightSamples).toBe(21120);
    expect(timeline.durationSamples - (sceneRow?.cutSample ?? 0)).toBe(71760);
    expect(segmentIds(timeline)).toEqual(['seg:a1', 'seg:b1']);
    expect(timeline.segments[0]?.sceneIds).toEqual(['a1', 'a2']);
  });
});

// ── `segmentId`: чем он не порядковый номер ─────────────────────────────────

describe('CP-03 — `segmentId` = `seg:<первая сцена>` (вопрос 1)', () => {
  it('новая сцена ВЫШЕ по тексту не переименовывает ни одного сегмента ниже', async () => {
    const before = await build(oneChapter(8));
    const after = await build(
      source([{ id: 'one', scenes: [{ id: 's0' }, ...Array.from({ length: 8 }, (_, n) => ({ id: `s${String(n + 1)}` }))] }]),
    );
    // Порядковый номер переименовал бы ВСЕ восемь — то есть дал бы промах кэша «из ниоткуда»
    // ровно там, где T6 и AC3 его запрещают.
    for (const id of segmentIds(before)) expect(segmentIds(after)).toContain(id);
    expect(segmentIds(after)[0]).toBe('seg:s0');
  });

  it('правка слова внутри сцены не меняет ни имён, ни состава сегментов', async () => {
    const before = await build(oneChapter(8));
    const after = await build(
      source([
        {
          id: 'one',
          scenes: Array.from({ length: 8 }, (_, n) =>
            n === 4 ? { id: 's5', text: 'Alpha beta gamma delta epsilon zeta THERE.' } : { id: `s${String(n + 1)}` },
          ),
        },
      ]),
    );
    expect(segmentIds(after)).toEqual(segmentIds(before));
    expect(after.segments.map((segment) => segment.sceneIds)).toEqual(
      before.segments.map((segment) => segment.sceneIds),
    );
  });
});

// ── Детерминизм и кадровая сетка ────────────────────────────────────────────

describe('CP-03 — детерминизм и `fps`', () => {
  it('два `compose` дают побайтово равные дампы, перестановка входов их не меняет', async () => {
    const built = await buildProject();
    expect(dumpTimeline(compose(built.input))).toBe(dumpTimeline(compose(built.input)));
    const shuffled = {
      ...built.input,
      records: [...built.input.records].reverse(),
      generated: [...built.input.generated].reverse(),
    };
    expect(dumpTimeline(compose(shuffled))).toBe(dumpTimeline(compose(built.input)));
  });

  it('`fps` 30/1 и 60/1: порог РАЗНЫЙ (36000 и 18000), а разбиение одно', async () => {
    const built = await buildProject();
    const at = (fps: CompileProfileInput['fps']): Timeline =>
      compose({ ...built.input, profile: { ...built.input.profile, fps } });
    const thirty = at({ num: 30, den: 1 });
    const sixty = at({ num: 60, den: 1 });
    // Порог задан в КАДРАХ, а кадр при 60 fps вдвое короче: одинаковыми числа быть не могут.
    expect(thirty.cutTable.minSegmentSamples).toBe(36000);
    expect(sixty.cutTable.minSegmentSamples).toBe(18000);
    // А разбиение одно и то же: обе части фикстуры больше обоих порогов.
    expect(segmentBlock(sixty)).toEqual(segmentBlock(thirty));
    expect(sixty.segments).toHaveLength(2);
  });

  it('`chapterParallelism` — КОНСТАНТА `1`, а не настройка (ADR-0008, OOM-инвариант)', () => {
    expect(CHAPTER_PARALLELISM).toBe(1);
  });
});
