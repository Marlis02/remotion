// **`vpe store verify|fetch|push`** (`L-02`) — и охранник **P6** на клоне без стора.
//
// ═══ ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ ═══
// **P6** — «требует наличия ВСЕХ sha из `store.lock`». Строка реестра называет командой
// `vpe open --full` (`G-02`, её ещё нет), но правило — про `store.lock` и про полноту, а не
// про имя команды: первый исполнитель этого правила есть `vpe store verify`, и он обязан
// (а) отказывать, если не хватает хоть одного адреса, и (б) называть ТОЧНЫЙ список. Оба
// утверждения — тесты ниже, а не обещание.
//
// ПОЧЕМУ КЛОН, А НЕ ФИКСТУРА. `fixtures/minimal` не трогается ни символом (V9), а её
// `store.lock` пуст (`entries: []`) — на нём «клон без стора» был бы зелёным ни от чего.
// Поэтому проза и профили берутся у фикстуры КОПИЕЙ, а список записей пишется в копию
// настоящим писателем семейства (`upsertEntry` + `writeStoreLock`, `S-02`/`M-01`).
//
// БРАУЗЕР НЕ НУЖЕН НИ ОДНОМУ ТЕСТУ ФАЙЛА: команда `store` рендера не касается.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { readStoreLock, renderStoreLock, upsertEntry } from '@vpe/media';

import { EXIT, runCli, type CliDeps } from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Три блоба с РАЗНЫМ содержимым: список недостающих обязан быть списком, а не одной строкой. */
const BLOBS = ['первый оплаченный дубль', 'второй дубль', 'шрифт канала'].map((text) => {
  const bytes = Buffer.from(text, 'utf8');
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
});

interface Clone {
  /** Корень tmp: стор и вторая сторона переноса лежат ЗДЕСЬ, то есть ВНЕ дерева проекта (P8). */
  readonly root: string;
  readonly projectDir: string;
  readonly storeDir: string;
  readonly peerDir: string;
  readonly shas: readonly string[];
}

/** Кладёт байты в CAS по их СОБСТВЕННОМУ адресу — раскладка ADR-0005 §1. */
function put(storeDir: string, sha: string, bytes: Uint8Array): string {
  const file = path.join(storeDir, sha.slice(0, 2), sha.slice(2, 4), sha);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

/**
 * Клон фикстуры с НЕПУСТЫМ `store.lock`.
 *
 * `seeded: false` — тот самый «клон без стора»: дерево на месте, байтов нет ни одного.
 */
function makeClone(seeded: boolean): Clone {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-l02-'));
  roots.push(root);
  const projectDir = path.join(root, 'project');
  cpSync(FIXTURE, projectDir, { recursive: true });

  const lockPath = path.join(projectDir, 'store.lock');
  let lock = readStoreLock(lockPath);
  for (const [index, blob] of BLOBS.entries()) {
    lock = upsertEntry(lock, {
      sha256: blob.sha,
      size: blob.bytes.length,
      kind: index === 0 ? 'voice' : 'asset',
      origin: index === 0 ? 'tts:mock@1' : 'ingest:file',
      replicas: [],
    });
  }
  writeFileSync(lockPath, renderStoreLock(lock), 'utf8');

  const storeDir = path.join(root, 'store');
  mkdirSync(storeDir, { recursive: true });
  if (seeded) for (const blob of BLOBS) put(storeDir, blob.sha, blob.bytes);

  return {
    root,
    projectDir,
    storeDir,
    peerDir: path.join(root, 'peer'),
    shas: BLOBS.map((blob) => blob.sha).sort(),
  };
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(argv: readonly string[]): Promise<Run> {
  let out = '';
  let err = '';
  const deps: CliDeps = {
    now: () => '2026-08-30T09:41:07.512Z',
    clock: () => 0,
    randomBytes: (byteLength: number) => new Uint8Array(byteLength),
    stdin: () => '',
    env: {},
    out: (text) => (out += text),
    err: (text) => (err += text),
  };
  return { code: await runCli(argv, deps), out, err };
}

/** Строки перечня — те, что начинаются с двух пробелов: ровно их печатает команда списком. */
function listed(out: string): string[] {
  return out
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim().split(' ')[0] as string);
}

describe('`vpe store verify` — **P6**: клон без стора называет ТОЧНЫЙ список недостающих sha', () => {
  it('пустой стор ⇒ ненулевой код и перечень РАВЕН списку `store.lock`', async () => {
    const clone = makeClone(false);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
    ]);

    expect(result.code).toBe(EXIT.refusal);
    // РАВЕНСТВО, а не «содержит»: «точный список» означает и полноту, и отсутствие лишнего.
    expect(listed(result.out)).toEqual([...clone.shas]);
    expect(result.out).toContain('НЕТ В СТОРЕ (3)');
    // По списку человек запускает следующую команду — она названа в тексте.
    expect(result.out).toContain('vpe store fetch');
  });

  it('не хватает ОДНОГО ⇒ назван ровно он, а не весь список', async () => {
    const clone = makeClone(true);
    const victim = clone.shas[1] as string;
    rmSync(path.join(clone.storeDir, victim.slice(0, 2), victim.slice(2, 4), victim));

    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
    ]);
    expect(result.code).toBe(EXIT.refusal);
    expect(listed(result.out)).toEqual([victim]);
  });

  it('полный стор ⇒ код 0 и ни одной строки перечня', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
    ]);
    expect(result.code).toBe(EXIT.pass);
    expect(listed(result.out)).toEqual([]);
    expect(result.out).toContain('sha256 сверены');
  });
});

