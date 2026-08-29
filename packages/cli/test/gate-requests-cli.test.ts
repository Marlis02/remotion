// **ВОСЕМЬ ФАЙЛОВ ЗАПРОСОВ ГЕЙТА ГЛАЗАМИ КОМАНДЫ** — и правка `GATE-PREP`, которая сделала их
// возможными. Браузера здесь нет: `deps.gate` подменён, проверяется ВХОД команды.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Побайтовая сверка тех же восьми файлов с билдером живёт в
// `renderer-hyperframes/test/gate-requests.test.ts` — там, где живёт единственный источник
// (`test/fixture.ts`, долг №179). Сюда её не перенести: импорт тестовой зоны чужого пакета не
// собирается `tsc --build`. Зато ЗДЕСЬ есть то, чего нет там: `@vpe/schema` (`readFamily`) и
// сама команда с охранником №181. Один и тот же файл проверяется с двух сторон, и ни одна
// сторона не повторяет другую.
//
// ЧТО ДОКАЗЫВАЕТСЯ ВОСЬМЬЮ ПРОГОНАМИ. Что владелец, скопировав строку из `docs/gate-runbook.md`,
// НЕ получит отказа на входе: файл читается, относительные пути резолвятся, тройка **K4**
// сходится с yaml-профилем, охранник названного шаблона доволен (в том числе на СМЕШАННОМ
// `kenburns@1` — `still@1` основанием, №181). Всё, что остаётся живому прогону, — сам гейт.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GateInput, GateOutcome, SegmentRenderRequest } from '@vpe/renderer-hyperframes';
import { RenderProfileSchema, readFamily } from '@vpe/schema';
import { GateFileSchema, type GateRecord } from '@vpe/templates-spec';

import { EXIT, runCli, type CliDeps } from '../src/index.js';
import { makeRequest, tempDir } from './fixture.js';

/** Каталог файлов запросов — соседний пакет, читается ФАЙЛАМИ, а не импортом. */
const REQUESTS = fileURLToPath(new URL('../../renderer-hyperframes/gate-requests', import.meta.url));

/** Профилей гейта ровно два (`GATE_PROFILES`); имя профиля — тип, а не свободная строка. */
type Pair = 'draftHalf' | 'final';

/** Профили пары: `draftHalf` — профиль гейта, `final` — настоящий профиль проекта. */
const PROFILE_FILES: Readonly<Record<Pair, string>> = {
  draftHalf: fileURLToPath(
    new URL('../../renderer-hyperframes/gate-profiles/draftHalf.yaml', import.meta.url),
  ),
  final: fileURLToPath(new URL('../../../fixtures/minimal/profiles/render.final.yaml', import.meta.url)),
};

const CALLS = ['still@1', 'kenburns@1', 'flash@1', 'captionEmphasis@1'] as const;
const PROFILES: readonly Pair[] = ['draftHalf', 'final'];
/** N профиля — то же, что в схеме манифеста (`GATE_RUNS`): 3 у `draftHalf`, 10 у `final`. */
const N_OF: Readonly<Record<Pair, number>> = { draftHalf: 3, final: 10 };

const PAIRS = CALLS.flatMap((call) =>
  PROFILES.map((profileId) => ({ call, profileId, file: path.join(REQUESTS, `${call}.${profileId}.json`) })),
);

/** Исход гейта, поданный вместо прогонов: команду проверяем до `runGate`, а не вместо него. */
const passOutcome = (profileId: Pair): GateOutcome =>
  ({
    class: 'PASS',
    profileId,
    N: N_OF[profileId],
    record: {
      profileId,
      N: N_OF[profileId],
      sha256: 'a'.repeat(64),
      framemd5: 'b'.repeat(64),
      date: '2026-08-29T00:00:00Z',
      engineFingerprint: 'c'.repeat(64),
      class: 'PASS',
    } satisfies GateRecord,
    runs: [],
  }) as unknown as GateOutcome;

interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly seen: SegmentRenderRequest | null;
}

/** Прогон команды с подменённым гейтом; запрос, доехавший до гейта, запоминается. */
async function run(argv: readonly string[], profileId: Pair = 'draftHalf'): Promise<Ran> {
  let out = '';
  let err = '';
  let seen: SegmentRenderRequest | null = null;
  const deps: CliDeps = {
    now: () => '2026-08-29T00:00:00Z',
    clock: () => 0,
    out: (text) => (out += text),
    err: (text) => (err += text),
    gate: (input: GateInput) => {
      seen = input.request;
      return Promise.resolve(passOutcome(profileId));
    },
  };
  const code = await runCli(argv, deps);
  return { code, out, err, seen };
}

/** Командная строка гейта: без `--gates-dir` запись легла бы в дерево исходников. */
function argvFor(call: string, profileId: Pair, requestFile: string, gatesDir: string, runRoot: string): string[] {
  return [
    'template',
    'gate',
    call,
    '--profile',
    profileId,
    '--request',
    requestFile,
    '--render-profile',
    PROFILE_FILES[profileId],
    '--gates-dir',
    gatesDir,
    '--run-root',
    runRoot,
  ];
}

