// **`vpe build` выбирает провайдера по `project.yaml → voice.providerId`** (`V-06`, долг №197).
//
// БРАУЗЕРА И СЕТИ ЗДЕСЬ НЕТ НИ В ОДНОМ ТЕСТЕ. Рендерер подменён, как и в `build.test.ts`, а
// сеть подменена ТЕМ ЖЕ приёмом, каким её получает настоящая команда: транспорт — вход
// (`BuildDeps.httpTransport`), и здесь в него подставляется функция, отвечающая формой SP-2.
// То есть весь живой путь — снимок аккаунта, платный вызов, провенанс дубля — проверяется
// целиком и бесплатно; в сеть не уходит ни один байт.
//
// ЧТО ДОКАЗЫВАЕТСЯ ЗДЕСЬ, ЧЕГО НЕ ДОКАЗЫВАЛ `L-01`:
//   1. проект, назвавший живого провайдера, БОЛЬШЕ НЕ СОБИРАЕТСЯ МОКОМ (долг №197);
//   2. без транспорта живой вызов невыразим — отказ с инструкцией (**Н4**);
//   3. неизвестное имя провайдера — отказ, а не молчаливая подстановка;
//   4. дубль с ЧУЖИМ `voiceKey` считается промахом, а не попаданием: смена провайдера в
//      `project.yaml` не имеет права собрать ролик на старых дублях мока;
//   5. провенанс дубля несёт СНИМОК АККАУНТА — класс голоса, тариф и ставку.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FRAME_PATTERN, FRAME_START_NUMBER, type RenderResponse } from '@vpe/renderer-hyperframes';
import { MOCK_SAMPLE_RATE, synthesize, type HttpRequest, type HttpResponse } from '@vpe/voice';

import { build, type BuildDeps } from '../src/build.js';
import type { BuildArgs } from '../src/argv.js';
import { CliError } from '../src/errors.js';

import {
  TEST_FINGERPRINT,
  cleanupRoots,
  countingRandom,
  makePng,
  makeProject,
  writeGates,
  type TestProject,
} from './build-fixture.js';

afterAll(cleanupRoots);

const USED = ['still@1'];
const LIVE_PROVIDER = 'tts:elevenlabs@1';
const VOICE_ENV = 'VPE_TEST_VOICE_ID';
const VOICE_VALUE = 'test-not-a-voice';
const API_KEY = 'test-not-a-key';

/** Рендерер-подделка: настоящие PNG, нужное число кадров (образец — `build.test.ts`). */
function frameRenderer(calls: { count: number }): NonNullable<BuildDeps['render']> {
  const png = makePng();
  return (request) => {
    calls.count += 1;
    const dir = path.join(request.tmpDir, 'frames');
    mkdirSync(dir, { recursive: true });
    const frameCount = Number(request.ir.segmentDurationInFrames);
    for (let i = 0; i < frameCount; i += 1) {
      const name = `frame_${String(FRAME_START_NUMBER + i).padStart(6, '0')}.png`;
      writeFileSync(path.join(dir, name), png);
    }
    const response: RenderResponse = {
      ok: true,
      frames: { dir, pattern: FRAME_PATTERN, startNumber: FRAME_START_NUMBER, frameCount },
      engineCompositionHash: null,
      engineFingerprint: null,
      engineProbe: null,
      browserLaunchLine: null,
      stats: { wallMs: 1, retries: 0, peakRssBytes: 1 },
    };
    return Promise.resolve(response);
  };
}

/**
 * Транспорт-подделка провайдера: снимок аккаунта и `/with-timestamps`.
 *
 * Аудио и alignment берутся у `tts:mock@1` — `FACT` (SP-2, `mock.test.mjs`): он отвечает ТОЙ
 * ЖЕ формой, что живой эндпойнт. Значит подделка не выдумана, а перенесена.
 */
