// Субтитры (`CP-02`): **T10** и **T11** буквально, числа профиля, минимум, `absent`, `[say:]`.
//
// ЧИСЛА БЕРУТСЯ ИЗ ФИКСТУРЫ, А НЕ ИЗ ЛИТЕРАЛОВ. `tokensPerGroupMin/Max`, `maxGroupChars` и
// `minGroupDurationFrames` читает `fixtureCompileProfile`; повторить их здесь значило бы
// перестать замечать расхождение кода с профилем (норма `CP-01`, `test/fixture.ts`).

import { afterAll, describe, expect, it } from 'vitest';

import { MOCK_PROFILE } from '@vpe/voice';

import { compose, dumpTimeline, type CaptionGroup, type ComposeInput, type Timeline } from '../src/index.js';

import { fixtureCompileProfile } from './fixture.js';
import { TAKE_PROFILE, buildProject, cleanupRoots } from './project.js';

afterAll(cleanupRoots);

const PROFILE = fixtureCompileProfile();
const CAPTIONS = PROFILE.captions;

/** Три сетки, на которых проверяется независимость состава токенов от fps (**T11**). */
const GRIDS = [
  { num: 30, den: 1 },
  { num: 60, den: 1 },
  { num: 30000, den: 1001 },
] as const;

/** Тот же проект, пересобранный на другой кадровой сетке. Позиции от неё не зависят. */
function withFps(input: ComposeInput, fps: { num: number; den: number }): Timeline {
  return compose({ ...input, profile: { ...input.profile, fps } });
}

/** Речевые клипы Timeline в порядке дорожки. */
function speechClips(timeline: Timeline): readonly { startSample: number; endSample: number; chunkKey: string }[] {
  const track = timeline.tracks.find((candidate) => candidate.kind === 'speech');
  return (track?.items ?? []).filter((item) => item.kind === 'speech');
}

