// `VID-02b` — ЗВУК `video@1`: `off | full | duck`, пауза кадра, отказы.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И НА ЧЁМ. Три утверждения про ДЕКЛАРАЦИЮ шаблона (что он объявляет
// при каждом из трёх значений `audio`) проверяются на самом спеке — это чистая функция
// `params`. Утверждения про УКЛАДКУ (звук без петли, тишина под паузой, уровни) — на
// настоящем плане фикстуры, подставляя синтетический спек с тем же контрактом, что у
// `video@1`: в `fixtures/minimal` видео-ассета нет и заводить его ради теста значило бы
// править фикстуру под тест.
//
// ПОЧЕМУ ЭТО НЕ «ТЕСТ ЗАГЛУШКИ». Синтетический спек отличается от `video@1` ровно тем, что не
// рисует кадров и берёт звук у звукового ассета фикстуры; всё, что проверяется ниже, —
// `loop: false`, паузы, уровни и микс — живёт НЕ в спеке, а в стадии звука и в тракте, то
// есть ровно в том коде, которым поедет и настоящее видео. Форму декларации самого `video@1`
// проверяют первые три теста файла, и вместе они смыкаются.

import { afterAll, describe, expect, it } from 'vitest';

import { asSamples, type PlacedRecord } from '@vpe/core-model';
import { buildAssetCatalog, bytesFromPcm, pcmS16, sha256Of, type AssetCatalog, type PcmS16 } from '@vpe/media';
import {
  TEMPLATE_LIBRARY,
  TEMPLATE_REGISTRY_VERSION,
  declaredAudioOf,
  type AnyTemplateSpec,
  type AudioContribution,
} from '@vpe/templates-spec';

import {
  CompileError,
  compileAudio,
  compileIr,
  compose,
  mixAudioTrack,
  renderAudioTrack,
  templateContracts,
} from '../src/index.js';

import { fixtureAudioProfile } from './fixture.js';
import { buildProject, cleanupRoots, pcmSourceOf, registryOf } from './project.js';

afterAll(cleanupRoots);

const SEED_ROOT = 1;

/**
 * Спек `video@1` — ИЗ БИБЛИОТЕКИ, а не импортом файла: библиотека и есть то, что увидит
 * сборка, и брать спек мимо неё значило бы проверять другой объект.
 */
const video1 = ((): AnyTemplateSpec => {
  const found = TEMPLATE_LIBRARY.find((spec) => spec.templateId === 'video');
  if (found === undefined) throw new Error('в библиотеке нет `video@1`');
  return found;
})();
const PAD_LOOP = '0000000000000000000000000000000000000000000000000000000000000004';
const LEVEL = 20000;

// ── 1. Декларация самого `video@1` ─────────────────────────────────────────────────────────

describe('`VID-02b` — что `video@1` объявляет при трёх значениях `audio`', () => {
  it('`off` и отсутствие поля — звука НЕТ, и это `null`, а не пустая декларация', () => {
    expect(declaredAudioOf(video1, { asset: 'clip' })).toBeNull();
    expect(declaredAudioOf(video1, { asset: 'clip', audio: 'off' })).toBeNull();
  });

  it('`full` — звук идёт РОВНО: `duckUnderSpeechDb` ноль, петли нет, in-point кадрами источника', () => {
    const audio = declaredAudioOf(video1, { asset: 'clip', audio: 'full', inPointFrame: 12 });
    expect(audio).toEqual<AudioContribution>({
      role: 'video',
      inPoint: { unit: 'sourceFrames', value: 12 },
      gainDb: 0,
      duckUnderSpeechDb: 0,
      loop: false,
      pauses: [],
    });
  });

  it('`duck` — умолчание подавления равно ИЗМЕРЕННОМУ пресету `mid` (`SP-VID` A6)', () => {
    const audio = declaredAudioOf(video1, { asset: 'clip', audio: 'duck' });
    // −6.30 дБ — разность двух `ebur128` из спайка, а не круглое число: поэтому и проверяется
    // литералом отчёта, а не «примерно −6».
    expect(audio?.duckUnderSpeechDb).toBe(-6.3);
    expect(audio?.gainDb).toBe(0);
  });

  it('`holds` уезжают в звук паузами — миллисекундами источника и кадрами сегмента', () => {
    const audio = declaredAudioOf(video1, {
      asset: 'clip',
      audio: 'full',
      holds: [{ atVideoSec: 1.5, durationFrames: 30 }],
    });
    expect(audio?.pauses).toEqual([{ atSourceMs: 1500, frames: 30 }]);
  });

  it('уровень при выключенном звуке — ОТКАЗ схемы, а не молчаливое включение', () => {
    const parsed = video1.paramsSchema.safeParse({ asset: 'clip', gainDb: -3 });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('уровень у того, чего нет в дорожке');
  });

  it('`duckUnderSpeechDb` при `audio: "full"` — отказ: подавления там нет', () => {
    const parsed = video1.paramsSchema.safeParse({ asset: 'clip', audio: 'full', duckUnderSpeechDb: -6 });
    expect(parsed.success).toBe(false);
  });

  it('усиление выше нуля — отказ схемы, до всякого микса', () => {
    const parsed = video1.paramsSchema.safeParse({ asset: 'clip', audio: 'full', gainDb: 3 });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('не поднимает уровень выше принесённого');
  });
});

