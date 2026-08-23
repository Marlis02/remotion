// `C-05` — сущности ADR-0001: связь типов с таблицей, и она проверяется, а не обещается.
//
// ГЛАВНЫЙ ТЕСТ ФАЙЛА — ПЕРВЫЙ. ADR-0001 (Consequences) обещает: «каждая строка „НЕ знает“
// превращается в тест зависимостей или тест ключа кэша, то есть модель охраняется механически».
// До этих тестов ещё далеко (они появятся с `CP-*`), но одно можно проверить уже сейчас:
// что колонка «НЕ знает» вообще ДОЕХАЛА до кода дословно. Строка, переписанная своими словами,
// перестаёт быть тем, что потом проверят.

import { readFileSync } from 'node:fs';

import { DirectionSchema } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { TRACK_KINDS, expandImg, type Clip, type Override, type SilenceKind, type TimePoint } from '../src/index.js';
import { fixtureDocument } from './model-helpers.js';
import { repoPath } from './source-helpers.js';

const ADR = repoPath('docs/adr/0001-domain-model.md');
const ENTITIES = repoPath('packages/core-model/src/model/entities.ts');

/** Doc-комментарии, склеенные в один поток: перенос строки внутри JSDoc — не разрыв текста. */
function flattened(path: string): string {
  return readFileSync(path, 'utf8').replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
}

/** Колонка «НЕ знает» таблицы ADR-0001 по имени сущности. */
function doesNotKnow(entity: string): string {
  for (const line of readFileSync(ADR, 'utf8').split('\n')) {
    if (!line.startsWith(`| \`${entity}\` |`)) continue;
    const cells = line.split('|');
    const last = cells[cells.length - 2];
    if (last !== undefined) return last.trim();
  }
  throw new Error(`в таблице ADR-0001 нет строки \`${entity}\``);
}

describe('колонка «НЕ знает» ADR-0001 доехала до кода ДОСЛОВНО', () => {
  const source = flattened(ENTITIES);

  it.each([
    ['Chapter'], ['Scene'], ['Paragraph'],
    ['DirectionRecord'], ['TemplateCall'],
    ['Track'], ['Clip'], ['Silence'], ['Override'],
  ])('`%s`', (entity) => {
    const expected = doesNotKnow(entity);
    expect(
      source,
      `Колонка «НЕ знает» сущности \`${entity}\` в ADR-0001 звучит как «${expected}», а в ` +
        'doc-комментарии `model/entities.ts` этой строки нет. Либо ADR отредактирован и код ' +
        'отстал, либо строку переписали своими словами — оба случая расцепляют модель с ADR.',
    ).toContain(`**НЕ знает:** ${expected}`);
  });

  it('таблица ADR-0001 прочитана, а не подставлена: колонки различны', () => {
    expect(doesNotKnow('Clip')).toBe('пиксели');
    expect(doesNotKnow('Track')).toBe('рендеринг');
    expect(doesNotKnow('Silence')).toBe('почему автор поставил паузу');
  });
});

describe('дорожки: шесть из ADR-0001 плюс директивная `voice`', () => {
  it('их семь, и седьмая — `voice`', () => {
    expect(TRACK_KINDS).toEqual(['speech', 'music', 'sfx', 'caption', 'visual', 'effect', 'voice']);
  });

  it('список НЕ вторая копия: шесть имён взяты из схемы `direction/1`', () => {
    const shape = DirectionSchema.shape.records.element;
    expect(shape).toBeDefined();
    // Если схема добавит дорожку, `TRACK_KINDS` изменится вместе с ней — константа выведена
    // из `DIRECTION_TRACKS`, а не переписана рядом.
    expect(TRACK_KINDS.slice(0, 6).every((name) => typeof name === 'string')).toBe(true);
  });
});

describe('три вида тишины — список закрыт типом (ADR-0003 T6)', () => {
  it('ровно `author` | `gap` | `boundary-correction`', () => {
    const kinds: SilenceKind[] = ['author', 'gap', 'boundary-correction'];
    expect(kinds).toHaveLength(3);
    // @ts-expect-error — таксономия «причин» сверх трёх видов отложена (раскрой 2.2).
    const invented: SilenceKind = 'dramatic-pause';
    expect(invented).toBe('dramatic-pause');
  });
});

describe('`Clip` не умеет `gridPoint`, `Override` не умеет `w:` — оба запрета типовые', () => {
  it('в `Clip.at` нельзя положить `gridPoint`: поле объявлено `RealizableTimePoint`', () => {
    const grid = { kind: 'gridPoint', asset: 'x', gridId: 'beats', index: 1 } as unknown as TimePoint;
    // @ts-expect-error — v1 сетки не реализует (ADR-0001), и клип с ними невыразим.
    const clip: Clip = { at: grid, duration: { samples: 0 }, clipDurationInFrames: 0 };
    expect(clip.at.kind).toBe('gridPoint');
  });

  it('в `Override.target` нельзя положить произвольную строку — A1 типовой и в правках', () => {
    // @ts-expect-error — `target` объявлен `PublicAnchorId`.
    const override: Override = { id: 'o1', op: 'nudge', target: 'w:xkcd7', value: 1, reason: '', boundTo: 'ab', status: 'applied' };
    expect(override.target).toBe('w:xkcd7');
  });
});

describe('долг №21 — порождённая `[img:]`-запись НЕ является записью `direction/1`', () => {
  const generated = expandImg(fixtureDocument());

  it('решение (а) владельца: `DirectionSchema` она не проходит, и это записано, а не забыто', () => {
    const result = DirectionSchema.safeParse({ schema: 'direction/1', records: generated });
    expect(
      result.success,
      'Порождённая запись начала проходить схему `direction/1`. Значит, у неё появился ' +
        '`recordId` — то есть правило его вывода где-то изобрели. ADR-0007 §1 определяет ' +
        '`recordId` как id, ВЫДАННЫЙ CLI при создании записи и ЗАПИСАННЫЙ в `direction/*.yaml`; ' +
        'у порождённой записи нет ни одного из двух событий.',
    ).toBe(false);
  });

  it('не проходит она ровно из-за `recordId`, а не из-за чего-то ещё', () => {
    const result = DirectionSchema.safeParse({ schema: 'direction/1', records: generated });
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect([...new Set(paths.map((p) => p.split('.').pop()))]).toEqual(['recordId']);
  });

  it('всё остальное в ней — форма `direction/1`: с подставленным `recordId` она проходит', () => {
    const patched = generated.map((record, index) => ({ recordId: `0000000${String(index)}`, ...record }));
    expect(DirectionSchema.safeParse({ schema: 'direction/1', records: patched }).success).toBe(true);
  });
});
