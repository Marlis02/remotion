// `M-01` — CAS и **K7** (запись в CAS атомарна: `tmp + fsync + rename`).
//
// КАК ЗДЕСЬ ЛОМАЕТСЯ ЗАПИСЬ. Инъекцией сбоя в `node:fs/promises`, а не `kill` процесса:
// убитый vitest не оставил бы ни утверждений, ни отчёта. Наблюдаемое состояние диска при
// этом ровно то же, что после настоящего обрыва, и проверяется именно оно — что лежит (и
// чего не лежит) по адресу sha256.
//
// ДВА РАЗНЫХ СБОЯ, И ЭТО СУЩЕСТВЕННО:
//   * «штатный обрыв» — `rename` бросает, обработчик ошибки в `atomic.ts` убирает tmp;
//   * «процесс умер» — не отрабатывает и уборка. Диск остаётся с сиротским tmp, и вопрос к
//     K7 звучит строже: видит ли этого сироту `has`/`read`/`missing`.
//
// ВСЁ ПИШЕТСЯ В `os.tmpdir()` и убирается в `afterEach`. Настоящего `~/.vpe` тесты `media`
// не касаются ни одним вызовом — они физически не знают, где он: `homedir` в этом пакете
// является входом, а не вызовом (см. `store-layout.test.ts`).

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asSha256, type Sha256 } from '@vpe/schema';

import { LocalStore, MissingBlobsError, blobPath, shardDir } from '../src/index.js';

/** Флаги инъекции. `vi.hoisted`, потому что фабрика `vi.mock` поднимается выше импортов. */
const failure = vi.hoisted(() => ({ rename: false, whileWriting: false, sync: false, silentUnlink: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (target: string, flags: string): Promise<FileHandle> => {
      const handle = await actual.open(target, flags);
      return {
        writeFile: async (data: Uint8Array): Promise<void> => {
          if (failure.whileWriting) {
            // Половина байтов уже на диске — самый неприятный из возможных обрывов.
            await handle.write(data.subarray(0, Math.floor(data.length / 2)));
            throw Object.assign(new Error('инъекция: обрыв ПОСРЕДИ записи tmp'), { code: 'EIO' });
          }
          await handle.writeFile(data);
        },
        sync: async (): Promise<void> => {
          if (failure.sync) throw Object.assign(new Error('инъекция: fsync не прошёл'), { code: 'EIO' });
          await handle.sync();
        },
        close: async (): Promise<void> => handle.close(),
      } as unknown as FileHandle;
    },
    rename: async (from: string, to: string): Promise<void> => {
      if (failure.rename) throw Object.assign(new Error('инъекция: обрыв МЕЖДУ записью tmp и rename'), { code: 'EIO' });
      await actual.rename(from, to);
    },
    unlink: async (target: string): Promise<void> => {
      // «Процесс умер»: уборка tmp не отрабатывает, как и не отработала бы после `kill`.
      if (failure.silentUnlink) return;
      await actual.unlink(target);
    },
  };
});

/** sha256 эталоном: значения известны снаружи репозитория, а не посчитаны проверяемым кодом. */
const EMPTY_SHA = asSha256('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
const HELLO_SHA = asSha256('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

const HELLO = new TextEncoder().encode('hello');
const BIG = new TextEncoder().encode('x'.repeat(4096));

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'vpe-m01-cas-'));
  failure.rename = false;
  failure.whileWriting = false;
  failure.sync = false;
  failure.silentUnlink = false;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const store = (): LocalStore => new LocalStore(root);

