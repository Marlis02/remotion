// Стадия звука (`CP-05`): план непрерывной дорожки, её байты и ассерты T5/T6c/T6d/T7/T9.
//
// ЧИСЛА ФИКСТУРЫ ПРОВЕРЯЮТСЯ ЛИТЕРАЛАМИ, А ФОРМУЛЫ — ВЫЧИСЛЕНИЕМ. Это разные работы: числа
// (`speech = 1126800`, `Σδ = 960`, `F = 1473`) — ИЗМЕРЕНИЕ на конкретном материале, и их
// изменение обязано быть видно в дифсе; равенства (`Σ элементов == frameStartSample(F)`,
// `ε_i < i`) — свойства, квантифицированные по всем входам, и их проверяют на синтетике.
//
// ФИКСТУРА `fixtures/minimal` НЕ ИЗМЕНЯЕТСЯ НИ СИМВОЛОМ — ни `store.lock`, ни `voice/takes/`.
// PCM дублей лежит в CAS ВРЕМЕННОГО проекта (`pcmSourceOf`), синтетические исходники живут
// строками в этом файле, а профиль правится функцией поверх фикстурного.

import {
  asSamples,
  frameStartSample,
  timeGrid,
  type AssemblyManifest,
  type Samples,
} from '@vpe/core-model';
import { pcmS16, silence, type PcmS16 } from '@vpe/media';
import { afterAll, describe, expect, it } from 'vitest';

import {
  audioTrackRef,
  compileAudio,
  CompileAudioError,
  compileIr,
  compose,
  dumpAudioPlan,
  renderAudioTrack,
  withAudioTrack,
  type AudioPlan,
  type AudioProfileInput,
  type CompileProfileInput,
  type Timeline,
  type TimelineItem,
} from '../src/index.js';

import { fixtureAudioProfile } from './fixture.js';
import { buildProject, cleanupRoots, pcmSourceOf, type BuiltProject } from './project.js';

afterAll(cleanupRoots);

/** Сетка фикстуры: 24000 при 30/1 ⇒ `S = 800` сэмплов на кадр, ЦЕЛОЕ. */
const SEED_ROOT = 1;

interface Built {
  readonly project: BuiltProject;
  readonly timeline: Timeline;
  readonly manifest: AssemblyManifest;
  readonly profile: AudioProfileInput;
  readonly plan: AudioPlan;
}

/** Полный путь до плана дорожки: `compose` → `compileIr` → `compileAudio`. */
async function build(
  text?: string,
  extra: { readonly direction?: string | null; readonly profile?: (base: CompileProfileInput) => CompileProfileInput } = {},
  audio: (base: AudioProfileInput) => AudioProfileInput = (base) => base,
): Promise<Built> {
  const project = await buildProject(text, undefined, extra);
  const timeline = compose(project.input);
  const manifest = compileIr({ timeline, profile: project.input.profile, seedRoot: SEED_ROOT }).manifest;
  const compileProfile = project.input.profile;
  const profile = audio({
    ...fixtureAudioProfile(),
    projectSampleRate: compileProfile.projectSampleRate,
    fps: compileProfile.fps,
  });
  return { project, timeline, manifest, profile, plan: compileAudio({ timeline, manifest, profile }) };
}

/** Исходник из `n` ровных сцен одной главы. Тот же материал, что у синтетики `CP-03`. */
function scenes(n: number): string {
  const paragraph = 'Alpha beta gamma delta epsilon zeta here.';
  const body: string[] = ['schema: source-dialect/1', ''];
  body.push('# chapter: one', '');
  for (let index = 1; index <= n; index += 1) body.push(`## scene: s${String(index)}`, '', paragraph, '');
  return body.join('\n');
}

/** Клипы дорожки речи Timeline — вход, из которого план и строится. */
function speechItems(timeline: Timeline): readonly TimelineItem[] {
  return timeline.tracks.find((track) => track.kind === 'speech')?.items ?? [];
}