// ── 2. Укладка звука без петли и с паузой ─────────────────────────────────────────────────

/**
 * Спек с тем же КОНТРАКТОМ ЗВУКА, что у `video@1`, но на звуковом ассете фикстуры.
 *
 * Кадров не рисует (как `bed@1`): проверяется дорожка, а не картинка.
 */
function soundSpec(audio: Omit<AudioContribution, 'role'>): AnyTemplateSpec {
  const bed = TEMPLATE_LIBRARY.find((spec) => spec.templateId === 'bed');
  if (bed === undefined) throw new Error('в библиотеке нет `bed@1`');
  return {
    ...(bed as AnyTemplateSpec),
    declareAudio: () => ({ role: 'asset', ...audio }),
  };
}

interface Built {
  readonly plan: ReturnType<typeof compileAudio>;
  readonly source: Map<string, PcmS16>;
}

/** План фикстуры, у которого `bed@1` подменён спеком с поданным контрактом звука. */
async function build(audio: Omit<AudioContribution, 'role'>): Promise<Built> {
  const specs = TEMPLATE_LIBRARY.map((spec) => (spec.templateId === 'bed' ? soundSpec(audio) : spec));
  const project = await buildProject(undefined, undefined, { specs });
  const timeline = compose(project.input);
  const manifest = compileIr({ timeline, profile: project.input.profile, seedRoot: SEED_ROOT }).manifest;
  const profile = {
    ...fixtureAudioProfile(),
    projectSampleRate: project.input.profile.projectSampleRate,
    fps: project.input.profile.fps,
  };
  const plan = compileAudio({ timeline, manifest, profile });
  const source = await pcmSourceOf(project);
  const samples = new Int16Array(2_880_000);
  samples.fill(LEVEL);
  source.set(PAD_LOOP, pcmS16(profile.projectSampleRate, samples));
  return { plan, source };
}

const FULL: Omit<AudioContribution, 'role'> = {
  inPoint: { unit: 'samples', value: 0 },
  gainDb: 0,
  duckUnderSpeechDb: 0,
  loop: false,
  pauses: [],
};

