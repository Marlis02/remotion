// Разрешение якорей в сэмплы: `w:`, `b:`, `b:img-…`, `sc:`/`ch:`, `nudgeSamples`, `absent`.

import { asSamples } from '@vpe/core-model';
import { afterAll, describe, expect, it } from 'vitest';

import { CompileError, anchorTimes, compose, resolvePoint, speechTrack } from '../src/index.js';

import { readFixture } from './fixture.js';
import { buildProject, cleanupRoots, type BuiltProject } from './project.js';

afterAll(cleanupRoots);

/** `AnchorTimes` того же проекта — стадии те же, что внутри `compose`, и в том же порядке. */
function timesOf(project: BuiltProject) {
  const track = speechTrack({
    document: project.input.document,
    plan: project.input.plan,
    takes: project.input.takes,
    profile: project.input.profile,
  });
  return { track, times: anchorTimes({ ...project.input, track }) };
}

/** Якорь токена по его поверхностной форме в названной сцене. */
function tokenAnchor(project: BuiltProject, sceneId: string, surface: string): string {
  const binding = project.anchors.find(
    (candidate) =>
      candidate.slot.kind === 'token' && candidate.slot.sceneId === sceneId && candidate.slot.surface === surface,
  );
  if (binding === undefined) throw new Error(`токена \`${surface}\` нет в сцене \`${sceneId}\``);
  return binding.id;
}

describe('CP-01 — якоря `w:`', () => {
  it('первый токен чанка == начало речевого клипа + (start привязки − leadIn)', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    const timeline = compose(project.input);
    const speech = timeline.tracks
      .find((track) => track.kind === 'speech')
      ?.items.filter((item) => item.kind === 'speech');
    expect(speech).toBeDefined();

    for (const clip of speech ?? []) {
      if (clip.kind !== 'speech') continue;
      const take = project.takes.get(clip.chunkKey);
      const first = take?.bindings.find((binding) => binding.status !== 'absent');
      if (take === undefined || first === undefined || first.startSample === null) continue;
      const time = times.byId.get(first.anchorId);
      expect(time, `нет времени у ${first.anchorId}`).toBeDefined();
      expect(time?.startSample).toBe(clip.startSample + (first.startSample - take.leadInSamples));
      expect(time?.endSample).toBe(clip.startSample + ((first.endSample ?? 0) - take.leadInSamples));
    }
  });

  it('сдвиг именно на `−leadIn`: первый токен первого чанка стоит в НУЛЕ, а не в `leadIn`', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    const firstChunk = project.plan.chunks[0];
    const take = firstChunk === undefined ? undefined : project.takes.get(firstChunk.chunkKey);
    const first = take?.bindings.find((binding) => binding.status !== 'absent');
    expect(take?.leadInSamples).toBeGreaterThan(0);
    expect(first?.startSample).toBe(take?.leadInSamples);
    expect(first === undefined ? undefined : times.byId.get(first.anchorId)?.startSample).toBe(0);
  });
});

describe('CP-01 — якоря `b:` и `b:img-…`', () => {
  it('бит стоит в начале следующего произносимого токена своей сцены', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    // «…ever bought. [beat: reveal] They sat here…» — следующий токен `They`.
    const beat = times.byId.get('b:reveal');
    const next = times.byId.get(tokenAnchor(project, 'intro', 'They'));
    expect(beat?.startSample).toBe(next?.startSample);
    // Бит — ТОЧКА, а не интервал: текста он не несёт (ADR-0002 §2).
    expect(beat?.startSample).toBe(beat?.endSample);
  });

  it('неявный бит `[img:]` стоит там же, где следующий токен', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    // «[img: ledger] The word is…» — следующий токен `The`.
    const bit = times.byId.get('b:img-ledger-1');
    const next = times.byId.get(tokenAnchor(project, 'turn', 'The'));
    expect(bit?.startSample).toBe(next?.startSample);
  });

  it('токен с `absent`-привязкой ПРОПУСКАЕТСЯ: бит встаёт на следующий произносимый', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace(
      'The warehouse keeper kept count of the days.',
      'The warehouse keeper [beat: mark] 🚢 kept count of the days.',
    );
    const project = await buildProject(raw);
    const { times } = timesOf(project);
    const emoji = tokenAnchor(project, 'turn', '🚢');
    expect(times.absent.has(emoji), 'эмодзи обязан получить `absent` (FACT SP-2 U6)').toBe(true);
    const beat = times.byId.get('b:mark');
    const kept = times.byId.get(tokenAnchor(project, 'turn', 'kept'));
    expect(beat?.startSample).toBe(kept?.startSample);
    expect(times.byId.has(emoji)).toBe(false);
  });

  it('маркер без произносимого соседа в СВОЕЙ сцене встаёт в конец её речи (поправка П3)', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace(
      'But each one shows what it [emph] cost.',
      'But each one shows what it [emph] cost. [beat: outro]',
    );
    const project = await buildProject(raw);
    const { track, times } = timesOf(project);
    const outro = times.byId.get('b:outro');
    expect(outro?.startSample).toBe(track.sceneSpeechEnd.get('sc:turn'));
    // Правило «следующий токен ДОКУМЕНТА» отвергнуто: за сценой `turn` токенов нет вовсе,
    // а если бы были — маркер уехал бы за границу сцены, то есть за gap.
    expect(outro?.startSample).toBe(track.durationSamples);
  });
});