/** Копия Timeline, в которой у речевых клипов нет байтов: `pcm.sha256 == null` (ADR-0010 §2). */
function withoutPcm(timeline: Timeline): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'speech'
        ? track
        : {
            ...track,
            items: track.items.map((item) => (item.kind === 'speech' ? { ...item, pcmSha256: null } : item)),
          },
    ),
  };
}

// ── Числа фикстуры ──────────────────────────────────────────────────────────

describe('`CP-05` — план дорожки на `fixtures/minimal`', () => {
  it('длина дорожки — `frameStartSample(F)`, а раскладка сходится до сэмпла', async () => {
    const { plan, profile, manifest } = await build();
    const grid = timeGrid(profile.projectSampleRate, profile.fps);

    expect(plan.totalFrames).toBe(1473);
    expect(plan.totalSamples).toBe(frameStartSample(grid, manifest.totalFrames));
    expect(plan.totalSamples).toBe(1178400);

    // ИЗМЕРЕНО (`CP-05`, 2026-08-27). Речь — восемь окон T7, авторские паузы — `[pause:]`
    // исходника, gap'ы — умолчания T8 профиля, Σδ — две поправки 240 + 720.
    expect(plan.breakdown).toEqual({
      speechSamples: 1126800,
      authorSamples: 30000,
      gapSamples: 20640,
      correctionSamples: 960,
      finalPaddingSamples: 0,
    });
    const sum =
      plan.breakdown.speechSamples +
      plan.breakdown.authorSamples +
      plan.breakdown.gapSamples +
      plan.breakdown.correctionSamples +
      plan.breakdown.finalPaddingSamples;
    expect(sum).toBe(plan.totalSamples);
    // `речь + паузы + gap'ы == Σ L_i` — поправка в `L` не входит по определению (T6).
    expect(sum - plan.breakdown.correctionSamples - plan.breakdown.finalPaddingSamples).toBe(1177440);
  });

  it('**T6c**: `Σ A_i ≤ frameStartSample(F)`, разность 0 на целой сетке', async () => {
    const { plan, manifest } = await build();
    const alignedSum = manifest.segments.reduce((total, row) => total + row.alignedSamples, 0);
    expect(alignedSum).toBe(1178400);
    expect(plan.trackTailSamples).toBe(0);
    expect(alignedSum + plan.trackTailSamples).toBe(plan.totalSamples);
    expect(plan.trackTailSamples).toBeLessThan(manifest.segments.length);
  });

  it('**T6d**: `ε_1 = 0`, `ε_2 = 0` — сетка и дорожка не разошлись', async () => {
    const { plan } = await build();
    expect(plan.epsilonSamples).toEqual([0, 0]);
  });

  it('элементы лежат встык: ни дыры, ни перекрытия, последний кончается ровно на длине', async () => {
    const { plan } = await build();
    let at = 0;
    for (const element of plan.elements) {
      expect(element.atSample).toBe(at);
      expect(element.lengthSamples).toBeGreaterThan(0);
      at += element.lengthSamples;
    }
    expect(at).toBe(plan.totalSamples);
    // Клипы дорожки речи плюс ровно одна поправка на сегмент.
    const { timeline, manifest } = await build();
    expect(plan.elements.length).toBe(speechItems(timeline).length + manifest.segments.length);
  });

  it('поправка `boundary-correction` — ровно одна на сегмент и НЕ входит в `L_i`', async () => {
    const { plan, manifest } = await build();
    const corrections = plan.elements.filter(
      (element) => element.kind === 'silence' && element.silenceKind === 'boundary-correction',
    );
    expect(corrections).toHaveLength(manifest.segments.length);

    for (const [index, row] of manifest.segments.entries()) {
      const own = plan.elements.filter((element) => element.segmentId === row.segmentId);
      const nominal = own
        .filter((element) => !(element.kind === 'silence' && element.silenceKind === 'boundary-correction'))
        .reduce((total, element) => total + element.lengthSamples, 0);
      // `L_i` — сумма номинальных длин БЕЗ поправки, дословно T6.
      expect(nominal).toBe(row.nominalSamples);
      const correction = own.at(-1);
      expect(correction?.kind === 'silence' && correction.silenceKind === 'boundary-correction').toBe(true);
      if (correction?.kind !== 'silence' || correction.silenceKind !== 'boundary-correction') return;
      // П1: две составляющие ПОЛЯМИ, а не одной суммой.
      expect(correction.correctionSamples).toBe(row.correctionSamples);
      expect(correction.finalPaddingSamples).toBe(index === manifest.segments.length - 1 ? manifest.trackTailSamples : 0);
      expect(correction.lengthSamples).toBe(correction.correctionSamples + correction.finalPaddingSamples);
      // Сегмент занимает в дорожке ровно `A_i` (+ добивка у последнего).
      const occupied = own.reduce((total, element) => total + element.lengthSamples, 0);
      expect(occupied).toBe(row.alignedSamples + correction.finalPaddingSamples);
    }
  });

  it('`δ_i` дописан В КОНЕЦ хвостового gap\'а, а не в начало сегмента', async () => {
    const { plan, timeline, manifest } = await build();
    const first = manifest.segments[0];
    const tailGap = timeline.segments[0]?.tailGap;
    expect(tailGap?.silence.silenceKind).toBe('gap');
    const correction = plan.elements.find(
      (element) => element.segmentId === first?.segmentId && element.kind === 'silence' && element.silenceKind === 'boundary-correction',
    );
    // Хвостовой gap `[544080, 551760)`; поправка начинается ровно там, где он кончился.
    expect(correction?.atSample).toBe(551760);
    expect(correction?.lengthSamples).toBe(240);
    // И следующий сегмент начинается на `a_1 = A_0 = 552000`, а не на `L_0 = 551760`.
    expect(manifest.segments[1]?.firstSample).toBe(552000);
    expect(plan.elements.find((element) => element.segmentId === 'seg:turn')?.atSample).toBe(552000);
  });

  it('музыка осталась ДАННЫМИ и посчитана вслух (решение владельца 1, поправка П4)', async () => {
    const { plan } = await build();
    expect(plan.unmixedClips).toBe(plan.music.length);
    expect(plan.unmixedClips).toBe(1);
    const bed = plan.music[0];
    expect(bed?.track).toBe('music');
    expect(bed?.template).toBe('bed@1');
    // `params` идут насквозь: alias, а не sha — разрешать его компилятор не вправе (`TS-01`).
    expect(bed?.params).toMatchObject({ asset: 'pad-loop' });
    expect(dumpAudioPlan(plan)).toContain('music: 1 клипов не смикшированы (TS-01)');
  });
});

