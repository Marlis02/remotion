// `X-02` — МИКС ДОРОЖКИ: голос + подложка `bed@1`, duck по окнам речи, насыщение.
//
// МАТЕРИАЛ — НАСТОЯЩАЯ ФИКСТУРА, а не синтетический план: `fixtures/minimal` вызывает `bed@1`
// записью `c81a05f7` (`asset: pad-loop`, `inPoint: 96000`, `gainDb: -18`,
// `duckUnderSpeechDb: -6`), и все ожидания ниже считаются ИЗ ЭТИХ чисел, прочитанных планом,
// а не из литералов.
//
// БАЙТОВ ПОДЛОЖКИ В РЕПОЗИТОРИИ НЕТ И НЕ БУДЕТ (правило `M-03`: ни одного бинарника). Ассет
// `0000…0004` — запись без блоба, поэтому сигнал синтезируется здесь же и кладётся в источник
// PCM под тем же sha. Это ровно та подмена, которую делает сборка, читая CAS: источник —
// карта `sha → PcmS16`, и откуда в ней байты, стадия не знает.
//
// ПОЧЕМУ ПОСТОЯННЫЙ УРОВЕНЬ, А НЕ «МУЗЫКА». Постоянный сигнал делает КАЖДОЕ утверждение
// проверяемым арифметикой: вклад подложки в дорожку равен `round(уровень · дробь)` и ничему
// больше. На синусоиде то же утверждение пришлось бы писать через допуск, то есть перестать
// отличать правильный duck от почти правильного.

import { afterAll, describe, expect, it } from 'vitest';

import type { AssemblyManifest } from '@vpe/core-model';
import { pcmS16, sha256Of, bytesFromPcm, type PcmS16 } from '@vpe/media';

import {
  compileAudio,
  compileIr,
  compose,
  mixAudioTrack,
  renderAudioTrack,
  type AudioPlan,
  type AudioProfileInput,
  type Timeline,
} from '../src/index.js';

import { fixtureAudioProfile } from './fixture.js';
import { buildProject, cleanupRoots, pcmSourceOf, type BuiltProject } from './project.js';

afterAll(cleanupRoots);

const SEED_ROOT = 1;

/** Sha ассета `pad-loop` в `fixtures/minimal/assets/aliases.yaml`. */
const PAD_LOOP = '0000000000000000000000000000000000000000000000000000000000000004';

/** Уровень синтетической подложки. Далёк от края шкалы: насыщение проверяется отдельно. */
const BED_LEVEL = 20000;

interface Mixable {
  readonly project: BuiltProject;
  readonly timeline: Timeline;
  readonly manifest: AssemblyManifest;
  readonly profile: AudioProfileInput;
  readonly plan: AudioPlan;
  readonly source: Map<string, PcmS16>;
}

/** Дорожка фикстуры до плана плюс источник PCM, в котором лежат и дубли, и подложка. */
async function mixable(
  bedLevel = BED_LEVEL,
  tune: (base: AudioProfileInput) => AudioProfileInput = (base) => base,
): Promise<Mixable> {
  const project = await buildProject();
  const timeline = compose(project.input);
  const manifest = compileIr({ timeline, profile: project.input.profile, seedRoot: SEED_ROOT }).manifest;
  const profile = tune({
    ...fixtureAudioProfile(),
    projectSampleRate: project.input.profile.projectSampleRate,
    fps: project.input.profile.fps,
  });
  const plan = compileAudio({ timeline, manifest, profile });
  const source = await pcmSourceOf(project);
  // Подложка длиной 2 880 000 сэмплов (120 с) — как в записи ассета фикстуры. Окно клипа
  // короче, поэтому петля в этом тесте не возникает: её проверяет `media/audio-gain`.
  const bed = new Int16Array(2_880_000);
  bed.fill(bedLevel);
  source.set(PAD_LOOP, pcmS16(profile.projectSampleRate, bed));
  return { project, timeline, manifest, profile, plan, source };
}

/** Вклад подложки в сэмпл дорожки: «дорожка с миксом» минус «дорожка только с голосом». */
function bedContribution(mixed: PcmS16, voice: PcmS16, at: number): number {
  return (mixed.samples[at] ?? 0) - (voice.samples[at] ?? 0);
}

