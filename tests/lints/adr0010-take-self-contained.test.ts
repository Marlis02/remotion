// ADR-0010 §2 / core.md §18.3 п. 6 — **дубль самоописателен**: привязки пересчитываются из
// одного take-файла, БЕЗ старого нормализатора (`V-05`, критерий готовности roadmap §4.5).
//
// ЧТО ОХРАНЯЕТСЯ ЗДЕСЬ И ПОЧЕМУ ЭТОГО НЕ ДЕЛАЕТ САМ ТЕСТ. Поведенческая половина —
// `packages/voice/test/bind-take.test.ts`: take-файл читается с диска, блоб берётся из CAS по
// его же `pcm.sha256`, привязки пересчитываются и сверяются с записанными. Но зелёный такой
// тест не доказывает САМОДОСТАТОЧНОСТИ: допиши в него одну строку `parseSource(raw, …)` — и он
// продолжит зеленеть, проверяя при этом путь, которому исходник всё ещё нужен. Утверждение
// «входов ХВАТАЕТ» проверяется только тем, что лишних входов в пути НЕТ, а это свойство
// ТЕКСТА теста, а не его результата.
//
// ВТОРАЯ ПОЛОВИНА ПРАВИЛА — В `src`: сам пересчёт (`bind/rebind.ts`) не имеет права звать
// разбор исходника, нормализатор или план. Ему нечем: `voice` их и не видит, — но `bind/`
// видит `plan/`, и `rebindTake`, позвавший `speechPlan`, был бы выразим.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

/** Тест самодостаточности: путь пересчёта проходит через него целиком. */
const TEST = 'packages/voice/test/bind-take.test.ts';

/** Файл пересчёта. */
const REBIND = 'packages/voice/src/bind/rebind.ts';

/**
 * Имена, присутствие которых означает «пересчёт опирается не только на файл».
 *
 * `parseSource`/`sourceText` — разбор исходника; `transduce*` — нормализатор `[say:]` (`C-03`);
 * `speechPlan`/`tokensOfPlan` — стадия плана; `syncLedger` — ledger якорей.
 */
const FORBIDDEN = ['parseSource', 'transduceChunk', 'transduceDocument', 'speechPlan', 'tokensOfPlan', 'syncLedger'];

/** Строки блока самодостаточности теста — от его `describe` до конца файла. */
function selfContainedBlock(): string[] {
  const lines = codeLines(readSource(TEST));
  const start = lines.findIndex((line) => line.includes("describe('самодостаточность"));
  expect(start, `в ${TEST} нет блока «самодостаточность» — правило потеряло предмет`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('describe('));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('пересчёт привязок опирается только на take-файл и байты CAS', () => {
  it('в блоке самодостаточности нет ни разбора исходника, ни нормализатора, ни плана', () => {
    const block = selfContainedBlock();
    const offenders: string[] = [];
    block.forEach((line, index) => {
      for (const name of FORBIDDEN) {
        if (line.includes(name)) offenders.push(`строка ${String(index + 1)} (${name}): ${line.trim()}`);
      }
    });
    expect(
      offenders,
      'тест самодостаточности зовёт то, чего у старого проекта может не быть:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });

  it('блок не пуст и действительно зовёт пересчёт', () => {
    const block = selfContainedBlock().join('\n');
    expect(block.includes('rebindTake'), 'блок не зовёт `rebindTake` — правило зеленеет на пустоте').toBe(true);
    expect(block.includes('readTake'), 'блок не читает файл с диска').toBe(true);
  });

  it('сам `rebindTake` тоже не зовёт ни разбора, ни плана', () => {
    expect(sourceFiles('voice')).toContain(REBIND);
    const lines = codeLines(readSource(REBIND));
    const offenders = lines.filter((line) => FORBIDDEN.some((name) => line.includes(name)));
    expect(offenders, `пересчёт опирается не только на файл:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('`rebindTake` берёт токены и alignment ИЗ ФАЙЛА, а не из параметров', () => {
    const code = codeLines(readSource(REBIND)).join('\n');
    expect(code).toContain('bind.tokens');
    expect(code).toContain('bind.providerAlignment');
  });
});
