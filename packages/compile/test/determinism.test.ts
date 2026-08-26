// Детерминизм Timeline: порядок чтения каталогов, перестановка входов, правка слова (**D7**).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readDirection, type DirectionSource } from '@vpe/core-model';
import { afterAll, describe, expect, it } from 'vitest';

import { compose, dumpTimeline, readDirectionSources, type PlacedClip, type Timeline } from '../src/index.js';

import { REPO, readFixture } from './fixture.js';
import { buildProject, cleanupRoots } from './project.js';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  temps.length = 0;
  cleanupRoots();
});

/** Тот же набор записей режиссуры, разложенный по ДВУМ файлам во временном каталоге. */
function splitDirection(): { dir: string; names: readonly string[] } {
  const text = readFixture('fixtures/minimal/direction/01-intro.yaml');
  const first = text.indexOf('  - recordId:');
  const header = text.slice(0, first);
  const records = text.slice(first).split(/(?=^ {2}- recordId:)/mu);
  const dir = mkdtempSync(path.join(tmpdir(), 'vpe-cp01-dir-'));
  temps.push(dir);
  writeFileSync(path.join(dir, '01-a.yaml'), header + records.slice(0, 2).join(''), 'utf8');
  writeFileSync(path.join(dir, '02-b.yaml'), header + records.slice(2).join(''), 'utf8');
  return { dir, names: ['01-a.yaml', '02-b.yaml'] };
}

const clipsOf = (timeline: Timeline, kind: string): readonly PlacedClip[] =>
  (timeline.tracks.find((track) => track.kind === kind)?.items ?? []).filter(
    (item): item is PlacedClip => item.kind === 'clip',
  );

describe('CP-01 — детерминизм', () => {
  it('два вызова `compose` на одном входе дают побайтово равные дампы', async () => {
    const project = await buildProject();
    expect(dumpTimeline(compose(project.input))).toBe(dumpTimeline(compose(project.input)));
  });

  it('перестановка входных массивов не меняет Timeline ни на байт', async () => {
    const project = await buildProject();
    const base = dumpTimeline(compose(project.input));
    const shuffled = dumpTimeline(
      compose({
        ...project.input,
        records: [...project.input.records].reverse(),
        generated: [...project.input.generated].reverse(),
        anchors: [...project.input.anchors].reverse(),
        takes: new Map([...project.input.takes.entries()].reverse()),
      }),
    );
    expect(shuffled).toBe(base);
  });

  it('перестановка ФАЙЛОВ в каталоге режиссуры не меняет Timeline — критерий roadmap', async () => {
    const project = await buildProject();
    const base = dumpTimeline(compose(project.input));
    const split = splitDirection();

    const sorted = readDirectionSources(split.dir);
    expect(sorted.map((source) => source.filePath)).toEqual(['direction/01-a.yaml', 'direction/02-b.yaml']);

    const world = { ledger: project.ledger, document: project.input.document };
    const asRead = (sources: readonly DirectionSource[]): string =>
      dumpTimeline(compose({ ...project.input, records: readDirection(sources, world) }));

    expect(asRead(sorted)).toBe(base);
    expect(asRead([...sorted].reverse())).toBe(base);
  });

  it('`readdir` в пакете зовётся ТОЛЬКО с явной сортировкой (ADR-0007 §4)', () => {
    const load = readFileSync(path.join(REPO, 'packages/compile/src/timeline/load.ts'), 'utf8');
    // Единственное обращение к каталогу в пакете — и оно сортируется в той же строке.
    const calls = load.split('\n').filter((line) => line.includes('readdirSync('));
    expect(calls).toHaveLength(1);
    expect(calls[0], 'обращение к каталогу без явной сортировки').toContain('.sort()');
  });

  it('`compose.ts` не касается диска — граница чтения вынесена в `load.ts` (поправка П4)', () => {
    const composeSrc = readFileSync(path.join(REPO, 'packages/compile/src/timeline/compose.ts'), 'utf8');
    for (const forbidden of ['node:fs', 'node:path', 'readdir', 'readFile', 'Date.now', 'Math.random', 'node:crypto']) {
      expect(composeSrc, `в \`compose.ts\` найдено \`${forbidden}\``).not.toContain(forbidden);
    }
  });

  it('`@vpe/schema` из пакета `compile` не импортируется ни одной строкой (охранник M-серии)', () => {
    const dir = path.join(REPO, 'packages/compile/src');
    const files = ['timeline/anchors.ts', 'timeline/compose.ts', 'timeline/dump.ts', 'timeline/errors.ts', 'timeline/load.ts', 'timeline/records.ts', 'timeline/speech-track.ts', 'timeline/types.ts', 'index.ts'];
    for (const file of files) {
      // Проверяется ИМПОРТ, а не подстрока: имя пакета законно встречается в комментариях,
      // объясняющих, почему его здесь нет.
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toMatch(/from '@vpe\/schema'/u);
    }
  });
});

