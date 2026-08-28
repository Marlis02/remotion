// **`vpe template gate` БЕЗ БРАУЗЕРА** — отказы, запись, коды выхода.
//
// Гейт здесь ПОДМЕНЁН (`deps.gate`): проверяется команда, а не `runGate` — его собственная
// матрица живёт в `renderer-hyperframes/test/gate.test.ts` (`H-04`). Живой прогон команды —
// отдельный файл `template-gate-render.test.ts`, и он требует браузера.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GateOutcome } from '@vpe/renderer-hyperframes';
import {
  GATES_FILE_SCHEMA,
  GateFileSchema,
  TEMPLATE_LIBRARY,
  makeGateFile,
  still1,
  type GateRecord,
} from '@vpe/templates-spec';

import { EXIT, runCli, type CliDeps } from '../src/index.js';
import { tempDir, writeRenderProfile, writeRequest } from './fixture.js';

const FP = 'c'.repeat(64);
const BUNDLE_OF_REQUEST = '0'.repeat(64);

const record = (patch: Partial<GateRecord> = {}): GateRecord => ({
  profileId: 'draftHalf',
  N: 3,
  sha256: 'a'.repeat(64),
  framemd5: 'b'.repeat(64),
  date: '2026-08-29T00:00:00Z',
  engineFingerprint: FP,
  class: 'PASS',
  ...patch,
});

/** Исход гейта, поданный вместо прогонов. `runs: []` — таблицу печатать не из чего. */
const outcome = (patch: Partial<GateOutcome> = {}): GateOutcome =>
  ({
    class: 'PASS',
    profileId: 'draftHalf',
    N: 3,
    record: record(),
    runs: [],
    ...patch,
  }) as GateOutcome;