describe('`VID-02b` — звук клипа в дорожке', () => {
  it('`full`: вклад клипа равен байтам источника КАК ЕСТЬ (усиление 0 дБ ничего не меняет)', async () => {
    const { plan, source } = await build(FULL);
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const clip = plan.music[0];
    if (clip === undefined) throw new Error('клип со звуком не попал в план');
    // Середина окна, далеко от краевого микрофейда: там вклад обязан быть ровно уровнем
    // источника, потому что ни усиления, ни duck'а нет.
    const at = Math.floor((clip.atSample + clip.untilSample) / 2);
    expect((mixed.track.samples[at] ?? 0) - (voice.samples[at] ?? 0)).toBe(LEVEL);
  });

  it('`duck` −6.3 дБ: под речью вклад умножен на измеренную дробь, вне речи — нет', async () => {
    const { plan, source } = await build({ ...FULL, duckUnderSpeechDb: -6.3 });
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const sound = plan.music[0]?.audio;
    if (sound === undefined || sound === null) throw new Error('у клипа нет звука');
    const speech = plan.elements.find(
      (element) => element.kind === 'speech' && element.atSample > (plan.music[0]?.atSample ?? 0),
    );
    if (speech === undefined) throw new Error('в окне клипа нет речи');
    const inside = speech.atSample + Math.floor(speech.lengthSamples / 2);
    expect((mixed.track.samples[inside] ?? 0) - (voice.samples[inside] ?? 0)).toBe(
      Math.round((LEVEL * sound.duckedGain.numerator) / sound.duckedGain.denominator),
    );
    expect(sound.duckedGain.numerator).toBe(Math.round(Math.pow(10, -6.3 / 20) * 32768));
  });

  it('ПОД ПАУЗОЙ КАДРА — ТИШИНА, и ровно длиной паузы', async () => {
    // Пауза на 0 мс источника длиной 30 кадров = 24 000 сэмплов при 30 fps и 24 кГц: клип
    // начинается с неё, поэтому позиция тишины считается от начала окна без арифметики.
    const { plan, source } = await build({ ...FULL, pauses: [{ atSourceMs: 0, frames: 30 }] });
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const clip = plan.music[0];
    const sound = clip?.audio;
    if (clip === undefined || sound === undefined || sound === null) throw new Error('клипа со звуком нет');
    const pause = sound.pauses[0];
    if (pause === undefined) throw new Error('пауза не доехала до плана');
    expect(pause.lengthSamples).toBe(asSamples(24000));
    // Внутри паузы вклад клипа — НОЛЬ на каждом сэмпле (дорожка равна голосу побайтно).
    for (const offset of [10, 5000, 23990]) {
      const at = clip.atSample + offset;
      expect((mixed.track.samples[at] ?? 0) - (voice.samples[at] ?? 0), `сэмпл ${String(offset)} паузы`).toBe(0);
    }
    // А сразу за паузой звук есть — иначе тест был бы зелёным на выключенном звуке.
    const after = clip.atSample + Number(pause.lengthSamples) + 1000;
    expect((mixed.track.samples[after] ?? 0) - (voice.samples[after] ?? 0)).toBe(LEVEL);
  });

  it('без петли: за концом источника — ТИШИНА, а не вторая копия', async () => {
    const { plan, source } = await build(FULL);
    const clip = plan.music[0];
    if (clip === undefined) throw new Error('клипа нет');
    // Источник короче окна: 1000 сэмплов вместо шестисот тысяч.
    const short = new Int16Array(1000);
    short.fill(LEVEL);
    source.set(PAD_LOOP, pcmS16(plan.sampleRate, short));
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    const at = clip.atSample + 5000;
    expect((mixed.track.samples[at] ?? 0) - (voice.samples[at] ?? 0)).toBe(0);
  });

  it('ДЕТЕРМИНИЗМ звука видео: четыре укладки дают один sha', async () => {
    const { plan, source } = await build({ ...FULL, duckUnderSpeechDb: -6.3, pauses: [{ atSourceMs: 0, frames: 5 }] });
    const digests = new Set<string>();
    for (let run = 0; run < 4; run += 1) digests.add(sha256Of(bytesFromPcm(mixAudioTrack(plan, source).track)));
    expect([...digests]).toHaveLength(1);
  });

  it('`audio: "off"` — дорожка ПОБАЙТНО равна дорожке без клипа со звуком', async () => {
    const silent = TEMPLATE_LIBRARY.map((spec) =>
      spec.templateId === 'bed' ? ({ ...(spec as AnyTemplateSpec), declareAudio: () => null }) : spec,
    );
    const project = await buildProject(undefined, undefined, { specs: silent });
    const timeline = compose(project.input);
    const manifest = compileIr({ timeline, profile: project.input.profile, seedRoot: SEED_ROOT }).manifest;
    const profile = {
      ...fixtureAudioProfile(),
      projectSampleRate: project.input.profile.projectSampleRate,
      fps: project.input.profile.fps,
    };
    const plan = compileAudio({ timeline, manifest, profile });
    const source = await pcmSourceOf(project);
    const voice = renderAudioTrack(plan, source);
    const mixed = mixAudioTrack(plan, source);
    expect(plan.mixedClips).toBe(0);
    expect(sha256Of(bytesFromPcm(mixed.track))).toBe(sha256Of(bytesFromPcm(voice)));
  });
});

