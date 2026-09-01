// **ОХРАННИК АКТУАЛЬНОСТИ ВЫГРУЗКИ** (`SPEC-01`).
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ЧЕГО ЗДЕСЬ НЕТ. Снапшота всего markdown нет и не будет: болтливый
// тест краснеет на каждой правке формулировки и через месяц обновляется не глядя — то есть
// перестаёт быть охранником. Проверяются СВОЙСТВА, каждое из которых называет свою дыру:
//
//   * восьмой шаблон, не попавший в выгрузку, — тихая дыра в спецификации;
//   * шаблон с пустым `guidance` — строка «есть такой id, зачем — неизвестно»;
//   * кривая, дописанная в текст выгрузки мимо реестра **D5**, — ИИ напишет её, компилятор
//     отвергнет, а виноват будет автор сценария;
//   * пример вызова, разошедшийся со схемой своего шаблона, — форма, которой движок не
//     принимает, выданная за образец;
//   * поле с границей в `.refine` без строки границы в выгрузке — ИИ узнает про потолок
//     только отказом (решение владельца `SPEC-01`, вопрос В1).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateLibrary } from '@vpe/renderer-hyperframes';
import {
  introspectParams,
  EASING_REGISTRY,
  TEMPLATE_LIBRARY,
  type AnyTemplateSpec,
  type LoadedTemplate,
} from '@vpe/templates-spec';
import { describe, expect, it } from 'vitest';

import { parseArgv } from '../src/argv.js';
import { CliError } from '../src/errors.js';
import { exampleDirectionYaml, formatSpecExport, specExport, specExportJson } from '../src/spec-export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const library = loadTemplateLibrary();
const doc = specExport(library.loaded);
const markdown = formatSpecExport(doc);

/** Спек по имени вызова — для проверки примеров ЕГО схемой. */
function specOf(name: string): AnyTemplateSpec {
  const found = library.loaded.find((item) => item.name === name);
  if (found === undefined) throw new Error(`нет шаблона \`${name}\` в загруженном каталоге`);
  return found.spec;
}

describe('`SPEC-01` — выгрузка знает ВЕСЬ каталог', () => {
  it('шаблонов в выгрузке ровно столько же, сколько в библиотеке', () => {
    expect(doc.templates).toHaveLength(TEMPLATE_LIBRARY.length);
  });

  for (const spec of TEMPLATE_LIBRARY) {
    const name = `${spec.templateId}@${String(spec.templateVersion)}`;

    it(`\`${name}\`: попал в выгрузку и назван в её тексте`, () => {
      expect(
        doc.templates.map((card) => card.name),
        `\`${name}\` не попал в выгрузку: шаблон, которого ИИ не увидит, не существует для сценария`,
      ).toContain(name);
      expect(markdown, `\`${name}\` не назван в markdown-выгрузке`).toContain(`### \`${name}\``);
    });

    it(`\`${name}\`: \`guidance\` не пуст — иначе спецификация молчит о назначении`, () => {
      const card = doc.templates.find((item) => item.name === name);
      expect(card, `\`${name}\` отсутствует в выгрузке`).toBeDefined();
      expect(
        (card?.guidance ?? '').trim().length,
        `\`${name}\`: \`guidance\` пуст. Шаблон без назначения попадает в выгрузку строкой ` +
          '«есть такой id, параметры вот, зачем — неизвестно» — это дыра в спецификации, а не ' +
          'мелочь оформления',
      ).toBeGreaterThan(0);
      expect(markdown).toContain(spec.guidance);
    });

    it(`\`${name}\`: у каждого поля с \`.refine\` есть строка границы в выгрузке`, () => {
      // Решение владельца `SPEC-01` (В1): границы, заданные `.refine`, JSON Schema не
      // выражает, и без этой половины выгрузка недоговаривает про те самые числа, в которые
      // ИИ упрётся первым отказом.
      const refinements = introspectParams(spec).refinements;
      const card = doc.templates.find((item) => item.name === name);
      expect(card?.paramsRefinements ?? []).toHaveLength(refinements.length);
      for (const item of refinements) {
        const where = item.path === '' ? '`params` целиком' : `\`${item.path}\``;
        expect(
          markdown,
          `\`${name}\`: адрес ${where} несёт проверку сверх JSON Schema, а строки о ней в ` +
            'выгрузке нет',
        ).toContain(`* ${where} — `);
        for (const message of item.messages) expect(markdown).toContain(message);
      }
    });
  }
});

