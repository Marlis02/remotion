// Отказы компиляции: каждый — со СПИСКОМ, каждый называет правило и что чинить.

import { asSamples } from '@vpe/core-model';
import { VoiceError, parseTakeFile, renderTakeFile } from '@vpe/voice';
import { afterAll, describe, expect, it } from 'vitest';

import { CompileError, compose } from '../src/index.js';

import { readFixture } from './fixture.js';
import { buildProject, cleanupRoots } from './project.js';

afterAll(cleanupRoots);

/** Ловит `CompileError` и отдаёт его — иначе `expect(...).toThrow` прячет список проблем. */
function caught(run: () => unknown): CompileError {
  try {
    run();
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error('ожидался `CompileError`, а вызов прошёл');
}

describe('CP-01 — отсутствующие и негодные дубли', () => {
  it('нет дубля ⇒ ошибка со списком `chunkKey`, а не молчаливый пропуск', async () => {
    const project = await buildProject();
    const takes = new Map(project.takes);
    const dropped = [project.plan.chunks[1]?.chunkKey ?? '', project.plan.chunks[4]?.chunkKey ?? ''];
    for (const key of dropped) takes.delete(key);

    const error = caught(() => compose({ ...project.input, takes }));
    expect(error.rule).toBe('ADR-0010 §2');
    expect(error.problems).toHaveLength(2);
    expect(error.problems.map((problem) => problem.address).sort()).toEqual([...dropped].sort());
    expect(error.message).toContain('не выдумывает время');
  });

  it('весь-тихий дубль ⇒ ошибка, и текст объясняет, что `V-02` пропустила его ЗАКОННО', async () => {
    const project = await buildProject();
    const takes = new Map(project.takes);
    const key = project.plan.chunks[2]?.chunkKey ?? '';
    const take = takes.get(key);
    expect(take).toBeDefined();
    if (take === undefined) return;
    // `allSilent` в take-файл не идёт (долг №99): на диске «весь тихий» выглядит именно так —
    // края в сумме покрывают всю дорожку.
    takes.set(key, { ...take, leadInSamples: take.pcm.numSamples, tailSamples: asSamples(0) });

    const error = caught(() => compose({ ...project.input, takes }));
    expect(error.rule).toBe('ADR-0003 T7');
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.address).toBe(key);
    expect(error.problems[0]?.message).toContain('весь тихий');
    expect(error.problems[0]?.message).toContain('ЗАКОННО');
    expect(error.problems[0]?.message).toContain('судит `alignment`');
  });

  it('края не сходятся (`leadIn + tail > numSamples`) ⇒ отдельное сообщение', async () => {
    const project = await buildProject();
    const takes = new Map(project.takes);
    const key = project.plan.chunks[0]?.chunkKey ?? '';
    const take = takes.get(key);
    if (take === undefined) return;
    takes.set(key, { ...take, leadInSamples: asSamples(take.pcm.numSamples), tailSamples: asSamples(1) });
    const error = caught(() => compose({ ...project.input, takes }));
    expect(error.problems[0]?.message).toContain('не сходятся');
    expect(error.problems[0]?.message).toContain('вывернут');
  });

  it('дубль не на частоте проекта ⇒ ошибка `ADR-0003 T1`', async () => {
    const project = await buildProject();
    const takes = new Map(project.takes);
    const key = project.plan.chunks[0]?.chunkKey ?? '';
    const take = takes.get(key);
    if (take === undefined) return;
    takes.set(key, { ...take, pcm: { ...take.pcm, sampleRate: 44100 } });
    const error = caught(() => compose({ ...project.input, takes }));
    expect(error.rule).toBe('ADR-0003 T1');
    expect(error.problems[0]?.message).toContain('44100');
  });
});

