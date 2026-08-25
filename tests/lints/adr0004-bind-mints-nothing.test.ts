// ADR-0004 §4 — **стадия `bind` якорей НЕ МИНТИТ, она их СВЯЗЫВАЕТ** (`V-05`).
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНОЕ ПРАВИЛО, А НЕ СЛЕДСТВИЕ D4. Минт идентификатора якоря — единственный
// законный недетерминизм модели (ADR-0004 §4: 128 бит CSPRNG, `core-model/src/anchors/mint.ts`),
// и охранник D4 (`tests/lints/d4-crypto-mint.test.ts`) стережёт ровно его: `node:crypto`
// живёт в одном файле. Но идентификатор можно СОБРАТЬ БЕЗ CRYPTO — строкой из порядкового
// номера, — и D4 этого не увидит. Ровно так и было до `V-05`: `makeTake` собирал якоря
// из индекса токена, и в коммитимый take-файл уезжали адреса, которых нет ни в одном ledger'е.
// Дефект того же класса, что нулевой `leadInSamples` до `V-04` (долг №85): значение выразимо,
// выглядит настоящим, проверить его нечем.
//
// ЧТО ИМЕННО ЗАПРЕЩЕНО В `packages/voice/src/bind/**`:
//   (1) звать минт (`mintAnchorId`) — якоря приходят входом, из ledger'а `C-04`;
//   (2) импортировать `node:crypto` или звать `randomBytes` — своего источника случайности
//       у стадии нет и быть не может;
//   (3) СОБИРАТЬ строку, начинающуюся с пространства якоря, — ни шаблоном, ни конкатенацией.
// Разрешено ровно одно: читать `anchorId` у пришедшей ссылки и класть его в привязку.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

const BIND_DIR = '/src/bind/';

/** Файлы стадии. Найдены обходом, а не перечислены: новый файл каталога попадает под правило. */
const bindFiles = (): string[] => sourceFiles('voice').filter((file) => file.includes(BIND_DIR));

/** Три запрещённые формы. Имя каждой печатается в отказе — чтобы было видно, что именно нашли. */
const FORBIDDEN = [
  { what: 'вызов минта', pattern: /\bmintAnchorId\b/ },
  { what: 'источник случайности', pattern: /node:crypto|\brandomBytes\b|\bcsprng\b/ },
  // Литерал пространства якоря в КОДЕ (комментарии сняты `codeLines`): `'w:'`, `` `w:${…}` ``,
  // `"w:" +`. Именно так выглядит собранный руками адрес.
  { what: 'сборка идентификатора якоря', pattern: /['"`]w:/ },
] as const;

describe('`bind` не порождает якорей — только связывает пришедшие', () => {
  it('каталог стадии существует и найден обходом, а не списком имён', () => {
    expect(bindFiles().length, 'каталог `bind/` не найден — правило зеленело бы на пустоте').toBeGreaterThan(0);
  });

  it('ни одной из трёх запрещённых форм в `bind/**` нет', () => {
    const offenders: string[] = [];
    for (const file of bindFiles()) {
      codeLines(readSource(file)).forEach((line, index) => {
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(line)) {
            offenders.push(`${file}:${String(index + 1)} (${rule.what}): ${line.trim()}`);
          }
        }
      });
    }
    expect(
      offenders,
      `стадия \`bind\` порождает якоря вместо того, чтобы их связывать:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('минт при этом ЕСТЬ и живёт там, где положено (правило охраняет адрес, а не отсутствие)', () => {
    const mint = 'packages/core-model/src/anchors/mint.ts';
    expect(sourceFiles('core-model')).toContain(mint);
    expect(readSource(mint)).toContain('mintAnchorId');
  });

  it('стадия ЧИТАЕТ якорь пришедшей ссылки — иначе привязки были бы без адреса', () => {
    const all = bindFiles().map((file) => codeLines(readSource(file)).join('\n')).join('\n');
    expect(all).toContain('anchorId');
  });

  it('`makeTake` больше не собирает якорь из номера токена (правка `V-05`)', () => {
    // Отдельная строка, потому что это найденное нарушение, а не гипотеза: до `V-05` в
    // `mock.ts` стояло `anchorId: \`w:${String(i)}\``, и ни один охранник этого не ловил.
    const mock = readSource('packages/voice/src/providers/mock.ts');
    const offenders = codeLines(mock).filter((line) => /['"`]w:/.test(line));
    expect(offenders, `подделка якоря вернулась в mock:\n${offenders.join('\n')}`).toEqual([]);
  });
});
