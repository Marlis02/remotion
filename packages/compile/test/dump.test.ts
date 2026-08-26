// Канонический дамп Timeline: «Timeline **диффится**» (core.md §1).

import { afterAll, describe, expect, it } from 'vitest';

import { compose, dumpTimeline } from '../src/index.js';

import { buildProject, cleanupRoots } from './project.js';

afterAll(cleanupRoots);

describe('CP-01 — канонический дамп', () => {
  it('несёт все семь дорожек, кандидатов и якоря, и кончается переводом строки', async () => {
    const timeline = compose((await buildProject()).input);
    const dump = dumpTimeline(timeline);
    expect(dump.endsWith('\n')).toBe(true);
    for (const kind of ['speech', 'music', 'sfx', 'caption', 'visual', 'effect', 'voice']) {
      expect(dump).toContain(`track ${kind} items=`);
    }
    expect(dump).toContain(`candidates count=${String(timeline.cutCandidates.length)}`);
    expect(dump).toContain(`anchors count=${String(timeline.anchors.length)}`);
    expect(dump).toContain(`duration=${String(timeline.durationSamples)}`);
    // Блок субтитров (`CP-02`) — часть того же дампа: зонд владельца читает его строками.
    expect(dump).toContain(`captions count=${String(timeline.captionGroups.length)}`);
  });

  it('диффится ПОСТРОЧНО: у каждого клипа своя строка, и интервалы полуоткрыты', async () => {
    const timeline = compose((await buildProject()).input);
    const lines = dumpTimeline(timeline).trimEnd().split('\n');
    const items = timeline.tracks.reduce((sum, track) => sum + track.items.length, 0);
    // 1 шапка + 7 строк дорожек + клипы + 1 строка кандидатов + кандидаты + 1 строка якорей +
    // якоря + 1 строка субтитров + группы. Последнее слагаемое дописано `CP-02`: счёт строк —
    // это утверждение «в дампе нет ничего, кроме перечисленного», и новый блок обязан войти
    // в него явно, иначе утверждение перестало бы быть тотальным.
    expect(lines).toHaveLength(
      1 + 7 + items + 1 + timeline.cutCandidates.length + 1 + timeline.anchors.length + 1 + timeline.captionGroups.length,
    );
    for (const line of lines) {
      if (!line.startsWith('  [')) continue;
      expect(line, 'интервал обязан быть полуоткрытым (ADR-0003 T4)').toMatch(/^ {2}\[\d+, \d+\)/u);
    }
  });

  it('в дампе нет ни секунд, ни миллисекунд, ни кадров — только сэмплы', async () => {
    const dump = dumpTimeline(compose((await buildProject()).input));
    for (const forbidden of ['ms', 'sec', 'frame', 'fps']) {
      expect(dump.toLowerCase(), `в дампе встретилось \`${forbidden}\``).not.toMatch(
        new RegExp(`[^a-z]${forbidden}[^a-z]`, 'u'),
      );
    }
  });
});
