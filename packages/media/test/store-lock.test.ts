// `M-01` — `store.lock`: читается и пишется читателем и писателем семейств (`S-02`).
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Ни одного `parseYaml`: второй разборщик того же файла разошёлся
// бы с первым при первой правке формы, а форма `store-lock/1` уже пережила одну ревизию —
// эту. Ни одного обращения к часам: момент проверки приходит ВХОДОМ (`withLastVerifiedAt`),
// значение пишет `vpe store verify`, то есть `L-02`.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { FamilyReadError, type StoreLock } from '@vpe/schema';

import {
  readStoreLock,
  renderStoreLock,
  upsertEntry,
  withLastVerifiedAt,
  writeStoreLock,
  type StoreLockEntry,
} from '../src/index.js';

/** Инъекция сбоя для проверки атомарности записи файла — та же схема, что в `store-cas`. */
const failure = vi.hoisted(() => ({ rename: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (failure.rename) throw Object.assign(new Error('инъекция: обрыв перед rename'), { code: 'EIO' });
      await actual.rename(from, to);
    },
  };
});

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

const TMP = mkdtempSync(path.join(tmpdir(), 'vpe-m01-lock-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const sha = (hex: string): string => hex.repeat(64).slice(0, 64);

const entry = (first: string, patch: Partial<StoreLockEntry> = {}): StoreLockEntry => ({
  sha256: sha(first),
  size: 1024,
  kind: 'voice',
  origin: 'tts:mock@1',
  replicas: ['local-dir'],
  ...patch,
});

const EMPTY: StoreLock = { schema: 'store-lock/1', lastVerifiedAt: null, entries: [] };

describe('`store.lock` фикстуры читается штатным читателем', () => {
  it('пустой lock: `verify` не выполнялся, обязательных байтов нет', () => {
    const lock = readStoreLock(path.join(FIXTURE, 'store.lock'));
    expect(lock.schema).toBe('store-lock/1');
    expect(lock.lastVerifiedAt).toBeNull();
    expect(lock.entries).toEqual([]);
  });

  it('файл чужого семейства даёт ОДНУ строку про семейство, а не стену полей', () => {
    let caught: unknown;
    try {
      readStoreLock(path.join(FIXTURE, 'project.yaml'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FamilyReadError);
    expect((caught as Error).message).toMatch(/ожидалось семейство `store-lock\/1`/);
    expect((caught as Error).message.split('\n')).toHaveLength(1);
  });
});

describe('`upsertEntry` держит канонический порядок и уникальность', () => {
  it('вставка в середину: порядок — hex sha256 по возрастанию', () => {
    let lock = EMPTY;
    for (const first of ['f', '1', 'a']) lock = upsertEntry(lock, entry(first));
    expect(lock.entries.map((item) => item.sha256)).toEqual([sha('1'), sha('a'), sha('f')]);
  });

  it('повторная запись того же sha ЗАМЕНЯЕТ, а не удваивает', () => {
    const lock = upsertEntry(upsertEntry(EMPTY, entry('1')), entry('1', { replicas: ['local-dir', 'rclone:backup'] }));
    expect(lock.entries).toHaveLength(1);
    expect(lock.entries[0]?.replicas).toEqual(['local-dir', 'rclone:backup']);
  });

  it('исходное значение не мутируется — функция чистая', () => {
    const before = upsertEntry(EMPTY, entry('1'));
    const after = upsertEntry(before, entry('a'));
    expect(before.entries).toHaveLength(1);
    expect(after.entries).toHaveLength(2);
  });

  it('запись, не проходящую форму, отвергает сама операция, а не запись файла', () => {
    expect(() => upsertEntry(EMPTY, entry('1', { size: -1 }))).toThrow();
    // @ts-expect-error — вид не из перечня `store-lock/1`.
    expect(() => upsertEntry(EMPTY, entry('1', { kind: 'voise' }))).toThrow();
  });

  it('`replicas: []` проходит: P7 проверяет `verify`, а не форма файла', () => {
    expect(() => upsertEntry(EMPTY, entry('1', { kind: 'voice', replicas: [] }))).not.toThrow();
  });
});

describe('`withLastVerifiedAt` — время приходит входом', () => {
  it('момент UTC в единственной форме принимается', () => {
    expect(withLastVerifiedAt(EMPTY, '2026-08-23T10:00:00Z').lastVerifiedAt).toBe('2026-08-23T10:00:00Z');
  });

  it('`null` — законное «verify не выполнялся»', () => {
    expect(withLastVerifiedAt(EMPTY, null).lastVerifiedAt).toBeNull();
  });

  it('другая форма записи момента отвергается здесь, а не при записи файла', () => {
    expect(() => withLastVerifiedAt(EMPTY, '2026-08-23T13:00:00+03:00')).toThrow(/YYYY-MM-DDTHH:MM:SSZ/);
    expect(() => withLastVerifiedAt(EMPTY, '2026-08-23')).toThrow();
  });
});

describe('запись файла — канонической формой и атомарно', () => {
  it('круг «записать → прочитать» не теряет ничего и не оставляет следов записи', async () => {
    const dir = path.join(TMP, 'проект');
    const file = path.join(dir, 'store.lock');
    const lock = withLastVerifiedAt(
      upsertEntry(upsertEntry(EMPTY, entry('a', { kind: 'snapshot' })), entry('1')),
      '2026-08-23T10:00:00Z',
    );

    await writeStoreLock(file, lock);

    expect(readStoreLock(file)).toEqual(lock);
    expect(readdirSync(dir)).toEqual(['store.lock']); // ни одного `.tmp-…`
    expect(readFileSync(file, 'utf8')).toBe(renderStoreLock(lock));
  });

  it('текст — тот же, что дал бы `renderFamily`: шапка, порядок ключей из схемы, кавычки', () => {
    const text = renderStoreLock(upsertEntry(EMPTY, entry('1')));
    expect(text.split('\n')[0]).toBe('schema: store-lock/1');
    expect(text).toContain('lastVerifiedAt: null');
    expect(text).toContain(`sha256: "${sha('1')}"`);
    expect(text).toContain('kind: "voice"');
    expect(text).toContain('size: 1024');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('обрыв записи НЕ портит уже лежащий `store.lock`: старое содержимое цело', async () => {
    // Единственная копия списка «что обязано лежать в сторе» лежит в git. Оборванная
    // запись поверх неё оставила бы полуфайл, который читатель отвергнет целиком, — и
    // проект перестал бы открываться. Поэтому lock пишется тем же `tmp + rename`, что блоб.
    const file = path.join(TMP, 'обрыв.lock');
    const before = upsertEntry(EMPTY, entry('1'));
    await writeStoreLock(file, before);

    failure.rename = true;
    try {
      await expect(writeStoreLock(file, upsertEntry(before, entry('a')))).rejects.toThrow(/обрыв перед rename/);
    } finally {
      failure.rename = false;
    }

    expect(readStoreLock(file)).toEqual(before);
    expect(readdirSync(path.dirname(file)).filter((name) => name.startsWith('обрыв'))).toEqual(['обрыв.lock']);
  });

  it('перезапись поверх существующего файла не оставляет полуфайла', async () => {
    const file = path.join(TMP, 'перезапись.lock');
    writeFileSync(file, 'мусор, которого читатель не примет\n', 'utf8');
    await writeStoreLock(file, upsertEntry(EMPTY, entry('7')));
    expect(readStoreLock(file).entries).toHaveLength(1);
    expect(existsSync(file)).toBe(true);
  });
});
