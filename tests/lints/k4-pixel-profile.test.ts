// **K4** — «`renderIr` не видит `pixelProfile`» (ADR-0002 §7; ADR-0009, исполнимый тест 4).
//
// ПОЧЕМУ ГРЕП, ЕСЛИ ЕСТЬ ТИП. Тип закрывает вход стадии: у `compileIr` три параметра, и
// `pixelProfile` среди них нет. Но тип не мешает ЗАВЕСТИ четвёртый — а поймать это мутацией
// невозможно по построению: тест мутирует поля `PixelProfileInput` и показывает, что хэш IR
// не меняется, то есть он зелёный и до появления протечки, и после неё, если протечка ещё не
// подключена к вычислению. Греп видит ВОЗМОЖНОСТЬ там, где мутация видит только следствие, —
// ровно то же рассуждение, по которому у **D2** греп стоит рядом с тестом.
//
// ЧТО ИМЕННО ЗАПРЕЩЕНО. Имена `pixelProfile` и `PixelProfileInput` в коде производства IR:
// зоне `compile/src/render-ir/**` и стадии `compile/src/compile-ir.ts`. Полей `PixelProfileInput`
// поимённо (`crf`, `scale`, `codec`, …) в списке НЕТ намеренно: это общеупотребительные слова,
// и запрет на них дал бы ложные срабатывания вместо охранника. Протечка отдельным полем без
// упоминания имени профиля остаётся за тестом мутации и за формой входа.
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ (`codeLines`): правило процитировано в шапке `compile-ir.ts`, и
// краснеть на собственной цитате охранник не вправе.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

/** Стадия, читающая Timeline и пишущая IR. Лежит вне обеих зон (**M5**). */
const STAGE = 'packages/compile/src/compile-ir.ts';

/** Зона производства IR целиком. */
const ZONE = 'packages/compile/src/render-ir/';

const FORBIDDEN = ['pixelProfile', 'PixelProfileInput'];

function offenders(relPath: string): string[] {
  const out: string[] = [];
  for (const [number, line] of codeLines(readSource(relPath)).entries()) {
    for (const word of FORBIDDEN) {
      if (new RegExp(`\\b${word}\\b`).test(line)) out.push(`${relPath}:${String(number + 1)}: ${word}`);
    }
  }
  return out;
}

/** Файлы, производящие IR: зона плюс стадия. */
function irFiles(): string[] {
  const zone = sourceFiles('compile').filter((file) => file.startsWith(ZONE));
  return [...zone, STAGE];
}

describe('**K4** — греп: в производстве IR нет ни одного упоминания `pixelProfile`', () => {
  it('ни в зоне `render-ir/**`, ни в стадии `compile-ir.ts`', () => {
    expect(
      irFiles().flatMap(offenders),
      'В коде, производящем RenderIR, появилось упоминание `pixelProfile`. ADR-0002 §7: вход ' +
        'стадии — `compileProfile` и НИКОГДА `pixelProfile`. Это план Б по рендереру в ' +
        'исполнимой форме (ADR-0008): сегмент, посчитанный без пиксельных настроек, переживает ' +
        'смену рендерера; сегмент, знающий про `crf`, — нет.',
    ).toEqual([]);
  });

  it('охранник НЕ мёртвый: он стережёт файлы, которые действительно существуют', () => {
    const files = irFiles();
    expect(files.length, 'зона `render-ir/` пуста — греп стережёт не тот каталог').toBeGreaterThan(5);
    expect(codeLines(readSource(STAGE)).join('\n')).toContain('export function compileIr');
  });

  it('греп РАБОТАЕТ: подставной нарушитель краснеет, а комментарий — нет', () => {
    const check = (source: string): string[] => {
      const out: string[] = [];
      for (const [number, line] of codeLines(source).entries()) {
        for (const word of FORBIDDEN) {
          if (new RegExp(`\\b${word}\\b`).test(line)) out.push(`${String(number + 1)}: ${word}`);
        }
      }
      return out;
    };
    // Одна строка — одна находка на слово: греп отвечает на вопрос «где», а не «сколько раз».
    expect(check('export const bad = (pixelProfile: unknown): unknown => pixelProfile;\n')).toEqual([
      '1: pixelProfile',
    ]);
    expect(check('import type { PixelProfileInput } from "@vpe/media";\n')).toEqual(['1: PixelProfileInput']);
    expect(check('// вход стадии — compileProfile, никогда pixelProfile\nexport const ok = 1;\n')).toEqual([]);
  });
});
