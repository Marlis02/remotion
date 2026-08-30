// **V8 / D9** — часы читаются в объявленных местах, и сегодня таких мест НОЛЬ.
//
// ПОЧЕМУ РЕЕСТР, А НЕ ПРОСТО ЗАПРЕТ (поправка владельца, `M-01`). Голый запрет на
// `packages/*/src/**` — правило без будущего: `now` обязан откуда-то войти в сборку
// (ADR-0007 §4: «`now` — вход сборки (BuildRecord), внутри compile его нет»), и в день, когда
// `L-01` заведёт эту единственную точку входа, голый запрет пришлось бы просто снять. Вместо
// этого правило устроено как охранник `node:crypto` из `C-04`: запрет + ИМЕНОВАННЫЙ реестр
// исключений. Сейчас реестр пуст, и это утверждение, а не умолчание.
//
// ~~ЧТО ЗАПИСАНО ЗАРАНЕЕ. Когда `L-01` добавит файл, он появится в двух местах…~~
// *(изменено: `L-01`, 2026-08-30 — ОЖИДАНИЕ НЕ СБЫЛОСЬ, и это сильнее ожидавшегося.)*
// `vpe build` написан, `now` у него вход — и реестр остался ПУСТ: точка входа часов оказалась
// не файлом движка, а значением. Часы читает `packages/cli/bin/vpe.ts` (вторая граница
// процесса, перечислена охранником `d4-clock-boundary.test.ts`), команда берёт момент в
// порядке `--now` → `VPE_NOW` → часы `bin`, а стадии получают его параметром. Реестр здесь
// по-прежнему проверяется ПОВЕДЕНИЕМ — пункт (в) ниже; если жилец всё же появится, он обязан
// выписаться и в `eslint.config.js`, и получить проверки «узкое» и «не мёртвое».
//
// ПОЧЕМУ ЭТО ЗАВЕДЕНО В `M-01`. Форма `store-lock/1 → lastVerifiedAt` объявляет момент
// проверки ВХОДОМ (`withLastVerifiedAt`, пишет `vpe store verify` — `L-02`). Без охранника
// «здесь никто не смотрит на часы» это было бы обещанием комментария.

import { describe, expect, it } from 'vitest';

import { PACKAGES, codeLines, errorsFor, lint, lintTemporary, readSource, sourceFiles, type LintMessage } from '../boundaries/repo';

/**
 * РЕЕСТР РАЗРЕШЁННЫХ ФАЙЛОВ. Пуст.
 *
 * Первый и, по замыслу ADR-0007 §4, единственный жилец — точка входа `now` в сборку
 * (`L-01`). Добавление файла сюда обязано сопровождаться исключением в `eslint.config.js` и
 * двумя проверками, описанными в шапке.
 */
const EXEMPT: readonly string[] = [];

/** Как в JS можно узнать текущее время. Пятого способа в стандартной библиотеке нет. */
const CLOCK = [
  { pattern: /\bDate\s*\.\s*now\s*\(/, name: 'Date.now()' },
  { pattern: /\bnew\s+Date\s*\(/, name: 'new Date()' },
  { pattern: /(?<![.\w])Date\s*\(/, name: 'Date()' },
  { pattern: /\bperformance\s*\.\s*now\s*\(/, name: 'performance.now()' },
];

const PROBE_SOURCE = 'export const t = Date.now();\n';
const PROBE_NEW_DATE = 'export const t = new Date().toISOString();\n';

/** Сообщения именно правила V8: у `no-restricted-*` текст задан константой конфига. */
function v8Errors(messages: LintMessage[]): LintMessage[] {
  return messages.filter((message) => message.severity === 2 && message.message.includes('ADR-0007 §4'));
}

describe('**V8 / D9** — реестр читателей часов', () => {
  it('реестр пуст: сегодня часы не читает ни один файл движка', () => {
    expect(
      EXEMPT,
      'В реестр добавлен файл. Проверьте, что исключение выписано и в `eslint.config.js`, ' +
        'и допишите сюда проверки «узкое» и «не мёртвое» — как у `node:crypto` в `C-04`.',
    ).toEqual([]);
  });

  it('(а) греп: ни в одном `packages/*/src/**` нет обращения к часам', () => {
    const offenders: string[] = [];
    for (const pkg of PACKAGES) {
      for (const file of sourceFiles(pkg)) {
        if (EXEMPT.includes(file)) continue;
        for (const [index, line] of codeLines(readSource(file)).entries()) {
          for (const clock of CLOCK) {
            if (clock.pattern.test(line)) offenders.push(`${file}:${String(index + 1)} — ${clock.name}`);
          }
        }
      }
    }
    expect(
      offenders,
      'Charter V8 / ADR-0007 §4: `now` — ВХОД сборки, а не вызов внутри неё. Возьмите момент ' +
        'параметром (как `withLastVerifiedAt` в `media/src/store/lock.ts`) либо внесите файл в ' +
        'реестр этого теста и в `eslint.config.js`. Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('(б) ESLint: `Date.now()` в продакшн-файле — ошибка, а не описание в конфиге', async () => {
    const messages = await lintTemporary([
      { relPath: 'packages/media/src/__clock_probe__.ts', source: PROBE_SOURCE },
    ]);
    expect(errorsFor(messages, 'no-restricted-properties').length, 'охранник молчит на прямом нарушении').toBeGreaterThan(0);
    expect(v8Errors(messages).length).toBeGreaterThan(0);
  });

  it('(б) ESLint: `new Date()` ловится отдельным правилом — синтаксисом, а не свойством', async () => {
    const messages = await lintTemporary([
      { relPath: 'packages/media/src/__clock_new_date_probe__.ts', source: PROBE_NEW_DATE },
    ]);
    expect(errorsFor(messages, 'no-restricted-syntax').length).toBeGreaterThan(0);
    expect(v8Errors(messages).length).toBeGreaterThan(0);
  });

  it('(в) реестр пуст ПО ПОВЕДЕНИЮ: правило срабатывает во всех восьми пакетах', async () => {
    // Именно так проверяется пустота реестра, а не чтением `eslint.config.js` глазами:
    // если бы у какого-то пакета было снятие, его пробник остался бы зелёным.
    const probes = PACKAGES.map((pkg) => ({
      relPath: `packages/${pkg}/src/__clock_probe__.ts`,
      source: PROBE_SOURCE,
    }));
    const messages = await lintTemporary(probes);
    expect(v8Errors(messages).length, 'какой-то пакет вышел из-под правила').toBe(PACKAGES.length);
  });

  it('(в) даже `voice` под правилом: ему снята СЕТЬ (M4), а не часы', async () => {
    const messages = await lintTemporary([
      { relPath: 'packages/voice/src/__clock_probe__.ts', source: PROBE_SOURCE },
    ]);
    expect(v8Errors(messages).length).toBeGreaterThan(0);
  });

  it('(г) контроль: в тестах репозитория правило снято — иначе этот файл был бы нарушителем', async () => {
    const messages = await lintTemporary([{ relPath: 'tests/lints/__clock_control__.ts', source: PROBE_SOURCE }]);
    expect(v8Errors(messages)).toEqual([]);
  });

  it('охранник стережёт непустое множество файлов', async () => {
    const files = PACKAGES.flatMap((pkg) => sourceFiles(pkg));
    expect(files.length).toBeGreaterThan(20);
    expect(v8Errors(await lint(['packages/media/src/store/lock.ts']))).toEqual([]);
  });
});