describe('CP-01 — области `sc:`/`ch:` (решение владельца, вопрос 6)', () => {
  it('область = [начало первой речи, конец хвостового gap\'а); у последней — конец дорожки', async () => {
    const project = await buildProject();
    const timeline = compose(project.input);
    const intro = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:intro');
    const turn = timeline.anchors.find((anchor) => anchor.anchorId === 'sc:turn');
    const chapter = timeline.anchors.find((anchor) => anchor.anchorId === 'ch:main');

    expect(intro?.startSample).toBe(0);
    // Конец `intro` == начало `turn`: межсценовый gap принадлежит ПРЕДШЕСТВУЮЩЕЙ области (T6),
    // то есть визуал сцены идёт сквозь паузу перед следующей.
    expect(intro?.endSample).toBe(turn?.startSample);
    expect(turn?.endSample).toBe(timeline.durationSamples);
    expect(chapter?.startSample).toBe(0);
    expect(chapter?.endSample).toBe(timeline.durationSamples);

    // Разбиение областями ТОТАЛЬНО — то же свойство, что у дорожки речи.
    const sceneGap = timeline.tracks
      .find((track) => track.kind === 'speech')
      ?.items.find((item) => item.kind === 'silence' && item.boundary === 'scene');
    expect(sceneGap?.kind).toBe('silence');
    if (sceneGap?.kind === 'silence') {
      expect(sceneGap.endSample).toBe(turn?.startSample);
      expect(sceneGap.startSample).toBeGreaterThan(0);
    }
  });
});

describe('CP-01 — `nudgeSamples` и отказы', () => {
  it('`nudgeSamples` сдвигает обе границы момента', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    const plain = resolvePoint({ kind: 'anchor', anchor: 'b:reveal' }, times, 'тест');
    const nudged = resolvePoint(
      { kind: 'anchor', anchor: 'b:reveal', nudgeSamples: asSamples(1200) },
      times,
      'тест',
    );
    expect(nudged.startSample).toBe(plain.startSample + 1200);
    expect(nudged.endSample).toBe(plain.endSample + 1200);
  });

  it('`absent` под ссылкой — ошибка со списком, а не ноль и не интерполяция (**V8**)', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace(
      'But each one shows what it [emph] cost.',
      'But each one shows what it [emph] cost 🚢.',
    );
    const project = await buildProject(raw);
    const { times } = timesOf(project);
    const emoji = tokenAnchor(project, 'turn', '🚢.');
    expect(times.absent.has(emoji)).toBe(true);

    let thrown: unknown;
    try {
      resolvePoint({ kind: 'anchor', anchor: emoji }, times, 'запись `тест`');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CompileError);
    expect((thrown as CompileError).problems).toHaveLength(1);
    expect((thrown as CompileError).problems[0]?.message).toContain('absent');
    expect((thrown as CompileError).message).toContain('V8');
  });

  it('несуществующий якорь — ошибка `ADR-0004 §9`, а не «ноль»', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    expect(() => resolvePoint({ kind: 'anchor', anchor: 'b:нет-такого' }, times, 'тест')).toThrow(
      /не разрешается/u,
    );
  });

  it('якорь пространства `r:` — отказ вслух: его время не определено ни одним ADR', async () => {
    const project = await buildProject();
    const { times } = timesOf(project);
    expect(() => resolvePoint({ kind: 'anchor', anchor: 'r:a3f19c2b' }, times, 'тест')).toThrow(
      /не определено ни одним ADR/u,
    );
  });
});