describe('CP-01 — нулевая авторская пауза на структурной границе (поправка П1)', () => {
  it('на границе СЦЕНЫ ⇒ ошибка, текст называет T8 и T6', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace(
      '## scene: turn\n\n[img: ledger]',
      '## scene: turn\n\n[pause: 0ms]\n\n[img: ledger]',
    );
    const project = await buildProject(raw);
    const error = caught(() => compose(project.input));
    expect(error.rule).toBe('ADR-0003 T8');
    expect(error.problems[0]?.address).toBe('sc:turn');
    expect(error.problems[0]?.message).toContain('**T6**');
    expect(error.problems[0]?.message).toContain('**T8**');
    expect(error.problems[0]?.message).toContain('`defaultSceneGapSamples > 0` проверяет');
  });

  it('на границе ГЛАВЫ ⇒ ошибка `Charter V4`, текст называет и T8, и V4', async () => {
    const raw = `${readFixture('fixtures/minimal/source/01-intro.md')}
# chapter: second

## scene: outro

[pause: 0ms]

A final word here.
`;
    const project = await buildProject(raw);
    const error = caught(() => compose(project.input));
    expect(error.rule).toBe('Charter V4');
    expect(error.problems[0]?.address).toBe('ch:second');
    expect(error.problems[0]?.message).toContain('**V4**');
    expect(error.problems[0]?.message).toContain('**T8**');
    expect(error.problems[0]?.message).toContain('невыполнимым');
  });

  it('НЕнулевая авторская пауза на границе сцены законна и переопределяет дефолт', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace(
      '## scene: turn\n\n[img: ledger]',
      '## scene: turn\n\n[pause: 100ms]\n\n[img: ledger]',
    );
    const timeline = compose((await buildProject(raw)).input);
    const sceneSilence = timeline.tracks
      .find((track) => track.kind === 'speech')
      ?.items.find((item) => item.kind === 'silence' && item.boundary === 'scene');
    expect(sceneSilence?.kind).toBe('silence');
    if (sceneSilence?.kind !== 'silence') return;
    expect(sceneSilence.silence.silenceKind).toBe('author');
    // 100 мс при 24 кГц — 2400, а НЕ 7680 профиля и не сумма 7680 + 2400.
    expect(sceneSilence.silence.duration.samples).toBe(2400);
  });
});

describe('CP-01 — ассеты и форма take-файла', () => {
  it('неизвестный alias `[img:]` ⇒ ошибка, а не картинка-невидимка', async () => {
    const raw = readFixture('fixtures/minimal/source/01-intro.md').replace('[img: sea]', '[img: nosuch]');
    const project = await buildProject(raw);
    const error = caught(() => compose(project.input));
    expect(error.rule).toBe('ADR-0002 §4');
    expect(error.problems[0]?.message).toContain('`nosuch`');
    expect(error.problems[0]?.message).toContain('aliases.yaml');
  });

  it('строгий читатель take-файла называет ФАЙЛ и ПОЛЕ, а не «файл не разобрался»', async () => {
    const project = await buildProject();
    const take = [...project.takes.values()][0];
    expect(take).toBeDefined();
    if (take === undefined) return;
    const text = renderTakeFile(take);
    expect(parseTakeFile(text, 'voice/takes/x.json')).toEqual(take);

    const broken = text.replace(/"leadInSamples":\d+/u, '"leadInSamples":"сто"');
    let thrown: unknown;
    try {
      parseTakeFile(broken, 'voice/takes/x.json');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(VoiceError);
    expect((thrown as VoiceError).message).toContain('voice/takes/x.json');
    expect((thrown as VoiceError).message).toContain('leadInSamples');
    expect((thrown as VoiceError).message).toContain('ADR-0010 §2');
  });

  it('`absent`-привязка читается размеченным объединением, а не плоско (**V8**)', async () => {
    const project = await buildProject();
    const take = [...project.takes.values()][0];
    if (take === undefined) return;
    const withAbsent = {
      ...take,
      bindings: [{ anchorId: take.bindings[0]?.anchorId ?? '', startSample: null, endSample: null, status: 'absent', confidence: null }],
    };
    const text = renderTakeFile(withAbsent as unknown as typeof take);
    expect(parseTakeFile(text, 'voice/takes/x.json').bindings[0]?.status).toBe('absent');

    // Интервал `[t, t]` для проглоченного слова — не «запрещён проверкой», а не читается.
    const lying = text.replace('"startSample":null', '"startSample":10');
    expect(() => parseTakeFile(lying, 'voice/takes/x.json')).toThrow(/absent/u);
  });
});