describe('`GATE-PREP` — относительные пути файла запроса резолвятся ОТ ФАЙЛА, а не от `cwd`', () => {
  it('ассет, `tmpDir`, `outputPath` и `bundle.path` резолвятся от каталога файла запроса', async () => {
    const root = tempDir('rel');
    mkdirSync(path.join(root, 'store'), { recursive: true });
    writeFileSync(path.join(root, 'store', 'photo.blob'), 'не читается: гейт подменён');

    // `scale: 0.5` — из `gate-profiles/draftHalf.yaml`: команда сверяет тройку **K4** запроса с
    // НАСТОЯЩИМ профилем, и запрос на дефолтной четверти был бы отвергнут до резолва путей.
    const base = makeRequest(root, { scale: 0.5 }) as Record<string, unknown>;
    const sha = '1'.repeat(64);
    const relative = {
      ...base,
      tmpDir: 'tmp',
      outputPath: 'out/segment.mts',
      bundle: { ...(base['bundle'] as Record<string, unknown>), path: 'tmp/composition' },
      assets: [{ sha256: sha, path: 'store/photo.blob', role: 'image' }],
    };
    const file = path.join(root, 'request.json');
    writeFileSync(file, JSON.stringify(relative), 'utf8');

    // КОНТРОЛЬ: тот же относительный путь ОТ `cwd` не существует. Без него тест был бы зелен и
    // при резолве от рабочего каталога — то есть стерёг бы не то.
    expect(root).not.toBe(process.cwd());
    expect(existsSync(path.resolve(process.cwd(), 'store/photo.blob'))).toBe(false);

    const gatesDir = tempDir('rel-lib');
    const { code, out, seen } = await run(
      argvFor('still@1', 'draftHalf', file, gatesDir, path.join(root, 'runs')),
    );

    expect(code, out).toBe(EXIT.pass);
    expect(seen).not.toBeNull();
    const request = seen as unknown as SegmentRenderRequest;
    expect(request.assets[0]?.path).toBe(path.join(root, 'store', 'photo.blob'));
    expect(request.tmpDir).toBe(path.join(root, 'tmp'));
    expect(request.outputPath).toBe(path.join(root, 'out', 'segment.mts'));
    expect(request.bundle.path).toBe(path.join(root, 'tmp', 'composition'));
  });

  it('АБСОЛЮТНЫЕ пути проходят как прежде — правка ничего не переписывает', async () => {
    const root = tempDir('abs');
    const base = makeRequest(root, { scale: 0.5 }) as Record<string, unknown>;
    const file = path.join(root, 'request.json');
    writeFileSync(file, JSON.stringify(base), 'utf8');

    const gatesDir = tempDir('abs-lib');
    const { code, out, seen } = await run(
      argvFor('still@1', 'draftHalf', file, gatesDir, path.join(root, 'runs')),
    );

    expect(code, out).toBe(EXIT.pass);
    const request = seen as unknown as SegmentRenderRequest;
    expect(request.tmpDir).toBe(base['tmpDir']);
    expect(request.outputPath).toBe(base['outputPath']);
    expect(request.bundle.path).toBe((base['bundle'] as Record<string, unknown>)['path']);
  });
});

describe('`GATE-PREP` — тройка **K4** каждого файла равна yaml-профилю', () => {
  for (const { call, profileId, file } of PAIRS) {
    it(`\`${call}.${profileId}.json\` — три поля адаптера сходятся с \`${profileId}\``, () => {
      const { value } = readFamily(PROFILE_FILES[profileId], { expectFamily: 'render-profile' });
      const profile = RenderProfileSchema.parse(value);
      const request = JSON.parse(readFileSync(file, 'utf8')) as {
        pixelProfile: { browserGpu: boolean; scale: number; imageFormat: string };
      };
      // Ровно ТРИ поля: их и только их читает адаптер (**K4**), и по ним же команда сверяет
      // запрос с профилем. Четвёртое поле сверять было бы враньём — рендерер его не видит.
      expect({
        browserGpu: request.pixelProfile.browserGpu,
        scale: request.pixelProfile.scale,
        imageFormat: request.pixelProfile.imageFormat,
      }).toEqual({
        browserGpu: profile.pixelProfile.browserGpu,
        scale: profile.pixelProfile.scale,
        imageFormat: profile.pixelProfile.imageFormat,
      });
    });
  }
});

describe('`GATE-PREP` — команда принимает все восемь файлов и пишет запись по НАЗВАННОМУ', () => {
  for (const { call, profileId, file } of PAIRS) {
    it(`\`${call}\` · \`${profileId}\`: вход принят, EXIT=0, запись легла в tmp`, async () => {
      const gatesDir = tempDir('files-lib');
      const root = tempDir('files');
      const { code, out, err } = await run(
        argvFor(call, profileId, file, gatesDir, path.join(root, 'runs')),
        profileId,
      );

      expect(code, `${out}\n${err}`).toBe(EXIT.pass);
      // Запись пишется по НАЗВАННОМУ шаблону, а не по первому клипу: у `kenburns@1` файл
      // смешанный (`still@1` основанием, №181), и именно это здесь и проверяется.
      const written = path.join(gatesDir, `${call}.gates.json`);
      expect(existsSync(written), out).toBe(true);
      const parsed = GateFileSchema.parse(JSON.parse(readFileSync(written, 'utf8')));
      expect(parsed.entries[0]?.gate.profileId).toBe(profileId);
      // `bundleHash` записи — тот, что лежит в ФАЙЛЕ запроса: запись цитирует ту композицию,
      // на которой снята.
      const request = JSON.parse(readFileSync(file, 'utf8')) as { bundle: { hash: string } };
      expect(parsed.entries[0]?.bundleHash).toBe(request.bundle.hash);
    });
  }
});