describe('`SPEC-01` — реестр кривых уезжает ЦЕЛИКОМ и ничего сверх него', () => {
  it('все шесть кривых названы в выгрузке', () => {
    expect(doc.easingRegistry).toEqual([...EASING_REGISTRY]);
    for (const id of EASING_REGISTRY) expect(markdown).toContain(`\`${id}\``);
  });

  it('число кривых в тексте — из реестра, а не литералом', () => {
    expect(markdown).toContain(`**закрыт**, ${String(EASING_REGISTRY.length)} кривых`);
  });

  it('в выгрузке нет кривой мимо реестра **D5**', () => {
    // Ловится ТЕКСТОМ, а не структурой: дописать седьмую кривую можно только в текст, и
    // именно этот путь проба Н3 и проверяет. Форма имени — `power`/`back`/`sine`/`none`
    // с точкой либо скобкой, то есть то, что читатель примет за имя кривой.
    const looksLikeEasing = /`((?:power[0-9]|back|sine|elastic|bounce|expo|circ|steps)[^`]*)`/gu;
    const found = new Set<string>();
    for (const match of markdown.matchAll(looksLikeEasing)) {
      const id = match[1];
      if (id !== undefined) found.add(id);
    }
    for (const id of found) {
      expect(
        (EASING_REGISTRY as readonly string[]).includes(id),
        `\`${id}\` выглядит именем кривой, но в реестре **D5** его нет. Реестр ЗАКРЫТ: ` +
          `${EASING_REGISTRY.join(', ')}. Кривая, дописанная в текст выгрузки мимо реестра, ` +
          'уедет в сценарий и будет отвергнута компилятором',
      ).toBe(true);
    }
  });
});

describe('`SPEC-01` — примеры вызовов проходят СВОИ схемы', () => {
  it('пример есть у каждого шаблона библиотеки, и ровно один', () => {
    expect(doc.examples.map((example) => example.template).sort()).toEqual(
      TEMPLATE_LIBRARY.map((spec) => `${spec.templateId}@${String(spec.templateVersion)}`).sort(),
    );
  });

  for (const example of [...doc.examples]) {
    it(`\`${example.template}\`: \`params\` примера принимает схема шаблона`, () => {
      expect(() => specOf(example.template).paramsSchema.parse(example.record['params'])).not.toThrow();
    });

    it(`\`${example.template}\`: источник примера назван`, () => {
      expect(example.source.length).toBeGreaterThan(0);
      expect(markdown).toContain(example.source);
    });
  }

  it('весь набор примеров печатается как валидный `direction/1`', () => {
    // Печатает КАНОНИЧЕСКИЙ ПИСАТЕЛЬ `@vpe/schema`, а он не создаёт файлов, которые читатель
    // отвергнет: значит форма примера проверена схемой семейства, а не глазами.
    const yaml = exampleDirectionYaml(doc.examples);
    expect(yaml).toContain('schema: direction/1');
    expect(markdown).toContain(yaml.replace(/\n$/u, ''));
  });

  it('примеры демо-ролика ссылаются на записи, которые в нём ЕСТЬ', () => {
    const live = readFileSync(path.join(ROOT, 'examples/vertical-v1/direction/01-archive.yaml'), 'utf8');
    for (const id of ['1a7c0e33', '4d8ea15b', '9f31b204', 'b8340c6a']) {
      expect(live, `запись \`${id}\` названа источником примера, но в живом файле её нет`).toContain(id);
    }
  });

  it('примеры фикстуры ссылаются на записи, которые в ней ЕСТЬ', () => {
    const fixture = readFileSync(path.join(ROOT, 'fixtures/minimal/direction/01-intro.yaml'), 'utf8');
    for (const id of ['5d6e1130', 'c81a05f7']) expect(fixture).toContain(id);
  });

  it('проза примера — та же, что в живом файле демо', () => {
    const live = readFileSync(path.join(ROOT, 'examples/vertical-v1/source/01-archive.md'), 'utf8');
    for (const line of ['[img: street] A city street in nineteen hundred.', '[beat: close] The country finally [emph] looked.']) {
      expect(markdown, `фрагмент прозы уехал от живого файла: ${line}`).toContain(line);
      expect(live, `фрагмент прозы уехал от живого файла: ${line}`).toContain(line);
    }
  });
});