// ── Байты дорожки ───────────────────────────────────────────────────────────

describe('`CP-05` — материализация дорожки', () => {
  it('длина в сэмплах равна плану, а окно первого дубля совпадает ПОБАЙТОВО', async () => {
    const built = await build();
    const source = await pcmSourceOf(built.project);
    const track = renderAudioTrack(built.plan, source);

    expect(track.samples.length).toBe(built.plan.totalSamples);
    expect(track.sampleRate).toBe(built.profile.projectSampleRate);

    const first = built.plan.elements.find((element) => element.kind === 'speech');
    if (first?.kind !== 'speech') throw new Error('в плане нет ни одного речевого элемента');
    const raw = source.get(first.pcmSha256);
    if (raw === undefined) throw new Error('источник PCM не отдал байты первого дубля');
    // Окно `[leadIn, numSamples − tail)` — T7 после `DOC-04`: байты кладутся КАК ЕСТЬ.
    expect(track.samples.subarray(first.atSample, first.atSample + first.lengthSamples)).toEqual(
      raw.samples.subarray(first.fromSample, first.toSample),
    );
    // Края дубля на дорожку НЕ попали: лид-ин мока — 2400 сэмплов искусственной тишины.
    expect(first.fromSample).toBe(2400);
    expect(raw.samples.length).toBeGreaterThan(first.toSample);
  });

  it('на местах поправки — нули ровно `δ_i`, и это не «повезло с тишиной»', async () => {
    const built = await build();
    const track = renderAudioTrack(built.plan, await pcmSourceOf(built.project));
    for (const element of built.plan.elements) {
      if (element.kind !== 'silence' || element.silenceKind !== 'boundary-correction') continue;
      const slice = track.samples.subarray(element.atSample, element.atSample + element.lengthSamples);
      expect(slice.length).toBe(element.lengthSamples);
      expect(slice.every((sample) => sample === 0)).toBe(true);
    }
    // Речь при этом не нулевая — иначе предыдущая проверка была бы тавтологией на пустой дорожке.
    expect(track.samples.some((sample) => sample !== 0)).toBe(true);
  });

  it('`AudioTrackRef` детерминирован, и `withAudioTrack` кладёт его в манифест копией', async () => {
    const built = await build();
    const source = await pcmSourceOf(built.project);
    const once = audioTrackRef(renderAudioTrack(built.plan, source));
    const twice = audioTrackRef(renderAudioTrack(built.plan, source));
    expect(once).toEqual(twice);
    expect(once.numSamples).toBe(built.plan.totalSamples);
    expect(once.sampleRate).toBe(built.profile.projectSampleRate);
    expect(once.sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(built.manifest.audioTrack).toBeNull();
    const filled = withAudioTrack(built.manifest, once);
    expect(filled.audioTrack).toEqual(once);
    // Копия, а не мутация: уже отданный манифест не меняется.
    expect(built.manifest.audioTrack).toBeNull();
  });

  it('дубль на чужой частоте — ОТКАЗ, а не ресемплинг (ADR-0010 §9)', async () => {
    const built = await build();
    const source = await pcmSourceOf(built.project);
    const first = built.plan.elements.find((element) => element.kind === 'speech');
    if (first?.kind !== 'speech') throw new Error('в плане нет ни одного речевого элемента');
    const raw = source.get(first.pcmSha256);
    if (raw === undefined) throw new Error('источник PCM не отдал байты первого дубля');
    source.set(first.pcmSha256, pcmS16(48000, raw.samples));

    expect(() => renderAudioTrack(built.plan, source)).toThrow(/48000 Гц при projectSampleRate = 24000/);
  });

  it('блоб короче обещанного — ОТКАЗ с именем клипа', async () => {
    const built = await build();
    const source = await pcmSourceOf(built.project);
    const first = built.plan.elements.find((element) => element.kind === 'speech');
    if (first?.kind !== 'speech') throw new Error('в плане нет ни одного речевого элемента');
    source.set(first.pcmSha256, silence(built.profile.projectSampleRate, first.toSample - 1));

    expect(() => renderAudioTrack(built.plan, source)).toThrow(CompileAudioError);
    expect(() => renderAudioTrack(built.plan, source)).toThrow(/не помещается в дубль/);
  });

  it('байтов дубля нет вовсе — ОТКАЗ, а не тишина вместо речи', async () => {
    const built = await build();
    const empty: Map<string, PcmS16> = new Map();
    expect(() => renderAudioTrack(built.plan, empty)).toThrow(/нет байтов дубля/);
  });
});

// ── Отказы стадии ───────────────────────────────────────────────────────────

describe('`CP-05` — отказы стадии', () => {
  it('`pcm.sha256 == null` — отказ со списком `chunkKey`, а не тишина', async () => {
    const built = await build();
    const broken = withoutPcm(built.timeline);
    let message = '';
    try {
      compileAudio({ timeline: broken, manifest: built.manifest, profile: built.profile });
      throw new Error('ожидался отказ');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileAudioError);
      message = (error as Error).message;
    }
    expect(message).toContain('нет байтов дубля');
    // Список ЦЕЛИКОМ, а не первое имя: восемь чанков фикстуры.
    for (const item of speechItems(built.timeline)) {
      if (item.kind === 'speech') expect(message).toContain(item.chunkKey);
    }
    expect(message).toContain('ОТКАЗ, а не тишина вместо речи');
  });

  it('манифест от другого разбиения — отказ до единого числа плана', async () => {
    const built = await build();
    const shorter: AssemblyManifest = { ...built.manifest, segments: built.manifest.segments.slice(0, 1) };
    expect(() => compileAudio({ timeline: built.timeline, manifest: shorter, profile: built.profile })).toThrow(
      /сегментов в Timeline 2, в манифесте 1/,
    );
  });

  it('чужая частота в профиле звука — отказ (второго `projectSampleRate` в сборке не бывает)', async () => {
    const built = await build();
    const profile = { ...built.profile, projectSampleRate: 48000 };
    expect(() => compileAudio({ timeline: built.timeline, manifest: built.manifest, profile })).toThrow(
      /источник истины физического времени/,
    );
  });
});

