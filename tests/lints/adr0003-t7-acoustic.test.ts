// Четыре грепа акустической обрезки T7 (`V-04`). Каждый ловит форму кода, а не сегодняшний
// результат: поведенческие тесты лежат в `packages/voice/test/edges.test.ts`.
//
// (а) ПАРАМЕТРОВ ДЕТЕКТОРА В КОДЕ НЕТ (ADR-0003 T7, `audio-profile/1`). Числа `240` и `−45`
//     живут в профиле, и комментарий профиля привязывает их к ПАРЕ (голос, модель):
//     «инвалидируются при смене любого из двух». Литерал в коде пережил бы смену голоса молча.
//     Прецедент правила и цена его отсутствия — находка протокола `V-02`: умолчание параметра
//     порогов оставляло зелёными ВСЕ 103 теста пакета, потому что тесты проверяли, что значение
//     ЧИТАЕТСЯ, а не то, что его обязаны передать. Поэтому вторая половина грепа — «умолчания
//     у параметра нет».
//
// (б) ДЕТЕКТОР НЕ СМОТРИТ В ТАЙМКОДЫ И НЕ РЕЖЕТ БАЙТЫ. Первое — существо переписанного T7:
//     `FACT` (SP-2 U4.3) по таймкодам провайдера лид-ин тождественно нулевой (`start[0] = 0`
//     на 56 строках из 56), и обращение к `alignment` вернуло бы ровно ту ошибку, ради снятия
//     которой T7 переписан. Второе — граница задачи: `V-04` ИЗМЕРЯЕТ, а режет и кладёт краевой
//     фейд тот, кто строит дорожку (`CP-01`/`CP-05`); фейд ещё и здесь был бы ПЕРВЫМ ИЗ ДВУХ,
//     а двойной фейд ADR-0003 T7 запрещает («внутри уже отведённого интервала»).
//
// (в) ХВОСТОВОЙ АССЕРТ НЕ ВЫРАЖЕН ЛИТЕРАЛОМ. Действующая редакция T7 — `end[last] ≤ numSamples
//     + ⌈sampleRate/1000⌉`, и сравнение с нулём означало бы возврат к ЗАЧЁРКНУТОЙ форме, которая
//     отвергала бы 12 живых дублей из 28 у Daniel и 13 из 28 у Michael.
//
// (г) КРАЯ В TAKE-ФАЙЛЕ — ИЗМЕРЕНИЕ, А НЕ ВХОД (долг №85). Пока `leadInSamples`/`tailSamples`
//     приходили параметром укладки, ноль был законным входом в КОММИТИМЫЙ артефакт, тогда как
//     настоящий лид-ин живого голоса — 95–100 мс. Поведенческий тест этого не поймает: он
//     проверяет ЗНАЧЕНИЯ, а вернуть поле-вход можно вместе с правкой тестов.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

const DETECTOR = 'packages/voice/src/edges/speech-edges.ts';
const DRIFT = 'packages/voice/src/edges/drift.ts';
const HEALTH = 'packages/voice/src/acceptance/health.ts';
const TIME = 'packages/voice/src/providers/time.ts';
const RECORD = 'packages/voice/src/plan/record.ts';

const edgeFiles = (): string[] => sourceFiles('voice').filter((file) => file.includes('/edges/'));

const code = (relPath: string): string[] => codeLines(readSource(relPath));

/** Строки файла с номерами, без комментариев. */
const numbered = (relPath: string): { line: string; number: number }[] =>
  code(relPath).map((line, index) => ({ line, number: index + 1 }));

