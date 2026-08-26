// Дорожка речи: T5 в обеих формах, три вида тишины, числа T8, кандидаты на разрез (`CP-01`).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { compose, type PlacedSilence, type PlacedSpeech, type Timeline } from '../src/index.js';

import { REPO, fixtureCompileProfile } from './fixture.js';
import { buildProject, cleanupRoots } from './project.js';

afterAll(cleanupRoots);

const speechItems = (timeline: Timeline): readonly (PlacedSpeech | PlacedSilence)[] =>
  (timeline.tracks.find((track) => track.kind === 'speech')?.items ?? []) as readonly (
    | PlacedSpeech
    | PlacedSilence
  )[];

describe('CP-01 — T5: дорожка речи разбита тотально', () => {
  it('`Σ длительностей клипов == L`, стыки без дыр и перекрытий', async () => {
    const project = await buildProject();
    const timeline = compose(project.input);
    const items = speechItems(timeline);

    let expected = 0;
    for (const item of items) {
      expect(item.startSample, `клип ${item.clipId} начинается не там, где кончился предыдущий`).toBe(expected);
      expect(item.endSample).toBeGreaterThan(item.startSample);
      expected = item.endSample;
    }
    expect(expected).toBe(timeline.durationSamples);
    const sum = items.reduce((total, item) => total + (item.endSample - item.startSample), 0);
    expect(sum).toBe(timeline.durationSamples);
  });

  it('`Σ речевых клипов == Σ (numSamples − leadIn − tail)` по дублям — критерий roadmap', async () => {
    const project = await buildProject();
    const timeline = compose(project.input);
    const laid = speechItems(timeline)
      .filter((item): item is PlacedSpeech => item.kind === 'speech')
      .reduce((sum, item) => sum + (item.endSample - item.startSample), 0);
    const measured = [...project.takes.values()].reduce(
      (sum, take) => sum + (take.pcm.numSamples - take.leadInSamples - take.tailSamples),
      0,
    );
    expect(laid).toBe(measured);
    // Форма без поправки T7 обязана НЕ сойтись: иначе тест зеленел бы и на дорожке, куда
    // уложены сырые байты дубля вместе с тишиной провайдера.
    const raw = [...project.takes.values()].reduce((sum, take) => sum + take.pcm.numSamples, 0);
    expect(laid).not.toBe(raw);
  });

  it('речевой клип несёт окно `[leadInSamples, numSamples − tailSamples)`, а не весь PCM', async () => {
    const project = await buildProject();
    const timeline = compose(project.input);
    for (const item of speechItems(timeline)) {
      if (item.kind !== 'speech') continue;
      const take = project.takes.get(item.chunkKey);
      expect(take).toBeDefined();
      if (take === undefined) continue;
      expect(item.pcmStartSample).toBe(take.leadInSamples);
      expect(item.pcmEndSample).toBe(take.pcm.numSamples - take.tailSamples);
      expect(item.endSample - item.startSample).toBe(item.pcmEndSample - item.pcmStartSample);
      // `V-04`: края измерены, а не нулевые. Иначе окно совпало бы с сырым PCM.
      expect(take.leadInSamples).toBeGreaterThan(0);
      expect(take.tailSamples).toBeGreaterThan(0);
    }
  });
});