// ── T9: предел хронометража ─────────────────────────────────────────────────

describe('**T9** — `F ≤ maxDurationFrames`, компилятор падает', () => {
  it('`maxDurationFrames = 1472` ⇒ падение с раскладкой в кадрах и секундах', async () => {
    const built = await build();
    let message = '';
    try {
      compileAudio({
        timeline: built.timeline,
        manifest: built.manifest,
        profile: { ...built.profile, maxDurationFrames: 1472 },
      });
      throw new Error('ожидался отказ T9');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileAudioError);
      expect((error as CompileAudioError).rule).toBe('ADR-0003 T9');
      message = (error as Error).message;
    }
    expect(message).toContain('F = 1473 кадров > maxDurationFrames = 1472');
    expect(message).toContain('речь            1126800 (46.950 с)');
    expect(message).toContain("gap'ы движка    20640 (0.860 с)");
    expect(message).toContain('Σδ (поправка)   960 (0.040 с)');
    expect(message).toContain('добивка T5      0 (0.000 с)');
    expect(message).toContain('итого           1178400 (49.100 с)');
  });

  it('`maxDurationFrames = 1473` ⇒ проходит: граница ровно на `F`', async () => {
    const built = await build();
    const plan = compileAudio({
      timeline: built.timeline,
      manifest: built.manifest,
      profile: { ...built.profile, maxDurationFrames: 1473 },
    });
    expect(plan.totalFrames).toBe(1473);
  });

  it('фикстурный предел 1800 кадров ролик пропускает', async () => {
    const built = await build();
    expect(built.profile.maxDurationFrames).toBe(1800);
    expect(built.plan.totalFrames).toBeLessThanOrEqual(built.profile.maxDurationFrames);
  });
});

