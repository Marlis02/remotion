// Грамматика имени вызова — таблица приёма и таблица отказа (долг №37).
import { describe, expect, it } from 'vitest';

import { TemplateSpecError, formatTemplateName, parseTemplateName } from '../src/index.js';
import type { TemplateName } from '../src/index.js';

const ACCEPTED: readonly (readonly [string, TemplateName])[] = [
  ['kenburns@1', { namespace: null, templateId: 'kenburns', templateVersion: 1 }],
  ['still@1', { namespace: null, templateId: 'still', templateVersion: 1 }],
  ['flash@1', { namespace: null, templateId: 'flash', templateVersion: 1 }],
  ['bed@1', { namespace: null, templateId: 'bed', templateVersion: 1 }],
  ['captionEmphasis@1', { namespace: null, templateId: 'captionEmphasis', templateVersion: 1 }],
  // `local:` — одна строка грамматики, вводится сразу (ADR-0008, Charter V3).
  ['local:kenburns@1', { namespace: 'local', templateId: 'kenburns', templateVersion: 1 }],
  // Версия — целое без верхней границы; двузначные версии законны.
  ['kenburns@12', { namespace: null, templateId: 'kenburns', templateVersion: 12 }],
  // Имена будущих эффектов roadmap §5 обязаны укладываться в ту же грамматику.
  ['shaderBg@1', { namespace: null, templateId: 'shaderBg', templateVersion: 1 }],
  ['parallax25@1', { namespace: null, templateId: 'parallax25', templateVersion: 1 }],
];

const REJECTED: readonly (readonly [string, string])[] = [
  ['kenburns', 'без версии'],
  ['kenburns@', 'пустая версия'],
  ['kenburns@0', 'версия 0 — нумерация с единицы'],
  ['kenburns@01', 'ведущий ноль — две строки для одной версии'],
  ['kenburns@1.5', 'версия не целая'],
  ['kenburns@-1', 'отрицательная версия'],
  ['ken burns@1', 'пробел внутри имени'],
  [' kenburns@1', 'пробел слева'],
  ['kenburns@1 ', 'пробел справа'],
  ['kenburns@1@2', 'второй `@`'],
  ['vendor:kenburns@1', 'неизвестный namespace'],
  ['local:local:kenburns@1', 'namespace дважды'],
  ['Kenburns@1', 'имя с заглавной — id в lowerCamelCase'],
  ['ken-burns@1', 'дефис — два написания одного имени дали бы два ключа кэша'],
  ['ken_burns@1', 'подчёркивание — то же самое'],
  ['@1', 'пустой id'],
  ['', 'пустая строка'],
];

describe('`TS-01` — грамматика имени вызова (долг №37)', () => {
  for (const [raw, expected] of ACCEPTED) {
    it(`принимает \`${raw}\``, () => {
      expect(parseTemplateName(raw)).toEqual(expected);
    });
  }

  for (const [raw, why] of REJECTED) {
    it(`отвергает \`${raw}\` — ${why}`, () => {
      expect(() => parseTemplateName(raw)).toThrow(TemplateSpecError);
      expect(() => parseTemplateName(raw)).toThrow(/V3/);
    });
  }

  it('`formatTemplateName` обратна `parseTemplateName` на всей таблице приёма', () => {
    for (const [raw] of ACCEPTED) {
      expect(formatTemplateName(parseTemplateName(raw)), raw).toBe(raw);
    }
  });

  it('`local:kenburns@1` и `kenburns@1` — РАЗНЫЕ имена, а не одно с украшением', () => {
    const local = parseTemplateName('local:kenburns@1');
    const library = parseTemplateName('kenburns@1');
    expect(local.templateId).toBe(library.templateId);
    expect(local.templateVersion).toBe(library.templateVersion);
    expect(local.namespace).not.toBe(library.namespace);
    expect(formatTemplateName(local)).not.toBe(formatTemplateName(library));
  });

  it('не строка — тоже отказ по V3, а не падение внутри регулярки', () => {
    expect(() => parseTemplateName(42 as unknown as string)).toThrow(TemplateSpecError);
  });
});
