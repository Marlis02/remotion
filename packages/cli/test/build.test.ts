// **`vpe build` — критерии `L-01` делом.** Браузера здесь нет ни в одном тесте: рендерер
// подменён (`deps.render`), а всё остальное — настоящее, включая ffmpeg, кодирование сегмента
// и мукс финала. Живой прогон с браузером — отдельный файл (`build-e2e.test.ts`).
//
// ЧТО ПОДМЕНЕНО И ПОЧЕМУ ИМЕННО ЭТО. Подменён ровно один вызов — запуск рендерера, — и он
// отдаёт НАСТОЯЩИЕ кадры (32×32 PNG, детерминированные байты). Всё, что ниже по течению —
// `encodeSegment`, `ffprobe`, `framemd5`, конкат и мукс, — работает как в живой сборке. Иначе
// критерий «две сборки дают равные артефакты» проверялся бы на заглушке.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FRAME_PATTERN, FRAME_START_NUMBER, type RenderResponse } from '@vpe/renderer-hyperframes';

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

/** Шаблоны, которые зовёт короткая проза с её режиссурой: порождённый `[img:]` и запись. */
const USED = ['still@1'];

/**
 * Подменённый рендерер: пишет НАСТОЯЩИЕ PNG в каталог кадров и отдаёт их адрес.
 *
 * Кадров ровно `segmentDurationInFrames`: расхождение хотя бы на один ловит **R8** внутри
 * `encodeSegment` — то есть подмена не может незаметно «упростить» вход `media`.
 */
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

interface RunOptions {
  readonly now?: string;
  readonly writeRoot?: string;
  readonly allowTts?: boolean;
  readonly buildDir?: string;
  readonly gatesDir?: string;
  readonly fingerprint?: string;
  readonly speech?: BuildDeps['speech'];
  readonly env?: NodeJS.ProcessEnv;
}

interface Ran {
  readonly code: number;
  readonly out: string;
  readonly calls: { count: number };
}

async function runBuild(project: TestProject, options: RunOptions = {}): Promise<Ran> {
  let out = '';
  const calls = { count: 0 };
  const args: BuildArgs = {
    command: 'build',
    projectDir: project.projectDir,
    profileId: 'final',
    // Профиль называет проект: явного файла у сборки нет (`F-01`).
    profilePath: null,
    allowTts: options.allowTts ?? true,
    now: options.now ?? '2026-08-30T00:00:00.000Z',
    buildDir: options.buildDir ?? project.buildDir,
    writeRoot: options.writeRoot ?? null,
    storeDir: project.storeDir,
    gatesDir: options.gatesDir ?? project.gatesDir,
  };
  const deps: BuildDeps = {
    now: () => '2026-08-30T99:99:99Z',
    clock: () => 0,
    randomBytes: countingRandom(),
    out: (text) => (out += text),
    env: options.env ?? {},
    render: frameRenderer(calls),
    fingerprint: () => options.fingerprint ?? TEST_FINGERPRINT,
    ...(options.speech === undefined ? {} : { speech: options.speech }),
  };
  const code = await build(args, deps);
  return { code, out, calls };
}