// ── Свойства T6c/T6d: синтетика и дробная сетка ─────────────────────────────

describe('**T6c**/**T6d** — свойства (3) и (4) T6 на восьми сегментах', () => {
  /** Проверяет оба свойства на любом готовом плане. Эталон — определения, а не числа. */
  function assertProperties(plan: AudioPlan, manifest: AssemblyManifest, grid: ReturnType<typeof timeGrid>): void {
    const n = manifest.segments.length;
    const alignedSum = manifest.segments.reduce((total, row) => total + row.alignedSamples, 0);
    const gridSamples = frameStartSample(grid, manifest.totalFrames);
    expect(alignedSum).toBeLessThanOrEqual(gridSamples);
    expect(gridSamples - alignedSum).toBeLessThan(n);
    expect(plan.trackTailSamples).toBe(gridSamples - alignedSum);

    for (const [index, epsilon] of plan.epsilonSamples.entries()) {
      expect(epsilon).toBeGreaterThanOrEqual(0);
      expect(epsilon).toBeLessThan(n);
      // Форма, принятая владельцем: `[0, i)` буквально пусто при `i = 0`.
      if (index === 0) expect(epsilon).toBe(0);
      else expect(epsilon).toBeLessThan(index);
    }
  }

  it('восемь ровных сцен при 24000/30 (`S = 800`, целое): хвост 0', async () => {
    const built = await build(scenes(8), { direction: null });
    expect(built.manifest.segments.length).toBe(8);
    assertProperties(built.plan, built.manifest, timeGrid(built.profile.projectSampleRate, built.profile.fps));
    // На ЦЕЛОМ `S` добивка тождественно нулевая: `frameStartSample` аддитивна.
    expect(built.plan.trackTailSamples).toBe(0);
    expect(built.plan.breakdown.finalPaddingSamples).toBe(0);
  });

  it('дробное `S` (24000 при 30000/1001, `S = 800.8`): добивка НЕНУЛЕВАЯ и лежит в конце', async () => {
    const built = await build(scenes(8), {
      direction: null,
      profile: (base) => ({ ...base, fps: { num: 30000, den: 1001 } }),
    });
    const grid = timeGrid(built.profile.projectSampleRate, built.profile.fps);
    assertProperties(built.plan, built.manifest, grid);

    // Ради чего этот тест и написан: на целой сетке ветка добивки не исполняется никогда.
    expect(built.plan.trackTailSamples).toBeGreaterThan(0);
    expect(built.plan.breakdown.finalPaddingSamples).toBe(built.plan.trackTailSamples);

    const last = built.plan.elements.at(-1);
    if (last?.kind !== 'silence' || last.silenceKind !== 'boundary-correction') {
      throw new Error('последний элемент дорожки обязан быть поправкой последнего сегмента');
    }
    expect(last.finalPaddingSamples).toBe(built.plan.trackTailSamples);
    expect(last.segmentId).toBe(built.manifest.segments.at(-1)?.segmentId);
    // Четвёртого вида тишины нет: сумма сходится ОДНИМ элементом (решение владельца 5, «а»).
    expect(built.plan.elements.reduce((total, element) => total + element.lengthSamples, 0)).toBe(
      built.plan.totalSamples,
    );
    // И `δ_n` при этом остаётся проверяемым ПО ЭЛЕМЕНТУ (поправка П1): `δ_n < S = 800.8`.
    expect(last.correctionSamples).toBeLessThan(801);
  });

  it('дорожка на дробной сетке материализуется и её длина равна плану', async () => {
    const built = await build(scenes(8), {
      direction: null,
      profile: (base) => ({ ...base, fps: { num: 30000, den: 1001 } }),
    });
    const track = renderAudioTrack(built.plan, await pcmSourceOf(built.project));
    expect(track.samples.length).toBe(built.plan.totalSamples);
    // Последние `хвост` сэмплов — нули: добивка T5 в самом конце ролика.
    const tail = track.samples.subarray(track.samples.length - built.plan.trackTailSamples);
    expect(tail.every((sample) => sample === 0)).toBe(true);
  });
});