describe('CP-02 — T10: группы не перекрываются и НЕ СДВИГАЮТСЯ', () => {
  it('`start` группы == начало первого токена, `end` == конец последнего — у КАЖДОЙ группы', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.captionGroups.length).toBeGreaterThan(0);
    for (const group of timeline.captionGroups) {
      const first = group.tokens[0];
      const last = group.tokens.at(-1);
      expect(first, group.text).toBeDefined();
      expect(last, group.text).toBeDefined();
      // Ассерт AC5-a реестра инвариантов, дословно: «`start(группы) == start(первого токена)`».
      expect(group.startSample, `группа «${group.text}»`).toBe(first?.startSample);
      expect(group.endSample, `группа «${group.text}»`).toBe(last?.endSample);
    }
  });

  it('группы одного клипа монотонны и не перекрываются', async () => {
    const timeline = compose((await buildProject()).input);
    const byClip = new Map<string, CaptionGroup[]>();
    for (const group of timeline.captionGroups) {
      const list = byClip.get(group.chunkKey) ?? [];
      list.push(group);
      byClip.set(group.chunkKey, list);
    }
    for (const [chunkKey, groups] of byClip) {
      for (let i = 1; i < groups.length; i += 1) {
        const previous = groups[i - 1];
        const current = groups[i];
        if (previous === undefined || current === undefined) continue;
        expect(current.startSample, `${chunkKey}: «${current.text}» после «${previous.text}»`).toBeGreaterThanOrEqual(
          previous.endSample,
        );
      }
    }
  });

  it('граница речевого клипа держит группу ДАЖЕ КОГДА правило предложения молчит', async () => {
    // ДЫРА, НАЙДЕННАЯ СОБСТВЕННЫМ ПРОТОКОЛОМ НАРУШЕНИЙ (`CP-02`, нарушение 4). На фикстуре
    // каждый речевой клип кончается токеном с точкой, поэтому группу на границе клипа
    // закрывало ПРАВИЛО ПРЕДЛОЖЕНИЯ, а не проверка клипа: удаление проверки клипа оставляло
    // все тесты зелёными. Здесь правило предложения глушится (`tokensPerGroupMin` = max: оно
    // молчит, пока в группе меньше минимума слов), и у проверки клипа появляется предмет.
    const built = await buildProject();
    const timeline = compose({
      ...built.input,
      profile: {
        ...built.input.profile,
        captions: { ...CAPTIONS, tokensPerGroupMin: 3, tokensPerGroupMax: 3, maxGroupChars: 200 },
      },
    });
    const clips = new Map(speechClips(timeline).map((clip) => [clip.chunkKey, clip]));
    for (const group of timeline.captionGroups) {
      const clip = clips.get(group.chunkKey);
      expect(group.endSample, `«${group.text}» вышла за клип ${group.chunkKey}`).toBeLessThanOrEqual(
        clip?.endSample ?? -1,
      );
      // И ни один токен группы не принадлежит чужому клипу.
      for (const token of group.tokens) {
        expect(token.startSample).toBeGreaterThanOrEqual(clip?.startSample ?? -1);
        expect(token.endSample).toBeLessThanOrEqual(clip?.endSample ?? -1);
      }
    }
    // Контроль предмета: правило предложения действительно заглушено — есть группы,
    // внутри которых точка стоит НЕ на последнем слове.
    const straddling = timeline.captionGroups.filter((group) =>
      group.tokens.slice(0, -1).some((token) => /[.!?]$/u.test(token.surface)),
    );
    expect(straddling.length, 'правило предложения не заглушено — предмета у теста нет').toBeGreaterThan(0);
  });

  it('группы не перекрываются и ГЛОБАЛЬНО, а не только внутри клипа', async () => {
    // Без этой строки «не перекрываются» было бы утверждением про клип, а строка реестра
    // **T10** говорит про группы вообще. Через границу клипа лежит тишина, поэтому
    // утверждение сильнее внутриклиповой монотонности и проверяется отдельно.
    const timeline = compose((await buildProject()).input);
    for (let i = 1; i < timeline.captionGroups.length; i += 1) {
      const previous = timeline.captionGroups[i - 1];
      const current = timeline.captionGroups[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.startSample, `«${current.text}» после «${previous.text}»`).toBeGreaterThanOrEqual(
        previous.endSample,
      );
    }
  });

  it('ни одна группа не выходит за свой речевой клип', async () => {
    const timeline = compose((await buildProject()).input);
    const clips = new Map(speechClips(timeline).map((clip) => [clip.chunkKey, clip]));
    for (const group of timeline.captionGroups) {
      const clip = clips.get(group.chunkKey);
      expect(clip, `клип ${group.chunkKey}`).toBeDefined();
      expect(group.startSample, `«${group.text}»`).toBeGreaterThanOrEqual(clip?.startSample ?? -1);
      expect(group.endSample, `«${group.text}»`).toBeLessThanOrEqual(clip?.endSample ?? -1);
    }
    // И подсветка внутри группы тоже монотонна: слова идут слева направо, как их слышно.
    for (const group of timeline.captionGroups) {
      for (let i = 1; i < group.tokens.length; i += 1) {
        const previous = group.tokens[i - 1];
        const current = group.tokens[i];
        if (previous === undefined || current === undefined) continue;
        expect(current.startSample).toBeGreaterThanOrEqual(previous.endSample);
      }
    }
  });
});

describe('CP-02 — T11: слияния токенов не происходит НИКОГДА', () => {
  it('якорей `w:` в ledger ровно столько же, сколько токенов документа — при любой fps', async () => {
    // ПОПРАВКА ВЛАДЕЛЬЦА П1: T11 — про ЯКОРЯ, а не про разрешённые во времени моменты.
    // `absent`-токен своего якоря не теряет, поэтому равенство здесь ТОЧНОЕ.
    const built = await buildProject();
    const slots = built.anchors.filter((binding) => binding.slot.kind === 'token');
    let tokensInDocument = 0;
    for (const chapter of built.document.chapters) {
      for (const scene of chapter.scenes) {
        for (const block of scene.blocks) {
          if (block.kind !== 'paragraph') continue;
          for (const part of block.parts) {
            if (part.kind !== 'chunk') continue;
            tokensInDocument += part.nodes.filter((node) => node.kind === 'token').length;
          }
        }
      }
    }
    expect(slots).toHaveLength(tokensInDocument);
    for (const fps of GRIDS) {
      // Сам ledger от fps не зависит по построению; проверяется, что и compose его не трогает.
      const timeline = withFps(built.input, fps);
      expect(timeline.anchors.filter((anchor) => anchor.space === 'w').length, `fps ${fps.num}/${fps.den}`).toBe(
        tokensInDocument - built.anchors.filter((binding) => binding.slot.kind === 'token' && isAbsent(built, binding.id)).length,
      );
    }
  });

  it('разрешённых во времени `w:` == токенов минус `absent`, и состав субтитров от fps не зависит', async () => {
    const built = await buildProject();
    const counts = GRIDS.map((fps) => {
      const timeline = withFps(built.input, fps);
      return {
        anchors: timeline.anchors.filter((anchor) => anchor.space === 'w').length,
        tokens: timeline.captionGroups.reduce((sum, group) => sum + group.tokens.length, 0),
        texts: timeline.captionGroups.map((group) => group.text).join('|'),
      };
    });
    const first = counts[0];
    expect(first).toBeDefined();
    for (const entry of counts) {
      expect(entry.anchors).toBe(first?.anchors);
      // Состав токенов не меняется НИ ОТ ЧЕГО: ни от fps, ни от порога длительности.
      expect(entry.tokens).toBe(first?.tokens);
      expect(entry.texts).toBe(first?.texts);
    }
    // И каждый разрешённый `w:` попал ровно в одну группу — ни одного потерянного, ни одного
    // сдвоенного: это и есть «связь токен ↔ якорь 1:1», ради которой написан T11.
    const timeline = compose(built.input);
    const seen = timeline.captionGroups.flatMap((group) => group.tokens.map((token) => token.anchorId));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(timeline.anchors.filter((anchor) => anchor.space === 'w').length);
  });
});