describe('`X-02` — подложка звучит, и её уровень проверяется арифметикой', () => {
  it('дорожка = голос + подложка; вне речи вклад равен `уровень · gain`', async () => {
    const { plan, source } = await mixable();
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const bed = plan.music[0]?.audio;
    if (bed === undefined || bed === null) throw new Error('фикстура потеряла `bed@1`');

    expect(mixed.beds).toHaveLength(1);
    expect(mixed.track.samples.length).toBe(plan.totalSamples);

    // Точка ВНУТРИ окна подложки, но вне речи и вне рампы: середина авторской паузы либо
    // хвостового gap'а. Ищется по плану, а не назначается числом.
    const quiet = quietSampleIn(plan);
    expect(bedContribution(mixed.track, voice, quiet)).toBe(
      Math.round((BED_LEVEL * bed.gain.numerator) / bed.gain.denominator),
    );
  });

  it('ПОД РЕЧЬЮ подложка опущена ровно на `duckUnderSpeechDb`', async () => {
    const { plan, source } = await mixable();
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const bed = plan.music[0]?.audio;
    if (bed === undefined || bed === null) throw new Error('фикстура потеряла `bed@1`');

    const inside = speechSampleIn(plan);
    expect(bedContribution(mixed.track, voice, inside)).toBe(
      Math.round((BED_LEVEL * bed.duckedGain.numerator) / bed.duckedGain.denominator),
    );
    // И это ДРУГОЕ число, чем вне речи, — иначе тест был бы зелёным при выключенном duck'е.
    expect(bed.duckedGain.numerator).toBeLessThan(bed.gain.numerator);
    expect(mixed.beds[0]?.duckedWindows ?? 0).toBeGreaterThan(0);
  });

  it('ДЕТЕРМИНИЗМ: четыре сборки одного плана дают один sha дорожки (AC4 на миксе)', async () => {
    const { plan, source } = await mixable();
    const digests = new Set<string>();
    for (let run = 0; run < 4; run += 1) {
      digests.add(sha256Of(bytesFromPcm(mixAudioTrack(plan, source).track)));
    }
    expect([...digests]).toHaveLength(1);
  });

  it('НАСЫЩЕНИЕ СЧИТАЕТСЯ ЧИСЛОМ И НЕ РОНЯЕТ СБОРКУ (пересмотр долга №63)', async () => {
    // ПЕРЕГРУЗ СТРОИТСЯ ПРАВКОЙ ПЛАНА, А НЕ ФИКСТУРЫ, и это законно ровно потому, что план —
    // ДАННЫЕ: подложка фикстуры звучит на −18 дБ и в край шкалы не упирается никогда.
    // Подменяется одно поле — усиление, — и подложка на полной шкале складывается с голосом.
    const loud = await mixable(32767);
    const clip = loud.plan.music[0];
    const sound = clip?.audio;
    if (clip === undefined || sound === undefined || sound === null) throw new Error('фикстура потеряла `bed@1`');
    const unity = { numerator: 32768, denominator: 32768 };
    const overloaded: AudioPlan = {
      ...loud.plan,
      music: [{ ...clip, audio: { ...sound, gain: unity, duckedGain: unity, duckUnderSpeechDb: 0 } }],
    };

    const mixed = mixAudioTrack(overloaded, loud.source);
    // ОБЕ ПОЛОВИНЫ ПРАВИЛА В ОДНОМ ТЕСТЕ: насыщение случилось, названо числом — и сборка
    // дошла до конца (исключения нет, длина дорожки прежняя).
    expect(mixed.clippedSamples).toBeGreaterThan(0);
    expect(mixed.track.samples.length).toBe(loud.plan.totalSamples);
    expect(mixed.loudness.fullScaleSamples).toBeGreaterThan(0);

    // А без перегруза — РОВНО НОЛЬ: иначе тест выше был бы зелёным при вечно ненулевом счётчике.
    expect(mixAudioTrack(loud.plan, loud.source).clippedSamples).toBe(0);
  });

  it('`mix.enabled: false` — дорожка ПОБАЙТНО равна дорожке до `X-02`', async () => {
    const off = await mixable(BED_LEVEL, (base) => ({ ...base, mix: { ...base.mix, enabled: false } }));
    const voice = renderAudioTrack(off.plan, off.source);
    const mixed = mixAudioTrack(off.plan, off.source);
    expect(mixed.beds).toHaveLength(0);
    expect(mixed.clippedSamples).toBe(0);
    expect(sha256Of(bytesFromPcm(mixed.track))).toBe(sha256Of(bytesFromPcm(voice)));
  });

  it('ПРОЕКТ БЕЗ ПОДЛОЖКИ не изменился ни байтом: микс из одного слагаемого не считается', async () => {
    // Режиссура без `bed@1` — то же состояние, что у `examples/ai-test-1` и `pompeii-30`.
    const project = await buildProject(undefined, undefined, { direction: null });
    const timeline = compose(project.input);
    const manifest = compileIr({ timeline, profile: project.input.profile, seedRoot: SEED_ROOT }).manifest;
    const profile = {
      ...fixtureAudioProfile(),
      projectSampleRate: project.input.profile.projectSampleRate,
      fps: project.input.profile.fps,
    };
    const plan = compileAudio({ timeline, manifest, profile });
    const source = await pcmSourceOf(project);
    expect(plan.music).toHaveLength(0);
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    expect(sha256Of(bytesFromPcm(mixed.track))).toBe(sha256Of(bytesFromPcm(voice)));
    expect(mixed.beds).toHaveLength(0);
  });

  it('чужая частота ассета — ОТКАЗ, а не тихий ресемпл (ADR-0010 §9)', async () => {
    const { plan, source } = await mixable();
    const wrong = new Int16Array(2_880_000);
    wrong.fill(BED_LEVEL);
    // 48000 — не абстрактная «другая частота», а САМАЯ вероятная: в ней приходит почти
    // всякий музыкальный файл, и проект собирается на 24000 (`fixtures/minimal`).
    expect(plan.sampleRate).not.toBe(48000);
    source.set(PAD_LOOP, pcmS16(48000, wrong));
    expect(() => mixAudioTrack(plan, source)).toThrow(/Ресемплинг музыки происходит ОДИН РАЗ на ingest/);
  });

  it('байтов ассета нет — отказ называет sha и роль, а не тишину', async () => {
    const { plan, source } = await mixable();
    source.delete(PAD_LOOP);
    expect(() => mixAudioTrack(plan, source)).toThrow(new RegExp(`нет байтов ассета ${PAD_LOOP}`));
  });
});