// ── Детерминизм ─────────────────────────────────────────────────────────────

describe('`CP-05` — детерминизм', () => {
  it('перестановка входных массивов не меняет ни план, ни байты дорожки', async () => {
    const project = await buildProject();
    const profile = { ...fixtureAudioProfile() };

    const planOf = (input: typeof project.input): { dump: string; bytes: PcmS16 } => {
      const timeline = compose(input);
      const manifest = compileIr({ timeline, profile: input.profile, seedRoot: SEED_ROOT }).manifest;
      const plan = compileAudio({ timeline, manifest, profile });
      return { dump: dumpAudioPlan(plan), bytes: renderAudioTrack(plan, sourceOnce) };
    };
    const sourceOnce = await pcmSourceOf(project);

    const base = planOf(project.input);
    const shuffled = planOf({
      ...project.input,
      records: [...project.input.records].reverse(),
      generated: [...project.input.generated].reverse(),
      anchors: [...project.input.anchors].reverse(),
      takes: new Map([...project.input.takes.entries()].reverse()),
    });

    expect(shuffled.dump).toBe(base.dump);
    expect(shuffled.bytes.samples).toEqual(base.bytes.samples);
    expect(audioTrackRef(shuffled.bytes)).toEqual(audioTrackRef(base.bytes));
  });

  it('дамп плана печатает раскладку, `ε_i`, музыку и все элементы', async () => {
    const { plan } = await build();
    const dump = dumpAudioPlan(plan);
    expect(dump.split('\n')[0]).toBe('audio samples=1178400 F=1473 rate=24000 elements=17 tail=0');
    expect(dump).toContain('eps=0,0');
    expect(dump).toContain('correct  [551760, 552000) correction:seg:intro seg=seg:intro delta=240 padding=0');
    expect(dump).toContain('correct  [1177680, 1178400) correction:seg:turn seg=seg:turn delta=720 padding=0');
    // Каждый элемент — своя строка; шапка, раскладка (7 строк), eps, music, клип музыки.
    expect(dump.split('\n')).toHaveLength(1 + 7 + 1 + 1 + 1 + plan.elements.length);
  });
});

