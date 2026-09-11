// **A1** — «ни один override и ни одна direction-запись не ссылаются на `w:`» (ADR-0004 §2).
//
// Этот тест ADR-0004 §2a называет по имени: «исполнимый охранник, которого не было (m5): тест
// „в `direction/**` и `overrides/**` нет ни одной ссылки `w:`“. Пока его нет, утверждение
// „ссылок на `w:` в артефактах нет“ непроверяемо».
//
// ЗДЕСЬ ОН ЗАКРЫТ НАПОЛОВИНУ, И ЭТО ЗАПИСАНО. Проверяются ФИКСТУРЫ репозитория; вторая половина
// — `vpe fmt --check`/`vpe check` с ненулевым exit на дереве реального проекта — задача `L-03`.
// Поэтому строка A1 реестра остаётся `named` с пометкой, а `guarded` получает A2, у которой
// оба названных охранника (этот тест + golden разворачивания `[img:]`) теперь есть.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GUARDED_DIRS,
  ROOT,
  formatWReferences,
  guardedFiles,
  hasWReference,
  scanWReferences,
  withoutComments,
} from './w-references';

describe('A1 — в `direction/**` и `overrides/**` нет ссылок на `w:`', () => {
  it('ни одной ссылки на `w:` во всех фикстурах репозитория', () => {
    const references = scanWReferences(ROOT);
    expect(formatWReferences(references)).toBe('');
    expect(references).toEqual([]);
  });

  it('охранник не пуст: он действительно читает файлы режиссуры', () => {
    // Без этой проверки тест выше был бы зелёным и на пустом дереве.
    const files = guardedFiles(ROOT);
    expect(files).toContain(path.join('fixtures', 'minimal', 'direction', '01-intro.yaml'));
    expect(files.length).toBeGreaterThan(0);
    expect(GUARDED_DIRS).toEqual(['direction', 'overrides']);
  });

  it('охранник ловит настоящую ссылку — на ВРЕМЕННОЙ копии, `fixtures/` не трогается', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vpe-a1-'));
    try {
      const dir = path.join(temp, 'fixtures', 'minimal', 'direction');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '01-intro.yaml'),
        'schema: direction/1\nrecords:\n  - at: { kind: anchor, anchor: "w:7f2q9x1bdk3m4n5p" }\n',
        'utf8',
      );
      const references = scanWReferences(temp);
      expect(references).toHaveLength(1);
      expect(references[0]?.line).toBe(3);
      expect(formatWReferences(references)).toContain('w:7f2q9x1bdk3m4n5p');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('комментарий про `w:` — не ссылка, и фикстура его содержит', () => {
    // `fixtures/minimal/direction/01-intro.yaml` объясняет в шапке, что ссылок на `w:` не
    // бывает. Дословный греп по байтам покраснел бы на этом объяснении — см. отчёт `C-04`,
    // находка для `L-03`.
    const text = fs.readFileSync(
      path.join(ROOT, 'fixtures', 'minimal', 'direction', '01-intro.yaml'),
      'utf8',
    );
    expect(text).toContain('w:');
    // Утверждение идёт ЧЕРЕЗ `hasWReference`, а не через `includes('w:')` (`CAPTION-01`):
    // после `CAPTION-01` в фикстуре есть поле `shadow:` — имя параметра, оканчивающееся на
    // `w`. Оно не ссылка, и ровно это здесь и утверждается.
    expect(text.split('\n').map(withoutComments).some(hasWReference)).toBe(false);
  });

  it('имя поля, оканчивающееся на `w`, ссылкой НЕ считается — и наоборот (`CAPTION-01`)', () => {
    // Обе половины правила названы числом строк, а не описанием: без второй половины сужение
    // было бы ослаблением, и проверить это можно только предъявив настоящую ссылку.
    for (const notReference of [
      'shadow: { dxPx: 0, dyPx: 2, blurPx: 10, color: "#000000", opacity: 0.55 }',
      '    glow: 3',
      '    flow: "down"',
    ]) {
      expect(hasWReference(notReference), notReference).toBe(false);
    }
    for (const reference of [
      '    anchor: "w:7f2q9x1bdk3m4n5p"',
      '    at: { kind: anchor, anchor: w:7f2q }',
      'w:7f2q',
    ]) {
      expect(hasWReference(reference), reference).toBe(true);
    }
  });

  it('хвостовой комментарий отрезается, а значение — нет', () => {
    expect(withoutComments('    anchor: "b:reveal"   # был w:7f2q').trimEnd()).toBe('    anchor: "b:reveal"');
    expect(withoutComments('    anchor: "w:7f2q"')).toContain('w:7f2q');
  });
});