/**
 * Сэмпл ВНУТРИ окна подложки, но вне речи и вне рампы duck'а.
 *
 * Ищется по плану, а не назначается числом: сдвинься разбиение фикстуры на сэмпл — и
 * литеральная позиция молча уехала бы в речь, а тест остался бы зелёным на неверном
 * утверждении.
 */
function quietSampleIn(plan: AudioPlan): number {
  const clip = plan.music[0];
  if (clip === undefined) throw new Error('в плане нет клипа подложки');
  const ramp = plan.mix.duckRampSamples;
  for (const element of plan.elements) {
    if (element.kind !== 'silence') continue;
    const from = Math.max(element.atSample + ramp, clip.atSample + plan.mix.crossfadeSamples);
    const to = Math.min(element.atSample + element.lengthSamples - ramp, clip.untilSample - plan.mix.crossfadeSamples);
    if (to - from > 2) return Math.floor((from + to) / 2);
  }
  throw new Error('в фикстуре не нашлось тишины длиннее двух рамп внутри окна подложки');
}

/** Сэмпл В СЕРЕДИНЕ речевого элемента, попавшего в окно подложки. */
function speechSampleIn(plan: AudioPlan): number {
  const clip = plan.music[0];
  if (clip === undefined) throw new Error('в плане нет клипа подложки');
  for (const element of plan.elements) {
    if (element.kind !== 'speech') continue;
    const middle = element.atSample + Math.floor(element.lengthSamples / 2);
    if (middle > clip.atSample + plan.mix.crossfadeSamples && middle < clip.untilSample - plan.mix.crossfadeSamples) {
      return middle;
    }
  }
  throw new Error('в фикстуре не нашлось речи внутри окна подложки');
}