describe('`vpe store verify` перехэширует лежащее — долг №41 делом', () => {
  it('блоб испорчен ОДНИМ байтом ⇒ verify называет его sha и фактический хэш', async () => {
    const clone = makeClone(true);
    const victim = clone.shas[0] as string;
    const file = path.join(clone.storeDir, victim.slice(0, 2), victim.slice(2, 4), victim);
    const bytes = readFileSync(file);
    // Один байт: длина не меняется, `has` по-прежнему `true`, `read` по-прежнему отдаёт байты.
    bytes[0] = bytes[0] === 0 ? 1 : (bytes[0] as number) ^ 0x01;
    writeFileSync(file, bytes);

    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
    ]);
    expect(result.code).toBe(EXIT.refusal);
    expect(result.out).toContain('ИСПОРЧЕНЫ (1)');
    expect(listed(result.out)).toEqual([victim]);
    // Фактический sha печатается рядом: без него «испорчен» неотличимо от «подменён на другой».
    const actual = createHash('sha256').update(bytes).digest('hex');
    expect(result.out).toContain(`${victim} → ${actual}`);
    expect(actual).not.toBe(victim);
  });
});

describe('`vpe store verify --write-verified` — `lastVerifiedAt` (решение владельца, В2)', () => {
  it('без флага `store.lock` не меняется НИ БАЙТОМ', async () => {
    const clone = makeClone(true);
    const lockPath = path.join(clone.projectDir, 'store.lock');
    const before = readFileSync(lockPath, 'utf8');
    await run(['store', 'verify', '--project', clone.projectDir, '--store-dir', clone.storeDir]);
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
  });

  it('с флагом пишется момент формы `YYYY-MM-DDTHH:MM:SSZ` — доли секунды отсечены', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
      '--write-verified',
    ]);
    expect(result.code).toBe(EXIT.pass);
    // Часы деп отдают `…07.512Z`; форма семейства долей не знает.
    expect(readStoreLock(path.join(clone.projectDir, 'store.lock')).lastVerifiedAt).toBe(
      '2026-08-30T09:41:07Z',
    );
  });

  it('момент пишется ТОЛЬКО при чистой проверке: недостача ⇒ `lastVerifiedAt` остаётся `null`', async () => {
    const clone = makeClone(false);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
      '--write-verified',
    ]);
    expect(result.code).toBe(EXIT.refusal);
    expect(readStoreLock(path.join(clone.projectDir, 'store.lock')).lastVerifiedAt).toBeNull();
  });

  it('`--now` свободной формы ISO — отказ входа, а не молча обрезанное значение', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
      '--write-verified',
      '--now',
      '2026-08-30T12:41:07+03:00',
    ]);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('YYYY-MM-DDTHH:MM:SSZ');
  });
});

