// Механизм кэша стадий (`M-05`): раскладка, манифест, попадание == промах, порча — громко.
//
// ADR-0006 §10 ДОСЛОВНО: «ПОПАДАНИЕ ОБЯЗАНО БЫТЬ РАВНО ПРОМАХУ». Проверяется побайтово, а не
// «длина совпала»: кэш существует затем, чтобы не считать заново, и единственная его
// обязанность — вернуть ровно то, что было бы посчитано.
//
// ЧЕГО ЗДЕСЬ НЕТ: тестов атомарности записи. Она исполняется тем же `writeAtomic` (**K7**),
// что и блобы CAS, и покрыта инъекцией обрыва в `store-cas.test.ts` (`M-01`) — второй копии
// того же теста заводить не за чем. Проверяется только следствие: осиротевших `tmp` в
// каталоге кэша после записи не остаётся.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CacheError,
  StageCache,
  cacheManifestPath,
  cacheNamespaceDir,
  cacheValuePath,
  composeKey,
  isProfileScoped,
  verifyComposition,
  type CacheAddress,
} from '../src/index.js';

import { makeTempDir, removeTempDir } from './assemble-helpers.js';
import { composeInputs } from './cache-helpers.js';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const BYTES = new TextEncoder().encode('значение стадии');

let dirs: string[] = [];
function tempRoot(): string {
  const dir = makeTempDir('m05-cache');
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs) removeTempDir(dir);
  dirs = [];
});

describe('раскладка: `.cache/<stage>/` и пространства имён по `profileId` (ADR-0005 §1, ADR-0006 §13)', () => {
  it('у `voice` и `compose` уровня профиля НЕТ — одно пространство имён', () => {
    const root = '/p';
    expect(cacheNamespaceDir(root, { stage: 'voice' })).toBe(path.join(root, '.cache', 'voice'));
    expect(cacheNamespaceDir(root, { stage: 'compose' })).toBe(path.join(root, '.cache', 'compose'));
    // Причина — в шапке `layout.ts`: в `voiceKey` и `composeKey` нет ни одного поля профиля
    // рендера, и `draft` с `final` слушают ОДИН оплаченный дубль. Разные пространства имён
    // значили бы платить за второй экземпляр того же звука.
  });

  it('у `segment` пространство именуется `profileId`: `draft` не вытесняет `final`', () => {
    const root = '/p';
    const draft = cacheNamespaceDir(root, { stage: 'segment', profileId: 'draftHalf' });
    const final = cacheNamespaceDir(root, { stage: 'segment', profileId: 'final' });
    expect(draft).not.toBe(final);
    expect(final).toBe(path.join(root, '.cache', 'segment', 'final'));
  });

  it('`profileId` у `voice` НЕВЫРАЗИМ типом, а не запрещён проверкой', () => {
    // @ts-expect-error — размеченное объединение: у стадии `voice` поля `profileId` нет.
    const bad: CacheAddress = { stage: 'voice', profileId: 'final' };
    expect(isProfileScoped(bad)).toBe(false);
  });

  it('`profileId`, способный вывести запись из своего пространства, отвергается', () => {
    for (const profileId of ['', '../final', `sub${path.sep}dir`]) {
      expect(() => cacheNamespaceDir('/p', { stage: 'segment', profileId })).toThrow(CacheError);
    }
  });

  it('ключ — имя файла с двухуровневым шардом, как в CAS', () => {
    const value = cacheValuePath('/p', { stage: 'voice' }, KEY);
    expect(value).toBe(path.join('/p', '.cache', 'voice', 'aa', 'aa', KEY));
    expect(cacheManifestPath('/p', { stage: 'voice' })).toBe(path.join('/p', '.cache', 'voice', 'manifest.json'));
  });

  it('ключ не blake3-в-hex отвергается: путь из произвольной строки адресует мимо', () => {
    for (const key of ['', 'AAAA', '../x', 'z'.repeat(64), 'a'.repeat(63)]) {
      expect(() => cacheValuePath('/p', { stage: 'voice' }, key), key).toThrow(CacheError);
    }
  });
});

