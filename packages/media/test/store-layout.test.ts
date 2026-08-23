// `M-01` — раскладка CAS и **P8** (`.store` вне дерева проекта), плюс половина **K10**.
//
// ЖЁСТКОЕ ПРАВИЛО ЭТОГО ФАЙЛА: ни один тест не касается настоящего `~/.vpe`. Это не
// дисциплина автора, а свойство кода: `homedir` в `media` — ВХОД, и тесты подают вымышленный.
// Вторая половина того же правила — греп «в `media/src` нет `os.homedir()`» — живёт в
// `tests/lints/p8-store-path-inputs.test.ts`: она про репозиторий, а не про пакет.
//
// ЧТО ЗДЕСЬ ОТ K10. Половина «у `Store` нет метода удаления», и она ЧЕСТНО близка к
// тавтологии: тест сверяет имена методов реализации с пятью именами ADR-0005 §8. Ценность у
// неё ровно одна и небольшая — шестой метод `remove()` нельзя добавить молча. Вторая,
// не тавтологичная половина (в `store/**` нет вызовов удаления вне владельца tmp) — там же,
// в `tests/lints/k10-store-has-no-delete.test.ts`. Полного покрытия K10 сегодня нет, и
// строка реестра остаётся `named`: правило говорит про GC, а GC не существует.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { ProjectSchema, asSha256, readFamily } from '@vpe/schema';

import { LocalStore, StorePathError, blobPath, resolveStorePath, shardDir } from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

/** Домашний каталог ВЫМЫШЛЕННЫЙ. Настоящий тесту неизвестен и не нужен. */
const HOME = path.join(path.sep, 'home', 'вымышленный');
const PROJECT = path.join(path.sep, 'srv', 'projects', 'harbour');

const SHA = asSha256('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

const TMP = mkdtempSync(path.join(tmpdir(), 'vpe-m01-layout-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ── 1. Раскладка ADR-0005 §1 ───────────────────────────────────────────────────────────────

describe('раскладка `.store/ab/cd/<sha256>`', () => {
  it('два уровня по два hex-символа, дальше — полный sha именем файла', () => {
    expect(blobPath('/store', SHA)).toBe(path.join('/store', '2c', 'f2', SHA));
    expect(shardDir('/store', SHA)).toBe(path.join('/store', '2c', 'f2'));
  });

  it('шард не «съедает» имя файла: sha в имени полный, а не обрезанный', () => {
    expect(path.basename(blobPath('/store', SHA))).toBe(SHA);
    expect(path.basename(blobPath('/store', SHA))).toHaveLength(64);
  });
});

// ── 2. P8 — стор вне дерева проекта ────────────────────────────────────────────────────────

describe('**P8** — `.store` живёт вне дерева проекта', () => {
  it('значение берётся из `project.yaml → store.path` — и это `~/.vpe/store` в фикстуре', () => {
    const project = ProjectSchema.parse(readFamily(path.join(FIXTURE, 'project.yaml')).value);
    expect(project.store.path).toBe('~/.vpe/store');
    expect(resolveStorePath(project.store.path, { homedir: HOME, projectRoot: PROJECT })).toBe(
      path.join(HOME, '.vpe', 'store'),
    );
  });

  it('`~` раскрывается по ПЕРЕДАННОМУ домашнему каталогу, а не по системному', () => {
    // Настоящий `os.homedir()` в этом утверждении не участвует вовсе — ровно поэтому тесты
    // пакета физически не могут записать в чужой `~/.vpe`.
    expect(resolveStorePath('~', { homedir: HOME, projectRoot: PROJECT })).toBe(HOME);
    expect(resolveStorePath('~/store', { homedir: HOME, projectRoot: PROJECT })).toBe(path.join(HOME, 'store'));
  });

  it('путь ВНУТРИ дерева проекта отвергается — и ошибка называет причину, а не «нельзя»', () => {
    for (const inside of [PROJECT, path.join(PROJECT, '.store'), path.join(PROJECT, 'a', 'b', 'store')]) {
      let caught: unknown;
      try {
        resolveStorePath(inside, { homedir: HOME, projectRoot: PROJECT });
      } catch (error) {
        caught = error;
      }
      expect(caught, inside).toBeInstanceOf(StorePathError);
      expect(String(caught)).toMatch(/git clean -xdf/);
      expect(String(caught)).toMatch(/P8/);
    }
  });

  it('сосед с общим префиксом — НЕ «внутри»: `…/harbour-2` законен рядом с `…/harbour`', () => {
    // Проверка границы по строке без разделителя пути отвергла бы законный каталог.
    const sibling = `${PROJECT}-2`;
    expect(resolveStorePath(sibling, { homedir: HOME, projectRoot: PROJECT })).toBe(sibling);
  });

  it('относительный путь отвергается: иначе у `vpe` из подкаталога был бы другой стор', () => {
    expect(() => resolveStorePath('.store', { homedir: HOME, projectRoot: PROJECT })).toThrow(StorePathError);
    expect(() => resolveStorePath('../store', { homedir: HOME, projectRoot: PROJECT })).toThrow(/относительный путь/);
    expect(() => resolveStorePath('~другой/store', { homedir: HOME, projectRoot: PROJECT })).toThrow(/относительный путь/);
  });

  it('пустое значение отвергается', () => {
    expect(() => resolveStorePath('', { homedir: HOME, projectRoot: PROJECT })).toThrow(/пустое значение/);
  });

  it('`..` внутри значения не проносит стор в дерево проекта', () => {
    const sneaky = path.join(PROJECT, '..', 'harbour', '.store');
    expect(() => resolveStorePath(sneaky, { homedir: HOME, projectRoot: PROJECT })).toThrow(/лежит внутри дерева/);
  });

  it('конструктор `LocalStore` берёт готовый абсолютный путь и не резолвит ничего сам', () => {
    expect(() => new LocalStore('.store')).toThrow(/обязан быть абсолютным/);
    expect(() => new LocalStore('~/.vpe/store')).toThrow(/обязан быть абсолютным/);
  });

  it('стор создаётся ровно по переданному пути — и больше нигде', async () => {
    const root = path.join(TMP, 'вне-дерева');
    const sha = await new LocalStore(root).put(new TextEncoder().encode('hello'), 'voice');
    expect(existsSync(blobPath(root, sha))).toBe(true);
    expect(blobPath(root, sha).startsWith(`${TMP}${path.sep}`)).toBe(true);
    expect(existsSync(path.join(REPO, '.store'))).toBe(false);
  });
});

// ── 3. K10 (половина) — у `Store` нет метода удаления ───────────────────────────────────────

describe('**K10** — интерфейс из ПЯТИ методов, среди них нет удаления', () => {
  /** Дословно ADR-0005 §8. Список здесь, а не в `src`, — иначе он сверялся бы сам с собой. */
  const ADR_METHODS = ['has', 'read', 'put', 'path', 'missing'];

  it('у `LocalStore` ровно пять методов, и их имена совпадают с ADR-0005 §8', () => {
    const methods = Object.getOwnPropertyNames(LocalStore.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual([...ADR_METHODS].sort());
  });

  it('ни один метод не называется удалением', () => {
    const methods = Object.getOwnPropertyNames(LocalStore.prototype);
    for (const forbidden of ['delete', 'remove', 'evict', 'gc', 'prune', 'unlink', 'clear']) {
      expect(methods, `появился метод \`${forbidden}\`: \`.store\` не подлежит GC никогда (K10)`).not.toContain(
        forbidden,
      );
    }
  });
});