function fakeApi(calls: { tts: number }): (request: HttpRequest) => Promise<HttpResponse> {
  return (request) => {
    if (request.url.includes('/v1/user/subscription')) {
      return Promise.resolve({ status: 200, body: JSON.stringify({ tier: 'creator' }) });
    }
    if (request.url.includes('/v1/voices/')) {
      return Promise.resolve({ status: 200, body: JSON.stringify({ category: 'professional' }) });
    }
    calls.tts += 1;
    const text = String(JSON.parse(request.body ?? '{}').text);
    const r = synthesize({ text, seed: 7 });
    return Promise.resolve({
      status: 200,
      body: JSON.stringify({
        audio_base64: r.audio_base64,
        alignment: r.alignment,
        normalized_alignment: r.normalized_alignment,
      }),
    });
  };
}

/** Переписывает блок `voice` проекта: провайдера и имя переменной голоса. */
function useProvider(project: TestProject, providerId: string, voiceEnv = VOICE_ENV): void {
  const file = path.join(project.projectDir, 'project.yaml');
  const text = readFileSync(file, 'utf8')
    .replace(/providerId: "[^"]*"/u, `providerId: "${providerId}"`)
    .replace(/voiceId: "[^"]*"/u, `voiceId: "${voiceEnv}"`);
  writeFileSync(file, text, 'utf8');
  // Роль фикстуры называет ту же переменную — иначе чанк с ролью ушёл бы к другому голосу.
  const roles = path.join(project.projectDir, 'voice/roles.yaml');
  writeFileSync(
    roles,
    readFileSync(roles, 'utf8').replace(/voice_id: "[^"]*"/u, `voice_id: "${voiceEnv}"`),
    'utf8',
  );
}

interface RunOptions {
  readonly allowTts?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: (request: HttpRequest) => Promise<HttpResponse>;
}

async function runBuild(
  project: TestProject,
  options: RunOptions = {},
): Promise<{ code: number; out: string; err: string; calls: { count: number } }> {
  let out = '';
  const calls = { count: 0 };
  const args: BuildArgs = {
    command: 'build',
    projectDir: project.projectDir,
    profileId: 'final',
    allowTts: options.allowTts ?? true,
    now: '2026-08-31T00:00:00.000Z',
    buildDir: project.buildDir,
    writeRoot: null,
    storeDir: project.storeDir,
    gatesDir: project.gatesDir,
  };
  const deps: BuildDeps = {
    now: () => '2026-08-31T00:00:00.000Z',
    clock: () => 0,
    randomBytes: countingRandom(),
    out: (text) => (out += text),
    env: options.env ?? {},
    render: frameRenderer(calls),
    fingerprint: () => TEST_FINGERPRINT,
    ...(options.transport === undefined ? {} : { httpTransport: options.transport }),
  };
  try {
    const code = await build(args, deps);
    return { code, out, err: '', calls };
  } catch (error) {
    // Код выхода из САМОГО отказа — так его и превращает в код `runCli` (`src/run.ts`).
    // Ловить здесь обязательно: `build` бросает `CliError`, а не возвращает его.
    const code = error instanceof CliError ? error.exitCode : -1;
    return { code, out, err: error instanceof Error ? error.message : String(error), calls };
  }
}