describe('K3 — попадание равно промаху', () => {
  it('`get` возвращает ПОБАЙТОВО те же байты, что принял `put`', async () => {
    const root = tempRoot();
    const cache = new StageCache(root, { stage: 'compose' });
    expect(await cache.get(KEY)).toBeUndefined();
    await cache.put(KEY, BYTES);
    const got = await cache.get(KEY);
    expect(got).toBeDefined();
    expect([...(got as Uint8Array)]).toEqual([...BYTES]);
  });

  it('промах — `undefined`, а не ошибка: пустой кэш есть нормальная работа', async () => {
    const cache = new StageCache(tempRoot(), { stage: 'compose' });
    expect(await cache.get(OTHER_KEY)).toBeUndefined();
    expect(await cache.lookup(OTHER_KEY)).toBeUndefined();
  });

  it('пространства имён `segment` не видят записей друг друга', async () => {
    const root = tempRoot();
    const draft = new StageCache(root, { stage: 'segment', profileId: 'draftHalf' });
    const final = new StageCache(root, { stage: 'segment', profileId: 'final' });
    await draft.put(KEY, new TextEncoder().encode('черновой сегмент'));
    expect(await final.get(KEY)).toBeUndefined();
    expect(new TextDecoder().decode(await draft.get(KEY))).toBe('черновой сегмент');
  });
});

describe('манифест — состав ADR-0006 §8', () => {
  it('рядом с ключом лежат `sha256` и размер; `frameCount` — только когда он есть', async () => {
    const root = tempRoot();
    const cache = new StageCache(root, { stage: 'segment', profileId: 'final' });
    await cache.put(KEY, BYTES);
    await cache.put(OTHER_KEY, BYTES, { frameCount: 45 });

    const manifest = JSON.parse(readFileSync(cacheManifestPath(root, { stage: 'segment', profileId: 'final' }), 'utf8')) as {
      stage: string;
      entries: { key: string; sha256: string; size: number; frameCount?: number }[];
    };
    expect(manifest.stage).toBe('segment');
    expect(manifest.entries.map((entry) => entry.key)).toEqual([KEY, OTHER_KEY].sort());
    const first = manifest.entries.find((entry) => entry.key === KEY);
    expect(first?.size).toBe(BYTES.length);
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    // `frameCount: 0` означал бы «кадров ноль», то есть ложь: у записи `compose` и у записи
    // `voice` кадров нет вовсе, и пустое место честнее нуля.
    expect('frameCount' in (first ?? {})).toBe(false);
    expect(manifest.entries.find((entry) => entry.key === OTHER_KEY)?.frameCount).toBe(45);
  });

  it('манифест канонический и однострочный: ключи по байтам, записи по ключу', async () => {
    const root = tempRoot();
    const cache = new StageCache(root, { stage: 'compose' });
    await cache.put(OTHER_KEY, BYTES);
    await cache.put(KEY, BYTES);
    const text = readFileSync(cacheManifestPath(root, { stage: 'compose' }), 'utf8');
    expect(text.split('\n').filter((line) => line !== '')).toHaveLength(1);
    expect(text).not.toContain(': ');
    expect(text.indexOf(KEY)).toBeLessThan(text.indexOf(OTHER_KEY));
  });

  it('осиротевших `tmp` после записи не остаётся (**K7**, запись через `writeAtomic`)', async () => {
    const root = tempRoot();
    const cache = new StageCache(root, { stage: 'compose' });
    await cache.put(KEY, BYTES);
    const files = readdirSync(cacheNamespaceDir(root, { stage: 'compose' }), { recursive: true }) as string[];
    expect(files.filter((name) => String(name).includes('.tmp-'))).toEqual([]);
  });
});