describe('`vpe store push|fetch` — перенос по `store.lock` между двумя ФС-сторами', () => {
  it('push кладёт все блобы во вторую сторону, и она проходит verify', async () => {
    const clone = makeClone(true);
    const pushed = await run([
      'store',
      'push',
      '--project',
      clone.projectDir,
      // `--store-dir` называется ЯВНО во всех тестах файла: без него стор берётся из
      // `project.yaml` (`~/.vpe/store`), и тест трогал бы настоящий стор машины.
      '--store-dir',
      clone.storeDir,
      '--to',
      clone.peerDir,
    ]);
    expect(pushed.code).toBe(EXIT.pass);
    expect(pushed.out).toContain('перенесено 3');

    // Проверка не на счётчике команды, а на самом сторе: verify против приёмника зелёный.
    const verified = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.peerDir,
    ]);
    expect(verified.code).toBe(EXIT.pass);
  });

  it('повторный push НЕ переносит ничего: `put` идемпотентен, чтение лишних байтов не делается', async () => {
    const clone = makeClone(true);
    const push = ['store', 'push', '--project', clone.projectDir, '--store-dir', clone.storeDir, '--to', clone.peerDir];
    await run(push);
    const again = await run(push);
    expect(again.code).toBe(EXIT.pass);
    expect(again.out).toContain('перенесено 0, уже лежало 3');
  });

  it('fetch наполняет пустой стор проекта из второй стороны', async () => {
    const donor = makeClone(true);
    await run(['store', 'push', '--project', donor.projectDir, '--store-dir', donor.storeDir, '--to', donor.peerDir]);

    const empty = makeClone(false);
    const fetched = await run([
      'store',
      'fetch',
      '--project',
      empty.projectDir,
      '--store-dir',
      empty.storeDir,
      '--from',
      donor.peerDir,
    ]);
    expect(fetched.code).toBe(EXIT.pass);
    expect(fetched.out).toContain('перенесено 3');
    expect(
      (
        await run([
          'store',
          'verify',
          '--project',
          empty.projectDir,
          '--store-dir',
          empty.storeDir,
        ])
      ).code,
    ).toBe(EXIT.pass);
  });

  it('недостача на источнике НЕ останавливает перенос: остаток назван, код ненулевой (В3)', async () => {
    const donor = makeClone(true);
    await run(['store', 'push', '--project', donor.projectDir, '--store-dir', donor.storeDir, '--to', donor.peerDir]);
    const absent = donor.shas[2] as string;
    rmSync(path.join(donor.peerDir, absent.slice(0, 2), absent.slice(2, 4), absent));

    const empty = makeClone(false);
    const fetched = await run([
      'store',
      'fetch',
      '--project',
      empty.projectDir,
      '--store-dir',
      empty.storeDir,
      '--from',
      donor.peerDir,
    ]);
    expect(fetched.code).toBe(EXIT.refusal);
    expect(fetched.out).toContain('перенесено 2');
    expect(fetched.out).toContain('НЕТ НА ИСТОЧНИКЕ (1)');
    expect(listed(fetched.out)).toEqual([absent]);

    // Доставлено ровно то, что было: два блоба лежат, третий — нет.
    const verified = await run([
      'store',
      'verify',
      '--project',
      empty.projectDir,
      '--store-dir',
      empty.storeDir,
    ]);
    expect(listed(verified.out)).toEqual([absent]);
  });

  it('источник и приёмник — один каталог: отказ входа, а не 3 «переноса» на месте', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'push',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
      '--to',
      clone.storeDir,
    ]);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('один каталог');
  });
});

describe('**P8** у команды: путь стора — не любая строка', () => {
  it('`--store-dir` ВНУТРИ дерева проекта отвергается — тем же резолвером, что и `project.yaml`', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'verify',
      '--project',
      clone.projectDir,
      '--store-dir',
      path.join(clone.projectDir, '.store'),
    ]);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('git clean -xdf');
  });

  it('`--to` внутри дерева проекта отвергается так же: стор есть стор', async () => {
    const clone = makeClone(true);
    const result = await run([
      'store',
      'push',
      '--project',
      clone.projectDir,
      '--store-dir',
      clone.storeDir,
      '--to',
      path.join(clone.projectDir, 'peer'),
    ]);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('git clean -xdf');
  });
});

describe('аргументы `vpe store`', () => {
  it('`store gc` — отказ, и текст говорит, что команды нет и не будет (**K10**)', async () => {
    const result = await run(['store', 'gc', '--project', '.']);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('LRU-GC');
    expect(result.err).toContain('K10');
  });

  it('`gc` не упоминается в `USAGE` ни одной буквой', async () => {
    const result = await run(['--help']);
    expect(result.err).toContain('vpe store verify');
    expect(result.err).not.toContain('store gc');
  });

  it('`fetch` без `--from` и `push` без `--to` — отказы входа', async () => {
    expect((await run(['store', 'fetch', '--project', '.'])).code).toBe(EXIT.input);
    expect((await run(['store', 'push', '--project', '.'])).code).toBe(EXIT.input);
  });

  it('`--from` у `push` — отказ: у каждой подкоманды своя сторона', async () => {
    const result = await run(['store', 'push', '--project', '.', '--to', '/tmp/a', '--from', '/tmp/b']);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('`--from` есть только у `store fetch`');
  });

  it('`--write-verified` у `fetch` — отказ: перенос ничего не проверяет', async () => {
    const result = await run([
      'store',
      'fetch',
      '--project',
      '.',
      '--from',
      '/tmp/a',
      '--write-verified',
    ]);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('перенос блобов ничего не проверяет');
  });

  it('`--project` обязателен', async () => {
    const result = await run(['store', 'verify']);
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('`--project` обязателен');
  });
});