describe('выбор провайдера по имени проекта (долг №197)', () => {
  it('неизвестное имя — отказ с перечнем известных, и ни одного кадра', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    useProvider(project, 'tts:nobody@9');

    const ran = await runBuild(project);
    expect(ran.err).toContain('не реализован');
    expect(ran.err).toContain('tts:mock@1');
    expect(ran.calls.count, 'до рендера дело дойти не должно').toBe(0);
  });

  it('**Н4** — живой провайдер без транспорта: отказ называет флаг, сеть не зовётся', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    useProvider(project, LIVE_PROVIDER);

    const ran = await runBuild(project, { env: { [VOICE_ENV]: VOICE_VALUE } });
    expect(ran.code).toBe(2);
    expect(ran.out + ran.err).toContain('ELEVENLABS_LIVE');
    expect(ran.calls.count).toBe(0);
  });

  it('живой провайдер с транспортом: дубли сняты им, провенанс несёт снимок аккаунта', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    useProvider(project, LIVE_PROVIDER);
    const api = { tts: 0 };

    const ran = await runBuild(project, {
      transport: fakeApi(api),
      env: {
        [VOICE_ENV]: VOICE_VALUE,
        ELEVENLABS_API_KEY: API_KEY,
        ELEVENLABS_RATE_PER_CODEPOINT: '0.55',
      },
    });

    expect(ran.err).toBe('');
    expect(ran.code).toBe(0);
    expect(api.tts, 'дубли обязан снять названный провайдер, а не мок').toBeGreaterThan(0);

    const takesDir = path.join(project.projectDir, 'voice/takes');
    const files = readdirSync(takesDir).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const take = JSON.parse(readFileSync(path.join(takesDir, files[0] ?? ''), 'utf8')) as {
      provenance: Record<string, unknown>;
      spokenText: string;
    };
    expect(take.provenance['providerId']).toBe(LIVE_PROVIDER);
    // Снимок аккаунта, а не константы: класс голоса и тариф пришли ответами провайдера.
    expect(take.provenance['voiceCategory']).toBe('professional');
    expect(take.provenance['planTierAtGeneration']).toBe('creator');
    // Ставка лежит РЯДОМ с тарифом и приехала из окружения, а не из кода (ADR-0010 §2).
    expect(take.provenance['planRateAtGeneration']).toBe(0.55);
    // `billedUnits` — отправленные CODE POINTS, вычислимо офлайн из самого дубля.
    expect(take.provenance['billedUnits']).toBe([...take.spokenText].length);
    // Имя переменной в провенансе, ЗНАЧЕНИЕ — нет (CLAUDE.md §2).
    expect(take.provenance['voiceId']).toBe(VOICE_ENV);
    expect(JSON.stringify(take)).not.toContain(VOICE_VALUE);
  });
});

describe('дубль с чужим `voiceKey` — промах, а не попадание', () => {
  it('смена провайдера не собирает ролик на старых дублях: **K8** без `--allow-tts`', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);

    // 1. Сборка на моке — дубли ложатся на диск честно.
    const first = await runBuild(project);
    expect(first.code).toBe(0);
    const takesDir = path.join(project.projectDir, 'voice/takes');
    const before = readdirSync(takesDir).filter((name) => name.endsWith('.json'));
    expect(before.length).toBeGreaterThan(0);

    // 2. Проект переведён на живого провайдера. Имена файлов не изменились ни одно: `chunkKey`
    //    — идентичность МЕСТА. Содержимое дублей при этом стало чужим.
    useProvider(project, LIVE_PROVIDER);

    const second = await runBuild(project, {
      allowTts: false,
      env: { [VOICE_ENV]: VOICE_VALUE },
    });
    expect(second.code, 'K8: промах `voice` без `--allow-tts` — падение').toBe(1);
    expect(second.out + second.err).toContain('`voiceKey` не тот');
    expect(second.calls.count).toBe(0);
    // Старые дубли на диске не тронуты — падение не портит оплаченное.
    expect(readdirSync(takesDir).filter((name) => name.endsWith('.json'))).toEqual(before);
  });

  it('с разрешением — пересняты живым провайдером, и это видно строкой отчёта', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    const first = await runBuild(project);
    expect(first.code).toBe(0);

    useProvider(project, LIVE_PROVIDER);
    const api = { tts: 0 };
    const second = await runBuild(project, {
      transport: fakeApi(api),
      env: { [VOICE_ENV]: VOICE_VALUE, ELEVENLABS_API_KEY: API_KEY },
    });

    expect(second.err).toBe('');
    expect(second.out).toContain('дублей с чужим `voiceKey`');
    expect(api.tts).toBeGreaterThan(0);
    const takesDir = path.join(project.projectDir, 'voice/takes');
    const file = readdirSync(takesDir).filter((name) => name.endsWith('.json'))[0] ?? '';
    const take = JSON.parse(readFileSync(path.join(takesDir, file), 'utf8')) as {
      provenance: Record<string, unknown>;
      pcm: { sampleRate: number };
    };
    expect(take.provenance['providerId']).toBe(LIVE_PROVIDER);
    expect(take.pcm.sampleRate).toBe(MOCK_SAMPLE_RATE);
    // Ставки в окружении нет — в провенансе `null`, а не выдуманный ноль.
    expect(take.provenance['planRateAtGeneration']).toBeNull();
  });
});