/** Все файлы каталога рекурсивно, путями ОТНОСИТЕЛЬНО него и отсортированно. */
function filesUnder(root: string, sub = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, sub)).sort()) {
    const rel = sub === '' ? name : `${sub}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...filesUnder(root, rel));
    else out.push(rel);
  }
  return out;
}

describe('**D9** — `now` вход сборки: две сборки с разным `now` дают равные артефакты', () => {
  it('артефакты `build/` побайтово равны, а `BuildRecord` различается РОВНО полем `now`', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);

    // ПЕРВАЯ сборка — прогревочная, и это названо: она создаёт `anchors.lock.jsonl` и
    // оплачивает дубли. Минт якорей `w:` идёт из CSPRNG (ADR-0004 §4), то есть на ПЕРВОЙ
    // сборке проекта ledger рождается, а не читается; сравнивать с ней вторую значило бы
    // сравнивать заодно и свежие минты. Сравниваются сборки №2 и №3 — обе на готовом ledger'е.
    await runBuild(project, { now: '2026-08-30T00:00:00.000Z', buildDir: path.join(project.root, 'b1') });

    const second = path.join(project.root, 'b2');
    const third = path.join(project.root, 'b3');
    await runBuild(project, { now: '2020-01-01T00:00:00.000Z', buildDir: second });
    await runBuild(project, { now: '2031-12-31T23:59:59.000Z', buildDir: third });

    // ЧТО СРАВНИВАЕТСЯ. Всё в `build/`, КРОМЕ двух каталогов: `reports/` (там `now`, стенка и
    // счётчики прогона — см. шапку `record.ts`) и `tmp/` (рабочая область: в списке конката
    // лежат АБСОЛЮТНЫЕ пути сегментов, а они содержат имя каталога сборки, то есть различаются
    // у двух сборок по построению). Каталог композиции живёт в `tmp/`, и его равенство
    // проверяется не байтами файлов, а `bundleHash` в `BuildRecord` ниже — это та же величина.
    const artifacts = (dir: string): string[] =>
      filesUnder(dir).filter((file) => !file.startsWith('reports/') && !file.startsWith('tmp/'));
    const files = artifacts(second);
    expect(files).toEqual(artifacts(third));
    expect(files).toContain('final.mp4');
    expect(files).toContain('audio/track.wav');

    for (const file of files) {
      expect(
        readFileSync(path.join(second, file)).equals(readFileSync(path.join(third, file))),
        `\`${file}\` разошёлся между сборками с разным \`now\``,
      ).toBe(true);
    }

    const recordOf = (dir: string): Record<string, unknown> =>
      JSON.parse(readFileSync(path.join(dir, 'reports/build-record.json'), 'utf8')) as Record<string, unknown>;
    const a = recordOf(second);
    const b = recordOf(third);
    expect(a['now']).toBe('2020-01-01T00:00:00.000Z');
    expect(b['now']).toBe('2031-12-31T23:59:59.000Z');
    expect({ ...a, now: null }).toEqual({ ...b, now: null });
  }, 120_000);

  it('`--now` перекрывает `VPE_NOW`, а тот — часы процесса: порядок объявлен', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    await runBuild(project, {
      now: '2026-08-30T00:00:00.000Z',
      env: { VPE_NOW: '1999-01-01T00:00:00.000Z' },
    });
    const record = JSON.parse(
      readFileSync(path.join(project.buildDir, 'reports/build-record.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(record['now']).toBe('2026-08-30T00:00:00.000Z');
  }, 120_000);
});

describe('`--write-root` — куда сборка пишет артефакты авторства', () => {
  it('дубли, `store.lock` и ledger уходят в названный корень, а проект остаётся нетронутым', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    const writeRoot = path.join(project.root, 'write');

    await runBuild(project, { writeRoot });

    // Три артефакта авторства — в корне записи.
    expect(existsSync(path.join(writeRoot, 'anchors.lock.jsonl'))).toBe(true);
    expect(existsSync(path.join(writeRoot, 'store.lock'))).toBe(true);
    expect(readdirSync(path.join(writeRoot, 'voice/takes')).length).toBeGreaterThan(0);

    // В дереве проекта не появилось НИЧЕГО: ради этого флаг и заведён — прогон на
    // `fixtures/minimal` обязан оставлять её байт в байт такой же.
    expect(existsSync(path.join(project.projectDir, 'anchors.lock.jsonl'))).toBe(false);
    expect(readdirSync(path.join(project.projectDir, 'voice/takes'))).toEqual(['.gitkeep']);
  }, 120_000);
});

describe('**K8** — промах `voice` без `--allow-tts`', () => {
  it('падает с инструкцией и НЕ зовёт источник дубля ни разу', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    let synthesized = 0;

    const attempt = runBuild(project, {
      allowTts: false,
      speech: () => {
        synthesized += 1;
        throw new Error('источник позван — этого не должно было случиться');
      },
    });

    await expect(attempt).rejects.toThrow(CliError);
    await attempt.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('K8');
      expect(message).toContain('--allow-tts');
      // Инструкция называет и ВТОРОЙ путь: дубли можно принести, а не оплачивать заново.
      expect(message).toContain('vpe store fetch');
    });
    expect(synthesized).toBe(0);
    expect(existsSync(path.join(project.buildDir, 'final.mp4'))).toBe(false);
  }, 60_000);

  it('с `--allow-tts` те же дубли оплачиваются один раз, а вторая сборка их читает', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    await runBuild(project, { buildDir: path.join(project.root, 'b1') });
    const first = JSON.parse(
      readFileSync(path.join(project.root, 'b1/reports/build-record.json'), 'utf8'),
    ) as { voice: { sourceCalls: number; chunks: number } };
    expect(first.voice.sourceCalls).toBeGreaterThan(0);

    // Второй прогон БЕЗ разрешения: промаха нет — дубли уже лежат в дереве.
    await runBuild(project, { allowTts: false, buildDir: path.join(project.root, 'b2') });
    const second = JSON.parse(
      readFileSync(path.join(project.root, 'b2/reports/build-record.json'), 'utf8'),
    ) as { voice: { sourceCalls: number } };
    expect(second.voice.sourceCalls).toBe(0);
  }, 120_000);
});