describe('`V-04` (а): параметры детектора приходят из профиля, а не из кода', () => {
  it('модуль найден обходом дерева, а не списком имён', () => {
    expect(edgeFiles()).toContain(DETECTOR);
    expect(edgeFiles()).toContain(DRIFT);
  });

  it('ни `240`, ни `−45` не встречаются в коде модуля ни разу', () => {
    const offenders: string[] = [];
    for (const file of edgeFiles()) {
      for (const { line, number } of numbered(file)) {
        if (/(^|[^\w.])240\b/.test(line) || /-\s*45\b/.test(line)) {
          offenders.push(`${file}:${String(number)}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      'параметры `speechEdges` живут в `audio-profile/1` и привязаны к паре (голос, модель): ' +
        'литерал в коде пережил бы смену голоса молча, а числа SP-2 стали бы несравнимы.',
    ).toEqual([]);
  });

  it('у параметра `SpeechEdgesParams` нет умолчания ни в одной сигнатуре', () => {
    const offenders: string[] = [];
    for (const file of [...edgeFiles(), RECORD]) {
      for (const { line, number } of numbered(file)) {
        if (/SpeechEdgesParams\s*=/.test(line)) offenders.push(`${file}:${String(number)}`);
      }
    }
    expect(
      offenders,
      'умолчание параметра — вторая запись профиля (находка протокола `V-02`: тесты проверяли, ' +
        'что значение читается, но не то, что его обязаны передать).',
    ).toEqual([]);
  });

  it('диапазон дрейфа объявлен ОДИН раз и помечен `FACT`', () => {
    const declarations = numbered(DRIFT).filter(({ line }) => /LEAD_IN_RANGE_MS\s*=/.test(line));
    expect(declarations).toHaveLength(1);
    expect(readSource(DRIFT)).toContain('`FACT`');
    expect(readSource(DRIFT)).toContain('sp2-closure.md');
  });
});

describe('`V-04` (б): детектор не смотрит в таймкоды и не режет байты', () => {
  it('в модуле нет ни одного упоминания alignment и его массивов', () => {
    const forbidden = [
      'alignment',
      'character_start_times_seconds',
      'character_end_times_seconds',
      'ProviderAlignment',
      'providerSecondsToSamples',
      'TokenBinding',
    ];
    const offenders: string[] = [];
    for (const file of edgeFiles()) {
      const source = code(file).join('\n');
      for (const name of forbidden) {
        if (new RegExp(`\\b${name}\\b`).test(source)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(
      offenders,
      'T7 после SP-2 режет по АКУСТИКЕ: по таймкодам лид-ин тождественно нулевой (56/56), и ' +
        'детектор, заглянувший в alignment, воспроизвёл бы ровно ту ошибку, ради снятия ' +
        'которой правило переписано.',
    ).toEqual([]);
  });

  it('модуль не применяет фейд и не строит новых дорожек', () => {
    const forbidden = ['applyEdgeFade', 'pcmS16', 'bytesFromPcm', 'crossfadeSamples'];
    const offenders: string[] = [];
    for (const file of edgeFiles()) {
      const source = code(file).join('\n');
      for (const name of forbidden) {
        if (new RegExp(`\\b${name}\\b`).test(source)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(
      offenders,
      '`V-04` измеряет, а не режет: байты дубля лежат в CAS сырыми, интервал речи вырезает ' +
        '`CP-01`/`CP-05`, а фейд — момент постройки дорожки (`M-03`, решение владельца A). ' +
        'Фейд здесь стал бы первым из двух, а двойной фейд T7 запрещает.',
    ).toEqual([]);
  });

  it('укладка зовёт детектор, а не применяет к дублю фейд', () => {
    const source = code(RECORD).join('\n');
    expect(source).toMatch(/\bspeechEdges\(/);
    expect(source).not.toMatch(/\bapplyEdgeFade\b/);
  });
});

describe('`V-04` (в): хвостовой ассерт несёт допуск, а не ноль', () => {
  it('сравнение хвоста в приёмке идёт с допуском, а не с нулём', () => {
    const comparisons = numbered(HEALTH).filter(({ line }) => /tailResidualSamples\s*</.test(line));
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.line).toContain('tailSlop');
    expect(comparisons[0]?.line).toMatch(/<\s*-\s*tailSlop\b/);
    expect(
      comparisons[0]?.line,
      'ЗАЧЁРКНУТАЯ редакция T7 (`end[last] ≤ numSamples`) отвергала бы 12 живых дублей из 28 ' +
        'у Daniel и 13 из 28 у Michael при превышении до 12 сэмплов.',
    ).not.toMatch(/tailResidualSamples\s*<\s*0\b/);
  });

  it('допуск вычисляется ровно в одном месте пакета', () => {
    const definitions = sourceFiles('voice').filter(({ length }) => length > 0).filter((file) =>
      /export function tailResidualSlopSamples/.test(readSource(file)),
    );
    expect(definitions).toEqual([TIME]);
  });

  it('сам допуск ВЫЧИСЛЯЕТСЯ, а не записан числом', () => {
    // НАХОДКА ПРОТОКОЛА `V-04` (нарушение #07): подмена `tailResidualSlopSamples(sampleRate)`
    // на литерал `24` оставляла греп зелёным (в строке сравнения по-прежнему стоит `tailSlop`),
    // а поведение при 24 кГц не менялось вовсе — красным становился только компилятор, и
    // только потому, что импорт осиротел. Достаточно было использовать импорт где-нибудь ещё,
    // и «порог, записанный числом» проехал бы весь контур молча — ровно то, что запрещает
    // правило «порогов в этом файле нет ни одного» (шапка `acceptance/health.ts`).
    const definitions = numbered(HEALTH).filter(({ line }) => /\btailSlop\s*=/.test(line));
    expect(definitions).toHaveLength(1);
    expect(
      definitions[0]?.line,
      'допуск обязан вычисляться от `sampleRate`: число в коде совпало бы с истиной ровно на ' +
        'одной частоте и разошлось бы с ней молча на любой другой.',
    ).toContain('tailResidualSlopSamples(');
  });

  it('допуск не переписан вторым выражением: `ceilDiv` в пакете зовётся один раз', () => {
    const users = sourceFiles('voice').filter((file) => /\bceilDiv\(/.test(code(file).join('\n')));
    expect(users).toEqual([TIME]);
  });
});

describe('`V-04` (г): края take-файла — измерение, а не вход укладки (долг №85)', () => {
  it('у входа укладки нет поля готовых краёв', () => {
    const source = code(RECORD).join('\n');
    expect(source).toMatch(/readonly speechEdges: SpeechEdgesParams;/);
    expect(
      /readonly edges:\s*SpeechEdges\b/.test(source),
      'поле-вход вернуло бы возможность записать в коммитимый артефакт измерение, которого не ' +
        'было: `FACT` (SP-2 U4.3) настоящий лид-ин — 95–100 мс, а ноль был бы ложью.',
    ).toBe(false);
  });

  it('оба края take-файла берутся у измерения, а не у входа', () => {
    const offenders = numbered(RECORD)
      .filter(({ line }) => /^\s*(leadInSamples|tailSamples):/.test(line))
      .filter(({ line }) => !/recorded\.edges\./.test(line));
    expect(offenders.map(({ number }) => number)).toEqual([]);
  });

  it('дрейф — поле результата укладки, а не поле дубля', () => {
    const takeFile = readSource('packages/voice/src/plan/take-file.ts');
    expect(code(RECORD).join('\n')).toContain('readonly edgeDrift: EdgeDrift;');
    expect(takeFile).not.toContain('edgeDrift');
    expect(readSource('packages/voice/src/providers/types.ts')).not.toContain('edgeDrift');
  });
});
