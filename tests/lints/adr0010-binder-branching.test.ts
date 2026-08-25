// ADR-0010 §5 — ветвление по ВОЗМОЖНОСТЯМ И ПОЛЯМ биндера, а не по его имени (`V-05`).
//
// Правило то же, что **V16** для провайдера, и заведено по тому же доводу: интерфейс `Binder`
// вводится сразу — «он стоит 10 строк, а без него переход на второй binder становится
// хирургией по Timeline» (roadmap §4.5). Первое же `if (binderId === 'provider-timestamps@1')`
// эту десятку строк обесценивает: биндеров снова два частных случая, и акустический
// (`ctc-fa@1`/`mfa@3`, `A-03`) окажется правкой всех читателей привязок.
//
// Охранник ДВОЙНОЙ, и половины ловят разное — измерено на провайдерах (`V-01`, нарушения 8 и 10):
//   (а) ESLint (`CAPABILITY_SYNTAX` в `eslint.config.js`) — ФОРМА сравнения. Селектор видит
//       синтаксис, поэтому не краснеет на строке ADR в JSDoc и краснеет на `switch`, который
//       греп от обычного слова не отличит;
//   (б) греп по коду — ЛИТЕРАЛ имени биндера. Он ловит то, чего селектор не видит: таблицу
//       «имя → поведение», реестр биндеров, строку в конфиге.
//
// РЕЕСТР ФАЙЛОВ, КОТОРЫМ ЛИТЕРАЛ РАЗРЕШЁН, — ровно один: тот, что ОБЪЯВЛЯЕТ свой id.
// Пополняется задачей `A-03` (акустический биндер).

import { describe, expect, it } from 'vitest';

import { PACKAGES, codeLines, errorsFor, lintTemporary, readSource, sourceFiles } from '../boundaries/repo';

const RULE = 'no-restricted-syntax';
const EXPECT = 'ADR-0010 §5';

/** Единственный файл, которому разрешено писать имя биндера литералом. */
const REGISTRY = ['packages/voice/src/bind/provider-timestamps.ts'];

/** Сосед по каталогу: он обязан остаться ПОД правилом, иначе реестр не узкий. */
const NEIGHBOUR = 'packages/voice/src/bind/rebind.ts';

/**
 * Какие именно строки считать «именем биндера».
 *
 * НЕ РЕГУЛЯРКА ВИДА `имя@N`, И ЭТО НАЙДЕНО ИЗМЕРЕНИЕМ: под неё подпадают `still@1` (шаблон
 * `[img:]`, `C-04`), `tts-pipeline@1` и `identity@1` (слагаемые `voiceKey`, `V-03`) — четыре
 * ложных срабатывания на трёх чужих правилах. Поэтому имена БЕРУТСЯ ИЗ РЕЕСТРА: что объявил
 * файл-объявитель, то и запрещено повторять всем остальным. Правило при этом само
 * поддерживается: новый биндер (`A-03`) объявит свой id в своём файле, реестр пополнится
 * одной строкой, и запрет распространится на новое имя без правки регулярки.
 */
function declaredBinderIds(): string[] {
  const out = new Set<string>();
  for (const file of REGISTRY) {
    for (const line of codeLines(readSource(file))) {
      for (const match of line.matchAll(/'([a-z][a-z0-9-]*@\d+)'/g)) {
        const id = match[1];
        if (id !== undefined) out.add(id);
      }
    }
  }
  return [...out].sort();
}

function offenders(): string[] {
  const ids = declaredBinderIds();
  const out: string[] = [];
  for (const pkg of PACKAGES) {
    for (const file of sourceFiles(pkg)) {
      if (REGISTRY.includes(file)) continue;
      for (const [index, line] of codeLines(readSource(file)).entries()) {
        if (ids.some((id) => line.includes(id))) out.push(`${file}:${String(index + 1)} — ${line.trim()}`);
      }
    }
  }
  return out;
}

describe('(а) ESLint — сравнение по имени биндера роняет линт', () => {
  it('`b.binderId === "provider-timestamps@1"` — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__binder_probe_member__.ts',
        source: 'export const a = (b: { binderId: string }): boolean => b.binderId === "provider-timestamps@1";\n',
      },
    ]);
    const errors = errorsFor(messages, RULE);
    expect(
      errors.length,
      'Охранник ADR-0010 §5 молчит на прямом нарушении: селектор выпал из `CAPABILITY_SYNTAX`.',
    ).toBeGreaterThan(0);
    expect(errors.map((error) => error.message).join('\n')).toContain(EXPECT);
  });

  it('голый идентификатор `binderId` с любой стороны сравнения — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__binder_probe_ident__.ts',
        source: 'export const b = (binderId: string): boolean => "ctc-fa@1" !== binderId;\n',
      },
    ]);
    expect(errorsFor(messages, RULE).length, 'сторона сравнения не должна спасать').toBeGreaterThan(0);
  });

  it('`switch` по имени биндера — ошибка (грепом эта форма не ловится)', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__binder_probe_switch__.ts',
        source:
          'export function c(b: { binderId: string }): number {\n'
          + '  switch (b.binderId) {\n'
          + '    case "provider-timestamps@1":\n'
          + '      return 1;\n'
          + '    default:\n'
          + '      return 0;\n'
          + '  }\n'
          + '}\n',
      },
    ]);
    expect(errorsFor(messages, RULE).length, '`switch` обязан краснеть').toBeGreaterThan(0);
  });

  it('ЧТЕНИЕ `binderId` (запись в артефакт) правилом НЕ запрещено', async () => {
    // Иначе охранник запретил бы то, ради чего поле существует: «чем измерено» обязано
    // попасть в take-файл. Запрещено СРАВНЕНИЕ, а не обращение к полю.
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__binder_probe_read__.ts',
        source: 'export const d = (b: { binderId: string }): { id: string } => ({ id: b.binderId });\n',
      },
    ]);
    expect(errorsFor(messages, RULE).length).toBe(0);
  });
});

describe('(б) греп — литерал имени биндера живёт только в файле, который его объявляет', () => {
  it('во всех восьми пакетах, кроме реестра, литерала нет', () => {
    expect(offenders(), `имя биндера утекло из реестра:\n${offenders().join('\n')}`).toEqual([]);
  });

  it('реестр не пуст и указывает на существующий файл, который И объявляет id', () => {
    const declaring = REGISTRY[0] ?? '';
    expect(sourceFiles('voice')).toContain(declaring);
    // Без этой строки правило зеленело бы на пустом списке имён: «нечего искать» — не
    // «ничего не найдено». Дефолтный биндер v1 назван ADR-0010 §5 поимённо.
    expect(declaredBinderIds()).toContain('provider-timestamps@1');
  });

  it('сосед по каталогу под правилом: литерала у него нет', () => {
    const ids = declaredBinderIds();
    const lines = codeLines(readSource(NEIGHBOUR));
    expect(lines.filter((line) => ids.some((id) => line.includes(id)))).toEqual([]);
  });

  it('правило не пусто: греп действительно обходит файлы пакета `voice`', () => {
    expect(sourceFiles('voice').some((file) => file.includes('/bind/'))).toBe(true);
  });
});