// ── 3. Отказы контракта: файл без звука и кадр без частоты ────────────────────────────────

describe('`VID-02b` — отказы стадии контракта', () => {
  /** Каталог из одной записи ВИДЕО с поданным `intrinsic`. Alias — `clip`. */
  function videoCatalog(intrinsic: Record<string, unknown>): AssetCatalog {
    const sha = 'a'.repeat(64);
    return buildAssetCatalog({
      aliases: { schema: 'aliases/1', clip: sha },
      records: [
        {
          filePath: `assets/records/${sha}.json`,
          record: {
            schema: 'asset-record/1',
            sha256: sha,
            kind: 'video',
            intrinsic,
            derivedFrom: null,
            provenance: {
              origin: { retrievedAt: '2026-09-12T00:00:00Z', sourceUrl: null },
              work: { status: 'own', note: 'синтетика теста' },
              recording: { status: 'own' },
              reproduction: { status: 'own', attributionRequired: false },
              sourceSnapshot: null,
              c2paManifestBlob: null,
            },
          } as never,
        },
      ],
    });
  }

  const PASSPORT = { width: 320, height: 180, rotation: 0, fps: { num: 24, den: 1 }, frames: 48, hasAlpha: false };

  /** Запись режиссуры с `video@1` и поданными `params` — в форме, которую строит `C-05`. */
  function record(params: Record<string, unknown>): PlacedRecord {
    return {
      filePath: 'direction/01.yaml',
      record: {
        recordId: 'aaaa1111',
        template: 'video@1',
        params,
        track: 'visual',
        z: 10,
        at: { kind: 'anchor', anchor: 'sc:one' },
      },
      scope: { chapterId: 'ch:one', sceneId: 'sc:one' },
    } as never;
  }

  const run = (params: Record<string, unknown>, intrinsic: Record<string, unknown>): CompileError => {
    try {
      templateContracts({
        records: [record(params)],
        generated: [],
        catalog: videoCatalog(intrinsic),
        registry: registryOf(),
        templateRegistryVersion: TEMPLATE_REGISTRY_VERSION,
        projectSampleRate: fixtureAudioProfile().projectSampleRate,
      });
    } catch (error) {
      if (error instanceof CompileError) return error;
      throw error;
    }
    throw new Error('ожидался отказ, а стадия прошла');
  };

  it('ВИДЕО БЕЗ ЗВУКОВОЙ ДОРОЖКИ + `audio: "full"` — отказ вслух, а не тишина молча', () => {
    const error = run({ asset: 'clip', audio: 'full' }, { ...PASSPORT, audio: null });
    expect(error.problems.map((problem) => problem.message).join('\n')).toContain('звуковой дорожки нет');
  });

  it('тот же файл при `audio: "off"` собирается: проверка стоит у ПРОСЬБЫ, а не у файла', () => {
    expect(() =>
      templateContracts({
        records: [record({ asset: 'clip', audio: 'off' })],
        generated: [],
        catalog: videoCatalog({ ...PASSPORT, audio: null }),
        registry: registryOf(),
        templateRegistryVersion: TEMPLATE_REGISTRY_VERSION,
        projectSampleRate: fixtureAudioProfile().projectSampleRate,
      }),
    ).not.toThrow();
  });

  it('in-point кадрами переводится в сэмплы ПО ЧАСТОТЕ ФАЙЛА, а не проекта', () => {
    const contracts = templateContracts({
      records: [record({ asset: 'clip', audio: 'full', inPointFrame: 12 })],
      generated: [],
      catalog: videoCatalog({ ...PASSPORT, audio: { sampleRate: 24000, channels: 1 } }),
      registry: registryOf(),
      templateRegistryVersion: TEMPLATE_REGISTRY_VERSION,
      projectSampleRate: fixtureAudioProfile().projectSampleRate,
    });
    // 12 кадров при 24/1 — ровно полсекунды; при 24 000 Гц это 12 000 сэмплов. Возьми
    // стадия частоту ПРОЕКТА (30 fps), получилось бы 9 600 — и звук поехал бы на 0.1 с.
    expect([...contracts.values()][0]?.audio?.inPointSamples).toBe(12000);
  });
});