describe('**R12** — сборка не стартует без действующей записи гейта', () => {
  it('записей нет — отказ перечисляет шаблоны и команду пересъёмки', async () => {
    const project = makeProject();
    mkdirSync(project.gatesDir, { recursive: true });
    await expect(runBuild(project)).rejects.toThrow(/R12/u);
    await runBuild(project).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('still@1');
      expect(message).toContain('vpe template gate');
    });
  }, 120_000);

  it('запись СНЯТА НА ДРУГОМ ОКРУЖЕНИИ — отказ называет оба отпечатка', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final'], 'a'.repeat(64));
    await runBuild(project, { fingerprint: TEST_FINGERPRINT }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('a'.repeat(64));
      expect(message).toContain(TEST_FINGERPRINT);
    });
    await expect(runBuild(project, { fingerprint: TEST_FINGERPRINT })).rejects.toThrow(/R12/u);
  }, 120_000);

  it('запись есть только на `draftHalf` — сборка на `final` не стартует', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['draftHalf']);
    await expect(runBuild(project)).rejects.toThrow(/draftHalf/u);
  }, 120_000);
});

describe('**№168** — первый настоящий IR через адаптер: `NaN`-окон нет', () => {
  it('в каталоге композиции окна клипов лежат парой `frameStart`/`frameEnd`, и `NaN` в нём нет', async () => {
    const project = makeProject();
    writeGates(project.gatesDir, USED, ['final']);
    await runBuild(project);

    const tmp = path.join(project.buildDir, 'tmp', 'segments');
    const segments = readdirSync(tmp).sort();
    expect(segments.length).toBeGreaterThan(0);

    for (const segment of segments) {
      const dir = path.join(tmp, segment, 'composition');
      const ir = JSON.parse(readFileSync(path.join(dir, 'ir.json'), 'utf8')) as {
        clips: readonly { frames: Record<string, unknown> }[];
      };
      expect(ir.clips.length).toBeGreaterThan(0);
      for (const clip of ir.clips) {
        // ФОРМА МОДЕЛИ, и это ровно то, что читает `runtime.js` после `L-01`. Прежняя форма
        // рантайма (`start`/`end`) дала бы `clip.frames.frameStart === undefined`, то есть
        // `data-start="NaN"` и невидимый клип — долг №168 в его исполненном виде.
        expect(Object.keys(clip.frames).sort()).toEqual(['frameEnd', 'frameStart']);
        expect(Number.isFinite(Number(clip.frames['frameStart']))).toBe(true);
        expect(Number.isFinite(Number(clip.frames['frameEnd']))).toBe(true);
      }

      // Разметка композиции: `data-duration` корня стоит в СТАТИЧЕСКОМ html (её читает
      // компилятор рендерера до запуска браузера, измерение `H-01`), и она обязана быть
      // числом. Слова `NaN` в файле искать нельзя — оно законно встречается в тексте
      // заморозки и комментариях; проверяется ЗНАЧЕНИЕ атрибута, а не наличие подстроки.
      const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
      const durations = [...html.matchAll(/data-duration="([^"]*)"/gu)].map((m) => m[1] ?? '');
      expect(durations.length).toBeGreaterThan(0);
      for (const value of durations) expect(Number.isFinite(Number(value))).toBe(true);
      // Рантайм, встроенный в этот же файл, читает окно ФОРМОЙ МОДЕЛИ — иначе `data-start`
      // клипа в браузере стал бы `NaN` (долг №168 в его исполненном виде).
      expect(html).toContain('clip.frames.frameStart');
    }
  }, 120_000);
});