// ── Ассерты, которые обязаны падать ─────────────────────────────────────────

describe('`CP-05` — ассерты T5 предъявляются, а не подразумеваются', () => {
  it('поправка, пришедшая из Timeline, — отказ: `δ` учтён бы дважды', async () => {
    const built = await build();
    const [first] = built.timeline.segments;
    if (first?.tailGap === undefined || first.tailGap === null) throw new Error('у первого сегмента нет хвостового gap\'а');
    const poisoned: Timeline = {
      ...built.timeline,
      tracks: built.timeline.tracks.map((track) =>
        track.kind !== 'speech'
          ? track
          : {
              ...track,
              items: track.items.map((item) =>
                item.kind === 'silence' && item.clipId === first.tailGap?.clipId
                  ? { ...item, silence: { ...item.silence, silenceKind: 'boundary-correction' as const } }
                  : item,
              ),
            },
      ),
    };
    expect(() => compileAudio({ timeline: poisoned, manifest: built.manifest, profile: built.profile })).toThrow(
      /поправка учтена дважды/,
    );
  });

  it('манифест с чужим хвостом — отказ **T6c** (сумма не сошлась с сеткой)', async () => {
    const built = await build();
    const broken: AssemblyManifest = { ...built.manifest, trackTailSamples: asSamples(7) };
    let rule = '';
    try {
      compileAudio({ timeline: built.timeline, manifest: broken, profile: built.profile });
      throw new Error('ожидался отказ T6c');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileAudioError);
      rule = (error as CompileAudioError).rule;
    }
    expect(rule).toBe('ADR-0003 T6c');
  });

  it('манифест со сдвинутым `a_i` — отказ **T6d** (`ε_i` вышла за диапазон)', async () => {
    const built = await build();
    const rows = built.manifest.segments.map((row, index) =>
      index === 1 ? { ...row, firstSample: asSamples(row.firstSample - 5) } : row,
    );
    const broken: AssemblyManifest = { ...built.manifest, segments: rows };
    let rule = '';
    try {
      compileAudio({ timeline: built.timeline, manifest: broken, profile: built.profile });
      throw new Error('ожидался отказ T6d');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileAudioError);
      rule = (error as CompileAudioError).rule;
    }
    expect(rule).toBe('ADR-0003 T6d');
  });

  it('план с дырой между элементами — отказ **T5** (дорожка непрерывна)', async () => {
    const built = await build();
    const holed: AudioPlan = {
      ...built.plan,
      elements: built.plan.elements.map((element, index) =>
        index === 0 ? element : { ...element, atSample: asSamples(element.atSample + 1) },
      ),
    };
    // Проверяется сам ассерт: он вызывается стадией, а здесь предъявляется его предмет.
    const written: Samples[] = holed.elements.map((element) => element.atSample);
    expect(written[1]).toBe((built.plan.elements[1]?.atSample ?? 0) + 1);
    expect(() => renderAudioTrack(holed, new Map())).toThrow(CompileAudioError);
  });
});