describe('`SPEC-01` — числа канала и статус гейта присутствуют', () => {
  it('величины канала названы числами — И ИМЕННО В ТАБЛИЦЕ КАНАЛА', () => {
    // Ищется в `doc.channel`, а не во всём markdown: `30` и `500` встречаются в тексте
    // выгрузки и по другим поводам, и проверка «есть где-то на странице» осталась бы зелёной
    // после пропажи строки fps. Здесь адрес у числа один.
    const values = doc.channel.map((fact) => fact.value).join(' \n ');
    for (const value of [
      '1080 × 1920',
      '30 (решение владельца',
      '24000 Гц',
      '1800 кадров',
      '920',
      '500 px над краем',
      'кегль 68',
      'межстрочный 1.22',
      '500 мс/кадр',
      '250 мс/кадр',
      'от 1 до 3',
      '45 кадров',
    ]) {
      expect(values, `число канала \`${value}\` в таблице канала не найдено`).toContain(value);
    }
    // И оно же обязано доехать до печати.
    for (const fact of doc.channel) expect(markdown).toContain(fact.value);
  });

  it('у каждой величины канала назван источник', () => {
    for (const fact of doc.channel) {
      expect(fact.source.length, `величина «${fact.what}» без источника`).toBeGreaterThan(0);
    }
  });

  it('статус гейта каждого шаблона взят ИЗ ЗАПИСЕЙ, а не выдуман', () => {
    for (const item of library.loaded as readonly LoadedTemplate[]) {
      const card = doc.templates.find((one) => one.name === item.name);
      expect(card?.gates.map((gate) => gate.profileId).sort()).toEqual(
        item.spec.manifest.gates.map((gate) => gate.profileId).sort(),
      );
    }
  });
});

describe('`SPEC-01` — команда и её форма', () => {
  it('`--json` разбирается как JSON и несёт ту же структуру', () => {
    const parsed: unknown = JSON.parse(specExportJson(doc));
    expect(parsed).toEqual(JSON.parse(specExportJson(doc)));
    const asRecord = parsed as { schema: string; templates: readonly unknown[] };
    expect(asRecord.schema).toBe(doc.schema);
    expect(asRecord.templates).toHaveLength(doc.templates.length);
  });

  it('argv: флаги закрытым списком', () => {
    expect(parseArgv(['spec', 'export'])).toEqual({ command: 'spec export', json: false, out: null });
    expect(parseArgv(['spec', 'export', '--json'])).toEqual({ command: 'spec export', json: true, out: null });
    expect(parseArgv(['spec', 'export', '--out', 'a.md'])).toEqual({
      command: 'spec export',
      json: false,
      out: 'a.md',
    });
    expect(() => parseArgv(['spec', 'export', '--markdown'])).toThrow(CliError);
    expect(() => parseArgv(['spec', 'list'])).toThrow(/неизвестная подкоманда `spec list`/u);
    expect(() => parseArgv(['spec', 'export', '--out'])).toThrow(/`--out` требует значения/u);
  });

  it('раздел запретов называет и каталог, и реестр кривых', () => {
    expect(doc.forbidden.join('\n')).toContain('вне каталога не существует');
    expect(doc.forbidden.join('\n')).toContain(`Кривых ровно ${String(EASING_REGISTRY.length)}`);
  });
});