describe('CP-01 — правка одного слова (**D7**, поправка П5)', () => {
  it('меняется ровно один `chunkKey`; порядок клипов прежний; позиции ниже сдвинуты, выше — нет', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md');
    const edited = raw.replace('The town archive kept a list of those goods.', 'The town archive kept a record of those goods.');
    expect(edited).not.toBe(raw);

    const before = await buildProject();
    const after = await buildProject(edited);
    const timelineBefore = compose(before.input);
    const timelineAfter = compose(after.input);

    // 1. Ровно один `chunkKey` сменился.
    const keysBefore = before.plan.chunks.map((chunk) => chunk.chunkKey);
    const keysAfter = after.plan.chunks.map((chunk) => chunk.chunkKey);
    expect(keysAfter).toHaveLength(keysBefore.length);
    const changed = keysBefore.filter((key, index) => key !== keysAfter[index]);
    expect(changed).toHaveLength(1);
    const editedIndex = keysBefore.indexOf(changed[0] ?? '');
    expect(editedIndex).toBe(3); // сцена `intro`, третий абзац

    // 2. Порядок клипов на КАЖДОМ треке не изменился (**D7**).
    for (const kind of ['music', 'sfx', 'caption', 'visual', 'effect', 'voice']) {
      expect(clipsOf(timelineAfter, kind).map((clip) => clip.clipId), kind).toEqual(
        clipsOf(timelineBefore, kind).map((clip) => clip.clipId),
      );
    }

    // 3. Абсолютные позиции: выше точки правки — те же, ниже — сдвинулись.
    const speechBefore = timelineBefore.tracks.find((track) => track.kind === 'speech')?.items ?? [];
    const speechAfter = timelineAfter.tracks.find((track) => track.kind === 'speech')?.items ?? [];
    const editedStart = speechBefore.filter((item) => item.kind === 'speech')[editedIndex]?.startSample ?? 0;
    for (let index = 0; index < speechBefore.length; index += 1) {
      const left = speechBefore[index];
      const right = speechAfter[index];
      if (left === undefined || right === undefined) continue;
      if (left.endSample <= editedStart) expect(right.startSample, `клип ${left.clipId}`).toBe(left.startSample);
    }
    expect(timelineAfter.durationSamples).not.toBe(timelineBefore.durationSamples);
    const lastBefore = speechBefore[speechBefore.length - 1];
    const lastAfter = speechAfter[speechAfter.length - 1];
    expect(lastAfter?.startSample).not.toBe(lastBefore?.startSample);

    // 4. Дамп различается только начиная с правленого клипа.
    // Шапка дампа несёт `duration=` и потому меняется всегда — сравниваются СТРОКИ КЛИПОВ.
    const linesBefore = dumpTimeline(timelineBefore).split('\n').slice(1);
    const linesAfter = dumpTimeline(timelineAfter).split('\n').slice(1);
    const firstDiff = linesBefore.findIndex((line, index) => line !== linesAfter[index]);
    expect(firstDiff).toBeGreaterThanOrEqual(0);
    expect(linesBefore[firstDiff]).toContain(`speech chunk=${changed[0] ?? ''}`);
  });
});