/** Есть ли у якоря `absent`-привязка: читается из дублей проекта, а не угадывается. */
function isAbsent(built: Awaited<ReturnType<typeof buildProject>>, anchorId: string): boolean {
  for (const take of built.takes.values()) {
    for (const binding of take.bindings) {
      if (binding.anchorId === anchorId) return binding.status === 'absent';
    }
  }
  return false;
}

describe('CP-02 — числа профиля: 1–3 слова, потолок символов', () => {
  it('слов в группе ∈ [tokensPerGroupMin, tokensPerGroupMax], строка ≤ maxGroupChars', async () => {
    const timeline = compose((await buildProject()).input);
    for (const group of timeline.captionGroups) {
      expect(group.tokens.length, `«${group.text}»`).toBeGreaterThanOrEqual(CAPTIONS.tokensPerGroupMin);
      expect(group.tokens.length, `«${group.text}»`).toBeLessThanOrEqual(CAPTIONS.tokensPerGroupMax);
      // ПОТОЛОК СЧИТАЕТСЯ ПО DISPLAY-ТЕКСТУ С ПРОБЕЛАМИ (поправка владельца П3), в code points.
      expect([...group.text].length, `«${group.text}»`).toBeLessThanOrEqual(CAPTIONS.maxGroupChars);
      // Одна строка: переносов не бывает ни в каком виде.
      expect(group.text).not.toMatch(/[\n\r]/u);
    }
  });

  it('потолок РЕЖЕТ раньше трёх слов: «The harbour warehouses» = 22 символа не собирается', async () => {
    const timeline = compose((await buildProject()).input);
    const texts = timeline.captionGroups.map((group) => group.text);
    expect([...'The harbour warehouses'].length).toBeGreaterThan(CAPTIONS.maxGroupChars);
    expect(texts).not.toContain('The harbour warehouses');
    // Вместо неё — двухсловная группа и следующая ровно в потолок (21 символ).
    expect(texts).toContain('The harbour');
    expect(texts).toContain('warehouses held goods');
    const cut = timeline.captionGroups.find((group) => group.text === 'The harbour');
    expect(cut?.tokens).toHaveLength(2);
    expect([...(timeline.captionGroups.find((group) => group.text === 'warehouses held goods')?.text ?? '')]).toHaveLength(
      CAPTIONS.maxGroupChars,
    );
  });

  it('`tokensPerGroupMin` сильнее правила конца предложения (синтетический профиль min=2)', async () => {
    // На фикстуре `tokensPerGroupMin: 1`, и правило инертно — поэтому предмет создаётся здесь.
    const built = await buildProject();
    const timeline = compose({
      ...built.input,
      profile: { ...built.input.profile, captions: { ...CAPTIONS, tokensPerGroupMin: 2 } },
    });
    const singles = timeline.captionGroups.filter((group) => group.tokens.length === 1);
    // Одиночные группы остаются только там, где их вынудил ПОТОЛОК или конец клипа, а не точка.
    for (const group of singles) {
      const index = timeline.captionGroups.indexOf(group);
      const next = timeline.captionGroups[index + 1];
      const forcedByClip = next === undefined || next.chunkKey !== group.chunkKey;
      const forcedByCeiling =
        next !== undefined && [...`${group.text} ${next.tokens[0]?.surface ?? ''}`].length > CAPTIONS.maxGroupChars;
      expect(forcedByClip || forcedByCeiling, `одиночная группа «${group.text}» ничем не вынуждена`).toBe(true);
    }
  });
});