describe('порча кэша — ОШИБКА, а не тихий пересчёт', () => {
  it('усечённое значение по валидному ключу роняет `get` с размерами', async () => {
    const root = tempRoot();
    const address: CacheAddress = { stage: 'compose' };
    const cache = new StageCache(root, address);
    await cache.put(KEY, BYTES);
    writeFileSync(cacheValuePath(root, address, KEY), BYTES.slice(0, 3));
    await expect(cache.get(KEY)).rejects.toThrow(/манифест обещает/u);
  });

  it('подменённые байты той же длины ловятся sha256 — у `voice` ВСЕГДА', async () => {
    const root = tempRoot();
    const address: CacheAddress = { stage: 'voice' };
    const cache = new StageCache(root, address);
    await cache.put(KEY, BYTES);
    // Та же длина, другое содержимое: размер молчит, sha256 — нет. ADR-0006 §8: «для
    // `voice/` sha256 обязателен всегда: пути восстановления нет».
    const tampered = new Uint8Array(BYTES);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    writeFileSync(cacheValuePath(root, address, KEY), tampered);
    await expect(cache.get(KEY)).rejects.toThrow(/не равен записанному/u);
  });

  it('на дешёвых стадиях sha256 проверяется под флагом `--verify-cache`', async () => {
    const root = tempRoot();
    const address: CacheAddress = { stage: 'segment', profileId: 'final' };
    await new StageCache(root, address).put(KEY, BYTES);
    const tampered = new Uint8Array(BYTES);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    writeFileSync(cacheValuePath(root, address, KEY), tampered);

    // Без флага — размер сошёлся, байты отданы: это ЦЕНА, названная в ADR-0006 §8 («sha256 —
    // под `--verify-cache` и всегда в ночном прогоне»), а не недосмотр.
    expect(await new StageCache(root, address).get(KEY)).toBeDefined();
    await expect(new StageCache(root, address, { verify: true }).get(KEY)).rejects.toThrow(CacheError);
  });

  it('исчезнувшие байты — ПРОМАХ: кэш инвалидируется по определению', async () => {
    const root = tempRoot();
    const address: CacheAddress = { stage: 'compose' };
    const cache = new StageCache(root, address);
    await cache.put(KEY, BYTES);
    mkdirSync(path.dirname(cacheValuePath(root, address, OTHER_KEY)), { recursive: true });
    writeFileSync(cacheManifestPath(root, address), JSON.stringify({ stage: 'compose', entries: [{ key: OTHER_KEY, sha256: 'x'.repeat(64), size: 1 }] }));
    expect(await cache.get(OTHER_KEY)).toBeUndefined();
  });

  it('испорченный манифест — ошибка, а не «кэш пуст»', async () => {
    const root = tempRoot();
    const address: CacheAddress = { stage: 'compose' };
    mkdirSync(cacheNamespaceDir(root, address), { recursive: true });
    writeFileSync(cacheManifestPath(root, address), '{"stage":"compose"}');
    await expect(new StageCache(root, address).lookup(KEY)).rejects.toThrow(/ИСПОРЧЕННЫЙ/u);
  });

  it('второй `put` тем же ключом с другими байтами — договорная ошибка', async () => {
    const root = tempRoot();
    const cache = new StageCache(root, { stage: 'compose' });
    await cache.put(KEY, BYTES);
    await cache.put(KEY, BYTES); // тот же вход — тишина, запись идемпотентна
    await expect(cache.put(KEY, new TextEncoder().encode('другое'))).rejects.toThrow(/вход неполон/u);
  });
});

describe('сверка `composeKey` ↔ `compositionHash` (ADR-0006 §2)', () => {
  const key = composeKey(composeInputs());

  it('совпадение — тишина: охранник, печатающий на успехе, становится шумом', () => {
    expect(verifyComposition(key, 'hash-1', 'hash-1')).toBeUndefined();
  });

  it('расхождение — ошибка, несущая ОБЕ величины и ключ', () => {
    let caught: unknown;
    try {
      verifyComposition(key, 'hash-записан', 'hash-получен');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CacheError);
    const message = (caught as Error).message;
    expect(message).toContain('hash-записан');
    expect(message).toContain('hash-получен');
    expect(message).toContain(String(key));
    // Отладка обязана начинаться с этих трёх величин, а не с повторного прогона.
  });
});
