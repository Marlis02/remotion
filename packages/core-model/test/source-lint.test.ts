// `C-03` — линт прозы, ADR-0002 §3. Десять запретов, десять красных кейсов, десять зелёных.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, А ЧТО НЕТ. Проверяется правило, а не текст сообщения: у каждого
// красного кейса сверяются `location.line` и `location.column` ЧИСЛАМИ — иначе тест краснел бы
// от правки формулировки и молчал бы от сдвига позиции на символ. Позиция здесь не украшение:
// из неё состоит вся польза линта (ADR-0002 §5, «без `файл:строка:колонка` линт бесполезен»).
//
// ЗЕЛЁНЫЙ КЕЙС У КАЖДОГО ЗАПРЕТА — ТОТ ЖЕ ТЕКСТ ЧЕРЕЗ `[say:]`. Это и есть доказательство,
// что escape-hatch работает и что область запрета — ТОЛЬКО проза (C7): внутри `[say: d | s]`
// в `d` может стоять что угодно, а `s` — это и есть «словами».

import { describe, expect, it } from 'vitest';

import {
  assertProse,
  dumpAst,
  lintProse,
  lintShare,
  parseSource,
  PROSE_RULE_CODES,
  SourceParseError,
  type ProseFinding,
  type ProseRuleCode,
  type SourceDocument,
} from '../src/index.js';
import { FIXTURE_FILE, PROSE_LINE, SAMPLE_RATE, prose, readFixture } from './source-helpers.js';

const FILE = 'source/01-lint.md';

function parse(text: string): SourceDocument {
  return parseSource(text, { file: FILE, sampleRate: SAMPLE_RATE });
}

function lint(...lines: string[]): ProseFinding[] {
  return lintProse(parse(prose(...lines)));
}

/** Находка нужного кода — ровно одна; иначе тест обязан упасть с понятным сообщением. */
function only(findings: ProseFinding[], code: ProseRuleCode): ProseFinding {
  const hit = findings.filter((finding) => finding.code === code);
  expect(hit.map((f) => f.message), `находок кода ${code}`).toHaveLength(1);
  return hit[0] as ProseFinding;
}

/** Один запрет: красный текст, ожидаемая колонка, и тот же текст через `[say:]`. */
interface Case {
  readonly code: ProseRuleCode;
  readonly title: string;
  readonly red: string;
  readonly column: number;
  readonly green: string;
}

const CASES: readonly Case[] = [
  {
    code: 'digit',
    title: 'цифра',
    red: 'In 1793 the ships came.',
    column: 4,
    green: 'In [say: 1793 | seventeen ninety-three] the ships came.',
  },
  {
    code: 'percent',
    title: 'знак `%`',
    red: 'Only 5% remained.',
    column: 7,
    green: 'Only [say: 5% | five percent] remained.',
  },
  {
    code: 'dollar',
    title: 'знак `$`',
    red: 'It cost $5 that day.',
    column: 9,
    green: 'It cost [say: $5 | five dollars] that day.',
  },
  {
    code: 'numero',
    title: 'знак `№`',
    red: 'See № 7 for the list.',
    column: 5,
    green: 'See [say: № 7 | number seven] for the list.',
  },
  {
    code: 'roman',
    title: 'римская цифра',
    red: 'The XIV century ended badly.',
    column: 5,
    green: 'The [say: XIV | fourteenth] century ended badly.',
  },
  {
    code: 'abbreviation',
    title: 'сокращение с точкой',
    red: 'Dr. Adams arrived late.',
    column: 1,
    green: '[say: Dr. Adams | Doctor Adams] arrived late.',
  },
  {
    code: 'url',
    title: 'URL',
    red: 'Read https://example.org/a?b=c for more.',
    column: 6,
    green: 'Read [say: https://example.org/a?b=c | the site] for more.',
  },
  {
    code: 'bold',
    title: '`**жирный**`',
    red: 'This is **very** important.',
    column: 9,
    green: 'This is [say: **very** | very] important.',
  },
  {
    code: 'list',
    title: 'список',
    red: '- first item of a list',
    column: 1,
    green: '[say: - | dash] first item of a list',
  },
  {
    code: 'inline-code',
    title: 'инлайн-код',
    red: 'Use the `value` here.',
    column: 9,
    green: 'Use the [say: `value` | value] here.',
  },
];

describe('`C-03` линт прозы — десять запретов ADR-0002 §3', () => {
  it('кодов ровно десять, и это те десять, что перечисляет ADR-0002 §3', () => {
    expect(PROSE_RULE_CODES).toHaveLength(10);
    expect(CASES.map((c) => c.code)).toEqual([...PROSE_RULE_CODES]);
  });

  for (const testCase of CASES) {
    describe(`${testCase.code} — ${testCase.title}`, () => {
      it('в прозе отвергается, место указано числами', () => {
        const finding = only(lint(testCase.red), testCase.code);
        expect(finding.location.file).toBe(FILE);
        expect(finding.location.line).toBe(PROSE_LINE);
        expect(finding.location.column).toBe(testCase.column);
      });

      it('сообщение начинается с `файл:строка:колонка` и несёт escape-hatch по ADR-0002 §3', () => {
        const finding = only(lint(testCase.red), testCase.code);
        expect(finding.message.startsWith(`${FILE}:${String(PROSE_LINE)}:${String(testCase.column)}: `)).toBe(true);
        expect(finding.message).toContain('напиши словами или используй `[say:]`');
        expect(finding.message).toContain('[say:');
      });

      it('тот же текст через `[say:]` — зелёный', () => {
        expect(lint(testCase.green)).toEqual([]);
      });
    });
  }

  it('один токен может нарушить два правила разом: `1.` в начале строки — и список, и цифра', () => {
    const findings = lint('1. first item of a list');
    expect(findings.map((f) => f.code).sort()).toEqual(['digit', 'list']);
    expect(only(findings, 'list').location.column).toBe(1);
    expect(only(findings, 'digit').location.column).toBe(1);
  });

  it('находка одна на пару (токен, код): `2026` даёт одну цифровую находку, а не четыре', () => {
    const findings = lint('The year 2026 came.');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('digit');
    expect(findings[0]?.location.column).toBe(10);
  });

  it('находки идут в порядке исходника и покрывают весь файл, а не первую ошибку', () => {
    const findings = lint('In 1793 they came.', '', 'It cost $5 and 5% more.');
    expect(findings.map((f) => [f.location.line, f.location.column, f.code])).toEqual([
      [PROSE_LINE, 4, 'digit'],
      [PROSE_LINE + 2, 9, 'dollar'],
      [PROSE_LINE + 2, 10, 'digit'],
      [PROSE_LINE + 2, 16, 'digit'],
      [PROSE_LINE + 2, 17, 'percent'],
    ]);
  });
});