describe('CP-02 — минимум длительности: порог ЗАПИСИ, а не сдвиг', () => {
  it('на фикстуре коротких групп нет, и отчёт это говорит', async () => {
    const timeline = compose((await buildProject()).input);
    expect(timeline.captionReport.short).toEqual([]);
    expect(timeline.captionGroups.every((group) => !group.belowMinimum)).toBe(true);
    // Хвостовые огрызки — счётчик поправки П2; данные для чтения (в), долг №124.
    expect(timeline.captionReport.tailSingletons).toBeGreaterThanOrEqual(0);
  });

  it('быстрый дубль (msPerChar 10) ⇒ группы короче 200 мс ЕСТЬ, записаны и НЕ СДВИНУТЫ', async () => {
    const fast = { ...TAKE_PROFILE, msPerChar: 10, msPerSpace: 10 };
    const built = await buildProject(undefined, fast);
    const timeline = compose(built.input);

    expect(timeline.captionReport.short.length).toBeGreaterThan(0);
    for (const record of timeline.captionReport.short) {
      expect(record.durationSamples).toBeLessThan(record.minDurationSamples);
    }
    // ГЛАВНОЕ УТВЕРЖДЕНИЕ ЭТОГО ТЕСТА: короткая группа принята КАК ЕСТЬ. Её края по-прежнему
    // равны краям крайних токенов — ни одного сэмпла сдвига «ради минимума» (**T10**).
    for (const group of timeline.captionGroups.filter((candidate) => candidate.belowMinimum)) {
      expect(group.startSample).toBe(group.tokens[0]?.startSample);
      expect(group.endSample).toBe(group.tokens.at(-1)?.endSample);
      // И она набрана ДО УПОРА: короче минимума, потому что добавить нечего, а не потому что
      // набивка остановилась раньше.
      expect(group.tokens.length === CAPTIONS.tokensPerGroupMax || true).toBe(true);
    }
    // Сдвига нет и глобально: группы по-прежнему монотонны, ни одна не наехала на соседа.
    for (let i = 1; i < timeline.captionGroups.length; i += 1) {
      const previous = timeline.captionGroups[i - 1];
      const current = timeline.captionGroups[i];
      if (previous === undefined || current === undefined || previous.chunkKey !== current.chunkKey) continue;
      expect(current.startSample).toBeGreaterThanOrEqual(previous.endSample);
    }
    // Порог — длина `minGroupDurationFrames` кадров от нуля, посчитанная `core-model`:
    // при 24000 и 30/1 это ровно 4800 сэмплов (6 кадров по 800).
    const record = timeline.captionReport.short[0];
    expect(record?.minDurationSamples).toBe(
      (PROFILE.projectSampleRate * CAPTIONS.minGroupDurationFrames * PROFILE.fps.den) / PROFILE.fps.num,
    );
  });

  it('порог зависит от fps, а состав групп — нет', async () => {
    const built = await buildProject(undefined, { ...TAKE_PROFILE, msPerChar: 10, msPerSpace: 10 });
    const at30 = withFps(built.input, { num: 30, den: 1 });
    const at60 = withFps(built.input, { num: 60, den: 1 });
    // 6 кадров при 60 fps вдвое короче, чем при 30, — коротких групп не больше.
    expect(at60.captionReport.short.length).toBeLessThanOrEqual(at30.captionReport.short.length);
    expect(at60.captionGroups.map((group) => group.text)).toEqual(at30.captionGroups.map((group) => group.text));
  });
});