describe('CP-01 — T8: три вида тишины и их числа', () => {
  it('`[pause: 600ms]` даёт 14400 и НЕ складывается с межабзацным дефолтом', async () => {
    const profile = fixtureCompileProfile();
    const timeline = compose((await buildProject()).input);
    const silences = speechItems(timeline).filter((item): item is PlacedSilence => item.kind === 'silence');

    const authored = silences.filter((item) => item.silence.silenceKind === 'author');
    expect(authored.map((item) => item.silence.duration.samples)).toEqual([6000, 14400, 9600]);
    // Сложение дало бы 4320 + 14400 = 18720 на границе абзаца и 4320 + 9600 = 13920.
    expect(authored.map((item) => item.silence.duration.samples)).not.toContain(
      profile.defaultParagraphGapSamples + 14400,
    );
  });

  it('`[pause: 250ms]` внутри абзаца даёт 6000 и НОЛЬ дефолта', async () => {
    const timeline = compose((await buildProject()).input);
    const intra = speechItems(timeline).filter(
      (item): item is PlacedSilence => item.kind === 'silence' && item.boundary === 'intra-paragraph',
    );
    expect(intra).toHaveLength(1);
    expect(intra[0]?.silence.duration.samples).toBe(6000);
    expect(intra[0]?.silence.silenceKind).toBe('author');
  });

  it('межабзацная и межсценовая тишина — ровно числа профиля', async () => {
    const profile = fixtureCompileProfile();
    const timeline = compose((await buildProject()).input);
    const gaps = speechItems(timeline).filter(
      (item): item is PlacedSilence => item.kind === 'silence' && item.silence.silenceKind === 'gap',
    );
    for (const gap of gaps) {
      const expectedLength =
        gap.boundary === 'scene' ? profile.defaultSceneGapSamples : profile.defaultParagraphGapSamples;
      expect(gap.silence.duration.samples, `граница ${gap.boundary}`).toBe(expectedLength);
    }
    expect(gaps.filter((gap) => gap.boundary === 'scene')).toHaveLength(1);
    expect(gaps.filter((gap) => gap.boundary === 'paragraph')).toHaveLength(3);
  });

  it('`boundary-correction` в `CP-01` не порождается (решение владельца, вопрос 2)', async () => {
    const timeline = compose((await buildProject()).input);
    const kinds = speechItems(timeline)
      .filter((item): item is PlacedSilence => item.kind === 'silence')
      .map((item) => item.silence.silenceKind);
    expect(kinds).not.toContain('boundary-correction');
    // Вид при этом СУЩЕСТВУЕТ в закрытой таксономии `core-model` — таксономия и есть та форма,
    // которой исполнен критерий roadmap «ровно три вида» (δ определён на сегмент, `CP-03`).
    expect(new Set(kinds)).toEqual(new Set(['author', 'gap']));
  });
});

describe('CP-01 — T6: кандидаты на разрез', () => {
  it('на `fixtures/minimal` кандидатов ≥ 6 — мост к ассерту `CP-03`', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.cutCandidates.length).toBeGreaterThanOrEqual(6);
    // 7 = 3 авторские паузы + 4 дефолтных gap'а (7 абзацев, 2 сцены, 3 `[pause:]`).
    expect(timeline.cutCandidates).toHaveLength(7);
  });

  it('кандидат несёт тип границы — `CP-03` обязан знать, где стоит V4 (поправка П2)', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.cutCandidates.map((candidate) => candidate.boundary)).toEqual([
      'intra-paragraph',
      'paragraph',
      'paragraph',
      'scene',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    for (const candidate of timeline.cutCandidates) {
      expect(candidate.durationSamples).toBeGreaterThan(0);
      expect(candidate.silenceKind === 'author' || candidate.silenceKind === 'gap').toBe(true);
    }
  });

  it('каждый кандидат стоит В ТОЧКЕ клипа тишины ненулевой длины', async () => {
    const timeline = compose((await buildProject()).input);
    const silences = new Map(
      speechItems(timeline)
        .filter((item): item is PlacedSilence => item.kind === 'silence')
        .map((item) => [item.startSample, item]),
    );
    for (const candidate of timeline.cutCandidates) {
      const silence = silences.get(candidate.atSample);
      expect(silence, `в точке ${String(candidate.atSample)} нет клипа тишины`).toBeDefined();
      expect(silence?.silence.duration.samples).toBe(candidate.durationSamples);
    }
  });
});

describe('CP-01 — `defaultSceneGapSamples: 0`', () => {
  it('падает в СХЕМЕ `compile-profile/1` (`S-02`): поле объявлено `positive()`', () => {
    // Читается ТЕКСТ файла схемы, а не импортируется: `@vpe/schema` из `compile` не резолвится
    // вовсе (карта ADR-0009, четыре симлинка). Прецедент — линт-тесты `tests/lints/**`.
    const text = readFileSync(path.join(REPO, 'packages/schema/src/families/compile-profile.ts'), 'utf8');
    expect(text).toContain('defaultSceneGapSamples: z.int().positive()');
  });

  it('если вход всё же добрался до `compose` — кандидатов по сценам нет, и это видно', async () => {
    const project = await buildProject();
    const timeline = compose({
      ...project.input,
      profile: { ...project.input.profile, defaultSceneGapSamples: 0 },
    });
    // Дорожка при этом ЗАКОННА: два речевых клипа встык — не дыра. Именно поэтому инвариант
    // живёт в валидации профиля, а не в ассерте дорожки: тишины нет, и заметить её отсутствие
    // разбиение не может.
    expect(timeline.cutCandidates.filter((candidate) => candidate.boundary === 'scene')).toHaveLength(0);
    expect(timeline.cutCandidates).toHaveLength(6);
  });
});