describe('`C-03` область запрета — ТОЛЬКО проза (C7, ADR-0002 §3)', () => {
  it('цифры внутри `[pause: 400ms]` линт не видит', () => {
    expect(lint('They waited. [pause: 400ms] Then the horns came.')).toEqual([]);
  });

  it('цифры в имени якоря `[beat: take2]` и в id сцены линт не видит', () => {
    const text = ['schema: source-dialect/1', '', '# chapter: main2', '', '## scene: intro7', '', 'A word [beat: take2] and another.'].join('\n');
    expect(lintProse(parse(text))).toEqual([]);
  });

  it('display-часть `[say:]` может содержать что угодно — линт туда не заглядывает', () => {
    expect(lint('A [say: **XIV** `Dr.` https://x.org 5% $9 № 1 | the whole zoo] here.')).toEqual([]);
  });
});

describe('`C-03` линт — отдельная функция над AST, а не часть парсера', () => {
  it('парсер принимает текст с цифрами и строит дамп; отвергает ЛИНТ', () => {
    const ast = parse(prose('In 1793 they came.'));
    expect(dumpAst(ast).length).toBeGreaterThan(0);
    expect(lintProse(ast)).toHaveLength(1);
  });

  it('`assertProse` бросает `SourceParseError` с правилом ADR-0002 §3 и местом первой ошибки', () => {
    const ast = parse(prose('In 1793 they came.', '', 'It cost $5.'));
    expect(() => { assertProse(ast); }).toThrow(SourceParseError);
    try {
      assertProse(ast);
      expect.unreachable('assertProse обязан был бросить');
    } catch (error) {
      const failure = error as SourceParseError;
      expect(failure.rule).toBe('ADR-0002 §3');
      expect(failure.location).toEqual({ file: FILE, line: PROSE_LINE, column: 4 });
      expect(failure.message.startsWith(`${FILE}:${String(PROSE_LINE)}:4: ADR-0002 §3: `)).toBe(true);
      // `1793` (цифра) + `$5.` (знак `$` и цифра) — три находки, а не три токена.
      expect(failure.message).toContain('всего нарушений в файле: 3');
    }
  });

  it('на чистой прозе `assertProse` молчит', () => {
    expect(() => { assertProse(parse(prose('The morning began the same way.'))); }).not.toThrow();
  });
});

describe('`C-03` границы правил — то, что НЕ ловится, названо явно', () => {
  it('`I` пропускается по длине — местоимение частотнее любого римского числа', () => {
    expect(lint('I came and I saw.')).toEqual([]);
  });

  it('одиночные `V`, `X`, `C` пропускаются тем же правилом длины — осознанно', () => {
    expect(lint('Point V and point X and point C.')).toEqual([]);
  });

  it('капсовая аббревиатура из тех же букв краснеет — принятая цена решения владельца', () => {
    expect(only(lint('The DVD came later.'), 'roman').location.column).toBe(5);
  });

  it('`etc.` и `vs.` проходят: список сокращений закрыт восемью словами', () => {
    expect(lint('Ships and horns and cargo etc. came.')).toEqual([]);
    expect(lint('It was town vs. harbour that year.')).toEqual([]);
  });

  it('голый `example.org` не ловится: «точка между буквами» неотличима от сокращения', () => {
    expect(lint('The archive at example.org holds them.')).toEqual([]);
  });

  it('`www.` и `mailto:` ловятся как URL', () => {
    expect(only(lint('Read www.example.org for more.'), 'url').location.column).toBe(6);
    expect(only(lint('Write mailto:keeper@example.org today.'), 'url').location.column).toBe(7);
  });

  it('маркер списка ловится только в колонке 1: дефис в середине строки — проза', () => {
    expect(lint('A well-known co-founder came - and left.')).toEqual([]);
  });
});

describe('`C-03` фикстура и доля токенов под линтом (долг SP-2 №7)', () => {
  const ast = parseSource(readFixture(), { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });

  it('`fixtures/minimal/source/01-intro.md` — зелёная: ни одного нарушения прозы', () => {
    expect(lintProse(ast)).toEqual([]);
  });

  it('доля токенов под `[say:]` измерена и напечатана — порога здесь нет', () => {
    const share = lintShare(ast);
    expect(share.tokens).toBe(167);
    expect(share.say).toBe(3);
    expect(share.prose).toBe(164);
    // Измерение, а не порог: порог (~2 %) живёт в Charter V5 и roadmap §7.3 №7.
    expect(share.share).toBeCloseTo(3 / 167, 12);
  });
});