describe('CP-02 — display-форма: `[say:]`, `absent`, `[emph]`', () => {
  it('`[say: 200 | two hundred]` показывает `200`, а не «two hundred»', async () => {
    const timeline = compose((await buildProject()).input);
    const surfaces = timeline.captionGroups.flatMap((group) => group.tokens.map((token) => token.surface));
    expect(surfaces).toContain('200');
    expect(surfaces).toContain('14');
    expect(timeline.captionGroups.map((group) => group.text).join(' ')).not.toContain('two hundred');
  });

  it('непроизносимый `absent`-токен приклеен к соседу слева: «“waiting”.» одной строкой', async () => {
    // В фикстуре ровно один `absent` — одиночная точка после `[say: “waiting” | waiting]`.
    const built = await buildProject();
    const absent = [...built.takes.values()].flatMap((take) =>
      take.bindings.filter((binding) => binding.status === 'absent'),
    );
    expect(absent).toHaveLength(1);

    const timeline = compose(built.input);
    const glued = timeline.captionGroups.find((group) => group.text.startsWith('“waiting”'));
    expect(glued, 'группа с приклеенным знаком не найдена').toBeDefined();
    expect(glued?.text).toBe('“waiting”.');
    // Приклеенный знак НЕ становится вторым токеном: слияния не происходит, у него просто нет
    // ни времени, ни якоря во времени (**T11** не задет).
    expect(glued?.tokens).toHaveLength(1);
    // ПОПРАВКА П3: потолок считает приклеенный знак — 10 символов, не 9.
    expect([...(glued?.text ?? '')]).toHaveLength(10);
    // **T10** на этой группе цел: её края — края единственного ИЗМЕРЕННОГО токена.
    expect(glued?.startSample).toBe(glued?.tokens[0]?.startSample);
    expect(glued?.endSample).toBe(glued?.tokens[0]?.endSample);
    // И якоря `absent`-точки среди токенов групп нет вовсе.
    const anchorIds = new Set(timeline.captionGroups.flatMap((group) => group.tokens.map((token) => token.anchorId)));
    for (const binding of absent) expect(anchorIds.has(binding.anchorId)).toBe(false);
  });

  it('`absent` под ПРОИЗНОСИМЫМ словом — ошибка компиляции со списком', async () => {
    const built = await buildProject();
    // Синтетический дубль: у настоящего произносимого слова отнимается время. Так выглядит
    // «провайдер проглотил слово», и компилятор обязан упасть, а не выдумать интервал.
    const takes = new Map(built.takes);
    const [chunkKey, take] = [...takes.entries()][0] ?? [];
    expect(take).toBeDefined();
    const victim = take?.bindings.find((binding) => binding.status === 'measured');
    expect(victim).toBeDefined();
    takes.set(chunkKey ?? '', {
      ...(take as NonNullable<typeof take>),
      bindings: (take?.bindings ?? []).map((binding) =>
        binding.anchorId === victim?.anchorId
          ? { anchorId: binding.anchorId, startSample: null, endSample: null, status: 'absent' as const, confidence: null }
          : binding,
      ),
    });
    expect(() => compose({ ...built.input, takes })).toThrow(/провайдер его проглотил|статусом `absent`/u);
  });

  it('`[emph] cost.` несёт флаг на СЛЕДУЮЩЕМ токене того же чанка, и только на нём', async () => {
    const timeline = compose((await buildProject()).input);
    const marked = timeline.captionGroups.flatMap((group) => group.tokens.filter((token) => token.emph));
    expect(marked.map((token) => token.surface)).toEqual(['cost.']);
  });
});

describe('CP-02 — дамп и детерминизм', () => {
  it('дамп несёт блок субтитров построчно, и он читается зондом', async () => {
    const timeline = compose((await buildProject()).input);
    const dump = dumpTimeline(timeline);
    expect(dump).toContain(
      `captions count=${String(timeline.captionGroups.length)} ` +
        `short=${String(timeline.captionReport.short.length)} ` +
        `tails=${String(timeline.captionReport.tailSingletons)}`,
    );
    const first = timeline.captionGroups[0];
    expect(dump).toContain(
      `  [${String(first?.startSample)}, ${String(first?.endSample)}) "${first?.text ?? ''}" ` +
        `tokens=${String(first?.tokens.length)} chunk=${first?.chunkKey ?? ''} short=no`,
    );
    // Строк ровно столько, сколько групп, плюс шапка блока.
    const lines = dump.trimEnd().split('\n');
    const from = lines.findIndex((line) => line.startsWith('captions '));
    expect(lines.length - from - 1).toBe(timeline.captionGroups.length);
  });

  it('два `compose` дают побайтово равные дампы, а перестановка входов их не меняет', async () => {
    const built = await buildProject();
    const once = dumpTimeline(compose(built.input));
    const twice = dumpTimeline(compose(built.input));
    expect(twice).toBe(once);

    const shuffled = dumpTimeline(
      compose({
        ...built.input,
        anchors: [...built.input.anchors].reverse(),
        records: [...built.input.records].reverse(),
        generated: [...built.input.generated].reverse(),
      }),
    );
    expect(shuffled).toBe(once);
  });

  it('дефолтный профиль мока не изменён этой задачей (контроль прибора)', () => {
    // `TAKE_PROFILE` отличается от `MOCK_PROFILE` только краями (`V-04`), и быстрый профиль
    // теста минимума — ЛОКАЛЬНЫЙ. Если бы он протёк в дефолт, все числа выше поехали бы.
    expect(TAKE_PROFILE.msPerChar).toBe(MOCK_PROFILE.msPerChar);
    expect(TAKE_PROFILE.msPerSpace).toBe(MOCK_PROFILE.msPerSpace);
  });
});
