// V13 — «язык контента всех фикстур репозитория — английский» (Charter V12, rev3).
//
// ПОЧЕМУ ЭТО ОХРАНЯЕТСЯ ТЕСТОМ, А НЕ ДИСЦИПЛИНОЙ. Фикстура — исполнимая форма формата
// (`fixtures/minimal/README.md`), и на ней стоит вся верификационная история: AC4, AC4-b,
// AC6, blast-radius, тест корректности кэша, SP-4. Русская строка, попавшая в прозу или в
// `title`, доезжает до платного TTS и до публикации — то есть до денег и до чужих глаз.
//
// ГРАНИЦА ПРОВЕРКИ ВЗЯТА ИЗ V13 ДОСЛОВНО: `fixtures/**/source/*.md` целиком и поля
// `title`/`descriptionTemplate` каждого `fixtures/**/publish.yaml`. Комментарии YAML и
// `docs/**` НЕ проверяются — они остаются русскими по тому же правилу («меняется язык
// контента, а не язык документации»), и охранник, который бы их трогал, был бы неверным,
// а не строгим.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTENT_FIELDS,
  CYRILLIC,
  ROOT,
  contentFieldsOf,
  contentFiles,
  formatViolations,
  scanContentLanguage,
} from './content-language';

describe('V13 — язык контента фикстур английский', () => {
  it('в `fixtures/**/source/*.md` и в `title`/`descriptionTemplate` нет кириллицы `[Ѐ-ӿ]`', () => {
    const violations = scanContentLanguage(ROOT);
    expect(formatViolations(violations)).toBe('');
    expect(violations).toEqual([]);
  });

  it('охранник не пуст: он видит и прозу, и `publish.yaml`', () => {
    // Без этой проверки тест выше проходил бы на пустом дереве — то есть не проверял бы ничего.
    const files = contentFiles(ROOT);
    expect(files.prose.length).toBeGreaterThan(0);
    expect(files.publish.length).toBeGreaterThan(0);
    expect(files.prose).toContain(path.join('fixtures', 'minimal', 'source', '01-intro.md'));
    expect(files.publish).toContain(path.join('fixtures', 'minimal', 'publish.yaml'));
  });

  it('оба контентных поля действительно извлекаются из `fixtures/minimal/publish.yaml`', () => {
    const text = fs.readFileSync(path.join(ROOT, 'fixtures', 'minimal', 'publish.yaml'), 'utf8');
    const fields = contentFieldsOf(text);
    expect(fields.map((field) => field.name).sort()).toEqual([...CONTENT_FIELDS].sort());
    expect(fields.find((field) => field.name === 'title')?.value).toBe(
      'What the Harbour Was Waiting For',
    );
    expect(fields.find((field) => field.name === 'descriptionTemplate')?.value).toContain(
      'Sources and licences',
    );
  });

  it('комментарии YAML под правило НЕ подпадают — и они в фикстуре русские', () => {
    const text = fs.readFileSync(path.join(ROOT, 'fixtures', 'minimal', 'publish.yaml'), 'utf8');
    // В файле кириллица ЕСТЬ — в комментариях. Охранник обязан её не заметить.
    expect(CYRILLIC.test(text)).toBe(true);
    expect(scanContentLanguage(ROOT)).toEqual([]);
  });
});

describe('V13 — охранник показан ловящим нарушение (`fixtures/` не изменяется)', () => {
  /** Временное дерево ВНЕ репозитория: `fixtures/` не трогается ни одним нарушением. */
  function withTree(files: Record<string, string>, check: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vpe-v13-'));
    try {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
      }
      check(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const CLEAN_PROSE = ['schema: source-dialect/1', '', '# chapter: main', '', '## scene: intro', '', 'The morning began the same way.', ''].join('\n');
  const CLEAN_PUBLISH = [
    'schema: publish/1',
    '',
    '# Русский комментарий — по V13 не проверяется.',
    'title: "What the Harbour Was Waiting For"',
    'descriptionTemplate: |',
    '  A short story about harbour warehouses.',
    '',
    '  Sources and licences:',
    '  {{attributions}}',
    '',
    'topic: history                    # русский хвостовой комментарий',
    '',
  ].join('\n');

  it('чистая копия фикстуры проходит', () => {
    withTree(
      {
        'fixtures/copy/source/01-intro.md': CLEAN_PROSE,
        'fixtures/copy/publish.yaml': CLEAN_PUBLISH,
      },
      (root) => {
        expect(scanContentLanguage(root)).toEqual([]);
      },
    );
  });

  it('кириллица в прозе копии — нарушение с файлом, строкой и самим символом', () => {
    withTree(
      {
        'fixtures/copy/source/01-intro.md': CLEAN_PROSE.replace(
          'The morning began the same way.',
          'Утро начиналось так же.',
        ),
        'fixtures/copy/publish.yaml': CLEAN_PUBLISH,
      },
      (root) => {
        const violations = scanContentLanguage(root);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.file).toBe(path.join('fixtures', 'copy', 'source', '01-intro.md'));
        expect(violations[0]?.line).toBe(7);
        expect(violations[0]?.where).toBe('source');
        expect(violations[0]?.character).toBe('У');
      },
    );
  });

  it('кириллица в `title` копии — нарушение с именем поля', () => {
    withTree(
      {
        'fixtures/copy/source/01-intro.md': CLEAN_PROSE,
        'fixtures/copy/publish.yaml': CLEAN_PUBLISH.replace(
          'What the Harbour Was Waiting For',
          'Чего ждали в порту',
        ),
      },
      (root) => {
        const violations = scanContentLanguage(root);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.where).toBe('title');
        expect(violations[0]?.character).toBe('Ч');
      },
    );
  });

  it('кириллица в блочном скаляре `descriptionTemplate` копии — нарушение', () => {
    withTree(
      {
        'fixtures/copy/source/01-intro.md': CLEAN_PROSE,
        'fixtures/copy/publish.yaml': CLEAN_PUBLISH.replace(
          '  A short story about harbour warehouses.',
          '  Короткая история про портовые склады.',
        ),
      },
      (root) => {
        const violations = scanContentLanguage(root);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.where).toBe('descriptionTemplate');
        expect(violations[0]?.character).toBe('К');
      },
    );
  });

  it('`.md` ВНЕ каталога `source/` и файл не-`publish.yaml` под правило не подпадают', () => {
    withTree(
      {
        'fixtures/copy/source/01-intro.md': CLEAN_PROSE,
        'fixtures/copy/publish.yaml': CLEAN_PUBLISH,
        'fixtures/copy/README.md': '# Русский README фикстуры — по V13 законен.',
        'fixtures/copy/project.yaml': 'schema: project/1\ntitle: "Русское поле чужой схемы"\n',
      },
      (root) => {
        // README фикстуры русский по правилу самой V13; `project.yaml` — не `publish.yaml`,
        // и его поля V13 не называет. Расширять область здесь значило бы решать за Charter.
        expect(scanContentLanguage(root)).toEqual([]);
      },
    );
  });
});