interface Captured {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Прогон команды с фальшивыми часами и подменённым гейтом; вывод собирается строками. */
async function run(argv: readonly string[], gate?: () => Promise<GateOutcome>): Promise<Captured> {
  let out = '';
  let err = '';
  const deps: CliDeps = {
    now: () => '2026-08-29T00:00:00Z',
    clock: () => 0,
    out: (text) => (out += text),
    err: (text) => (err += text),
    ...(gate === undefined ? {} : { gate }),
  };
  const code = await runCli(argv, deps);
  return { code, out, err };
}

/** Полная командная строка гейта на `still@1` в своём tmp. */
function scene(options: { gatesDir?: string; second?: string; profileId?: string; scale?: number } = {}): {
  argv: string[];
  gatesDir: string;
  root: string;
} {
  const root = tempDir('gate');
  const gatesDir = options.gatesDir ?? tempDir('lib');
  const request = writeRequest(root, options.second === undefined ? {} : { second: options.second });
  const profile = writeRenderProfile(
    root,
    options.profileId === undefined && options.scale === undefined
      ? {}
      : {
          ...(options.profileId === undefined ? {} : { profileId: options.profileId }),
          ...(options.scale === undefined ? {} : { scale: options.scale }),
        },
  );
  return {
    root,
    gatesDir,
    argv: [
      'template',
      'gate',
      'still@1',
      '--profile',
      'draftHalf',
      '--request',
      request,
      '--render-profile',
      profile,
      '--gates-dir',
      gatesDir,
      '--run-root',
      root,
    ],
  };
}

describe('`vpe template gate` — отказы до единого прогона', () => {
  it('шаблона нет в библиотеке — отказ со списком того, что есть', async () => {
    const { argv, gatesDir } = scene();
    const bad = argv.map((arg) => (arg === 'still@1' ? 'solid@1' : arg));
    const result = await run(bad, () => {
      throw new Error('гейт не должен был запуститься');
    });
    expect(result.code).toBe(EXIT.refusal);
    expect(result.err).toMatch(/шаблона `solid@1` нет в библиотеке/u);
    expect(result.err).toContain('kenburns@1');
    expect(existsSync(path.join(gatesDir, 'solid@1.gates.json'))).toBe(false);
  });

  it('**запрос зовёт ЧУЖОЙ шаблон — отказ** (охранник фикстуры, развилка 1)', async () => {
    const { argv } = scene({ second: 'flash@1' });
    const result = await run(argv, () => {
      throw new Error('гейт не должен был запуститься');
    });
    expect(result.code).toBe(EXIT.refusal);
    expect(result.err).toMatch(/запрос зовёт 1 чужой\(-их\) шаблон\(ов\): flash@1/u);
    expect(result.err).toMatch(/цитировала бы измерение чужой/u);
  });

  it('`profileId` файла профиля разошёлся с `--profile` — отказ: пара названа дважды', async () => {
    const { argv } = scene({ profileId: 'final' });
    const result = await run(argv, () => {
      throw new Error('гейт не должен был запуститься');
    });
    expect(result.code).toBe(EXIT.refusal);
    expect(result.err).toMatch(/объявляет `profileId: final`/u);
  });

  it('профиль и запрос расходятся по `scale` — отказ: пара, которой не существует', async () => {
    const { argv } = scene({ scale: 1 });
    const result = await run(argv, () => {
      throw new Error('гейт не должен был запуститься');
    });
    expect(result.code).toBe(EXIT.refusal);
    expect(result.err).toMatch(/scale: запрос `0\.25`, профиль `1`/u);
  });

  it('файла запроса нет — код 2, и путь назван', async () => {
    const { argv } = scene();
    const bad = argv.map((arg) => (arg.endsWith('request.json') ? '/nope/request.json' : arg));
    const result = await run(bad);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('/nope/request.json');
  });

  it('файл запроса — не JSON: код 2, отказ называет файл', async () => {
    const { argv, root } = scene();
    const broken = path.join(root, 'broken.json');
    writeFileSync(broken, '{ это не json', 'utf8');
    const result = await run(argv.map((arg) => (arg.endsWith('request.json') ? broken : arg)));
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toMatch(/не разбирается как JSON/u);
  });

  it('**файл записей БЕЗ спека — отказ команды** (П1: полный путь и пара в тексте)', async () => {
    const { argv, gatesDir } = scene();
    const orphan = path.join(gatesDir, 'shaderBg@1.gates.json');
    writeFileSync(
      orphan,
      JSON.stringify(
        makeGateFile({ namespace: null, templateId: 'shaderBg', templateVersion: 1 }, [
          { gate: record(), bundleHash: BUNDLE_OF_REQUEST },
        ]),
      ),
      'utf8',
    );
    const result = await run(argv, () => {
      throw new Error('гейт не должен был запуститься');
    });
    expect(result.code).toBe(EXIT.refusal);
    expect(result.err).toContain(orphan);
    expect(result.err).toContain('id `shaderBg`');
    expect(result.err).toMatch(/отказ, а не пропуск/u);
  });
});

describe('`vpe template gate` — запись создаёт ТОЛЬКО PASS', () => {
  it('PASS: файл записей создан рядом со спеком, путь напечатан (П3), код 0', async () => {
    const { argv, gatesDir } = scene();
    const result = await run(argv, () => Promise.resolve(outcome()));
    expect(result.code).toBe(EXIT.pass);

    const file = path.join(gatesDir, 'still@1.gates.json');
    expect(existsSync(file)).toBe(true);
    // Путь напечатан ЦЕЛИКОМ: автору нужно знать, что коммитить руками.
    expect(result.out).toContain(file);
    expect(result.out).toMatch(/КОММИТИТ АВТОР РУКАМИ/u);

    const parsed = GateFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    expect(parsed.success, readFileSync(file, 'utf8')).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.schema).toBe(GATES_FILE_SCHEMA);
    expect(parsed.data.templateId).toBe('still');
    expect(parsed.data.entries).toHaveLength(1);
    expect(parsed.data.entries[0]?.gate).toEqual(record());
    // `bundleHash` — из ЗАПРОСА, а не выдуман: запись цитирует композицию, на которой снята.
    expect(parsed.data.entries[0]?.bundleHash).toBe(BUNDLE_OF_REQUEST);
  });

  it('записанный файл ЧИТАЕТСЯ обратно каталогом: `still@1` перестаёт быть `UNGATED`', async () => {
    const { argv, gatesDir } = scene();
    await run(argv, () => Promise.resolve(outcome()));

    const listed = await run(['template', 'list', '--gates-dir', gatesDir]);
    expect(listed.code).toBe(EXIT.pass);
    expect(listed.out).toMatch(/still@1\s+\|\s+1\s+\|\s+draftHalf:PASS/u);
    expect(listed.out).toMatch(/записей гейта: 1 из 5 шаблонов/u);
  });

  it('**FAIL записи НЕ создаёт**, код 4, и «не создана» напечатано словами', async () => {
    const { argv, gatesDir } = scene();
    const result = await run(argv, () =>
      Promise.resolve(
        outcome({ class: 'FAIL', why: 'разошёлся framemd5 на прогоне 3', where: null } as unknown as GateOutcome),
      ),
    );
    expect(result.code).toBe(EXIT.fail);
    expect(existsSync(path.join(gatesDir, 'still@1.gates.json'))).toBe(false);
    expect(result.out).toMatch(/запись НЕ создана \(класс `FAIL`\)/u);
    expect(result.out).toMatch(/Charter V13/u);
  });

  it('**FLAKY записи НЕ создаёт** (решение владельца, развилка 2), код 3', async () => {
    const { argv, gatesDir } = scene();
    const result = await run(argv, () =>
      Promise.resolve(
        outcome({
          class: 'FLAKY-по-контейнеру',
          diagnosis: 'sha256 разошёлся, framemd5 — нет',
        } as unknown as GateOutcome),
      ),
    );
    expect(result.code).toBe(EXIT.flaky);
    expect(existsSync(path.join(gatesDir, 'still@1.gates.json'))).toBe(false);
    expect(result.out).toMatch(/нормализация применена и гейт ПЕРЕСНЯТ/u);
  });

  it('`error` записи НЕ создаёт, код 5: гейта не было — записывать нечего', async () => {
    const { argv, gatesDir } = scene();
    const result = await run(argv, () =>
      Promise.resolve(
        outcome({ class: 'error', N: null, why: 'браузера нет', runs: [] } as unknown as GateOutcome),
      ),
    );
    expect(result.code).toBe(EXIT.error);
    expect(existsSync(path.join(gatesDir, 'still@1.gates.json'))).toBe(false);
    expect(result.out).toMatch(/прогонов гейта не было/u);
  });

  it('пересъёмка ЗАМЕЩАЕТ запись профиля и называет, чем прежняя устарела', async () => {
    const { argv, gatesDir } = scene();
    // Прежняя запись: тот же профиль, ЧУЖОЙ отпечаток — то есть устаревшая.
    writeFileSync(
      path.join(gatesDir, 'still@1.gates.json'),
      JSON.stringify(
        makeGateFile({ namespace: null, templateId: 'still', templateVersion: 1 }, [
          { gate: record({ engineFingerprint: 'f'.repeat(64), date: '2026-01-01T00:00:00Z' }), bundleHash: 'e'.repeat(64) },
          { gate: record({ profileId: 'final', N: 10 }), bundleHash: 'e'.repeat(64) },
        ]),
      ),
      'utf8',
    );

    const result = await run(argv, () => Promise.resolve(outcome()));
    expect(result.code).toBe(EXIT.pass);
    expect(result.out).toMatch(/прежняя запись профиля `draftHalf` \(2026-01-01T00:00:00Z\) устарела/u);
    expect(result.out).toMatch(/другом окружении/u);

    const after = GateFileSchema.parse(
      JSON.parse(readFileSync(path.join(gatesDir, 'still@1.gates.json'), 'utf8')),
    );
    // Записей по-прежнему две: свежая `draftHalf` заместила прежнюю, `final` не тронут.
    expect(after.entries).toHaveLength(2);
    expect(after.entries.map((entry) => entry.gate.profileId)).toEqual(['final', 'draftHalf']);
    expect(after.entries.find((entry) => entry.gate.profileId === 'draftHalf')?.gate.engineFingerprint).toBe(FP);
    expect(after.entries.find((entry) => entry.gate.profileId === 'final')?.bundleHash).toBe('e'.repeat(64));
  });

  it('прежняя запись была ДЕЙСТВУЮЩЕЙ — команда говорит и это, а не молчит', async () => {
    const { argv, gatesDir } = scene();
    writeFileSync(
      path.join(gatesDir, 'still@1.gates.json'),
      JSON.stringify(
        makeGateFile({ namespace: null, templateId: 'still', templateVersion: 1 }, [
          { gate: record({ date: '2026-08-01T00:00:00Z' }), bundleHash: BUNDLE_OF_REQUEST },
        ]),
      ),
      'utf8',
    );
    const result = await run(argv, () => Promise.resolve(outcome()));
    expect(result.out).toMatch(/была ДЕЙСТВУЮЩЕЙ \(2026-08-01T00:00:00Z\)/u);
  });
});

describe('`vpe template list` — таблица каталога', () => {
  it('шесть колонок, пять шаблонов, `UNGATED` названо словами', async () => {
    const result = await run(['template', 'list', '--gates-dir', tempDir('empty')]);
    expect(result.code).toBe(EXIT.pass);
    expect(result.out).toMatch(/шаблон\s+\|\s+версия\s+\|\s+гейт\s+\|\s+бюджет мс\/кадр\s+\|\s+класс детерминизма\s+\|\s+easing/u);
    for (const spec of TEMPLATE_LIBRARY) expect(result.out).toContain(`${spec.templateId}@1`);
    expect(result.out).toMatch(/`UNGATED` — «проверки НЕ выполнялись», а не «чисто»/u);
    // Бюджет — из манифеста, а не выдуман таблицей.
    expect(result.out).toContain(String(still1.manifest.msPerFrameBudget));
  });
});