/** Всё, что реально лежит в каталоге шарда: и блоб, и любой tmp-мусор. */
function shardContents(sha: Sha256): string[] {
  const dir = shardDir(root, sha);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── 1. CAS: адрес — это содержимое ─────────────────────────────────────────────────────────

describe('`M-01` — `put` адресует по содержимому, а не «кладёт куда сказали»', () => {
  it('возвращает sha256 содержимого — сверено с эталоном, а не с самим собой', () => {
    expect(digestOf(HELLO)).toBe(HELLO_SHA);
  });

  it('кладёт байты по адресу `ab/cd/<sha256>` и читает их обратно', async () => {
    const sha = await store().put(HELLO, 'voice');
    expect(sha).toBe(HELLO_SHA);
    expect(blobPath(root, sha)).toBe(path.join(root, '2c', 'f2', HELLO_SHA));
    expect(readFileSync(blobPath(root, sha))).toStrictEqual(Buffer.from(HELLO));
    expect(new TextDecoder().decode(await store().read(sha))).toBe('hello');
  });

  it('пустые байты — законный блоб со своим адресом', async () => {
    const sha = await store().put(new Uint8Array(0), 'asset');
    expect(sha).toBe(EMPTY_SHA);
    expect(await store().has(sha)).toBe(true);
    expect(statSync(blobPath(root, sha)).size).toBe(0);
  });

  it('повторный `put` тех же байтов не трогает существующий блоб', async () => {
    const sha = await store().put(BIG, 'voice');
    const before = statSync(blobPath(root, sha));

    // Часовой: если бы `put` переписывал блоб, эта подмена содержимого была бы затёрта —
    // а вместе с ней был бы затёрт и настоящий, уже оплаченный блоб.
    writeFileSync(blobPath(root, sha), 'ЧАСОВОЙ', 'utf8');
    const again = await store().put(BIG, 'voice');

    expect(again).toBe(sha);
    expect(readFileSync(blobPath(root, sha), 'utf8')).toBe('ЧАСОВОЙ');
    expect(statSync(blobPath(root, sha)).ino).toBe(before.ino);
    expect(shardContents(sha)).toEqual([sha]);
  });

  it('вид блоба вне перечня `store-lock/1` отвергается на границе `put`', async () => {
    // @ts-expect-error — ровно тот случай, ради которого проверка есть: вид пришёл из данных.
    await expect(store().put(HELLO, 'voise')).rejects.toThrow(/не из перечня ADR-0005/);
    expect(shardContents(HELLO_SHA)).toEqual([]);
  });
});

// ── 2. K7: обрыв записи не оставляет частичного блоба ──────────────────────────────────────

describe('**K7** — запись в CAS атомарна', () => {
  it('обрыв МЕЖДУ записью tmp и `rename`: по адресу sha ничего нет', async () => {
    failure.rename = true;
    await expect(store().put(BIG, 'voice')).rejects.toThrow(/обрыв МЕЖДУ записью tmp и rename/);

    expect(existsSync(blobPath(root, digestSha(BIG)))).toBe(false);
    expect(await store().has(digestSha(BIG))).toBe(false);
    expect(shardContents(digestSha(BIG))).toEqual([]); // tmp убран обработчиком ошибки
  });

  it('обрыв ПОСРЕДИ записи: половина байтов остаётся в tmp, а не по адресу sha', async () => {
    failure.whileWriting = true;
    failure.silentUnlink = true; // процесс «умер», уборка не отработала
    const sha = digestSha(BIG);

    await expect(store().put(BIG, 'voice')).rejects.toThrow(/обрыв ПОСРЕДИ записи/);

    const left = shardContents(sha);
    expect(left).toHaveLength(1);
    expect(left[0]).not.toBe(sha); // ← ядро K7: половина блоба лежит НЕ по адресу sha
    expect(left[0]).toMatch(/\.tmp-/);
    expect(statSync(path.join(shardDir(root, sha), left[0] ?? '')).size).toBe(BIG.length / 2);
    expect(await store().has(sha)).toBe(false);
  });

  it('сбой `fsync` — тоже отказ: блоб не появляется', async () => {
    failure.sync = true;
    await expect(store().put(HELLO, 'voice')).rejects.toThrow(/fsync не прошёл/);
    expect(await store().has(HELLO_SHA)).toBe(false);
  });

  it('осиротевший tmp НЕВИДИМ через `has`/`read`/`missing`', async () => {
    failure.whileWriting = true;
    failure.silentUnlink = true;
    await expect(store().put(BIG, 'voice')).rejects.toThrow();
    const sha = digestSha(BIG);

    expect(await store().has(sha)).toBe(false);
    await expect(store().read(sha)).rejects.toBeInstanceOf(MissingBlobsError);
    expect(await store().missing([sha])).toEqual([sha]);
  });

  it('повторный `put` лечит: по адресу sha — ПОЛНЫЕ байты, а не половина', async () => {
    failure.whileWriting = true;
    await expect(store().put(BIG, 'voice')).rejects.toThrow();

    failure.whileWriting = false;
    const sha = await store().put(BIG, 'voice');

    expect(sha).toBe(digestSha(BIG));
    expect(readFileSync(blobPath(root, sha)).length).toBe(BIG.length);
    expect(digestOf(readFileSync(blobPath(root, sha)))).toBe(sha);
    expect(shardContents(sha)).toEqual([sha]); // следов первой попытки не осталось
  });

  it('имя tmp никогда не равно имени блоба — иначе запись шла бы «на месте»', async () => {
    failure.rename = true;
    failure.silentUnlink = true;
    const sha = digestSha(HELLO);
    await expect(store().put(HELLO, 'voice')).rejects.toThrow();

    const left = shardContents(sha);
    expect(left).toHaveLength(1);
    expect(left).not.toContain(sha);
  });
});

/** sha256 эталоном для произвольных байтов теста (эталон — `node:crypto`, не наш `put`). */
function digestSha(bytes: Uint8Array): Sha256 {
  return asSha256(digestOf(bytes));
}
