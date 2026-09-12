// **ЗАПИСЬ ГЕЙТА КАЖДОГО ШАБЛОНА СНЯТА НА КОМПОЗИЦИИ ЕГО ТЕКУЩЕГО ЗАПРОСА (долг №290).**
//
// ═══ ЧТО ЭТО МЕРИТ И ПОЧЕМУ ЭТОГО НЕ ДЕЛАЛ НИКТО ═══
// Вход **R12** сверяет пару (профиль, `engineFingerprint`) и класс записи, а `bundleHash`
// сверить ему НЕЧЕМ: композицию собирает адаптер, и на момент вопроса её ещё нет (долг №196).
// Отсюда дыра, названная вслух в `gate-runbook` §0-bis: устаревшая запись пропускает сборку
// МОЛЧА — правка кода шаблона или `runtime.js` двигает `bundle.hash`, а `engineFingerprint`
// считается по версиям ВНЕШНИХ зависимостей и не двигается.
//
// **ЭТОТ ФАЙЛ — ПОЛОВИНА №196, И ИМЕННО ТА, КОТОРАЯ ДЕШЕВА.** Полный №196 требует сверки на
// СБОРКЕ, то есть подачи `bundleHash` во вход R12. Здесь спрашивается то же самое, но НА
// ПРОГОНЕ ТЕСТОВ и по файлам, которые оба лежат в git: `gates.json` несёт `bundleHash` каждой
// записи, `gate-requests/<профиль>.json` несёт `bundle.hash` запроса, которым эту запись
// снимали. Расхождение означает ровно одно — «запись снята на другой композиции», то есть
// переснимать.
//
// ПОЧЕМУ ПО ФАЙЛАМ, А НЕ ПО ПРОГОНУ ГЕЙТА. Прогон стоит браузера и минут; файлы стоят чтения.
// И предмет у них разный: гейт отвечает «повторяется ли шаблон», этот тест — «про ТУ ЛИ
// композицию говорит коммитнутая запись».
//
// ЧИСЛА ИЗМЕРЕНИЯ, ЗАКРЫВШЕГО №290 (2026-09-12): у `video@1` `bundleHash` записей
// `draftHalf`/`final` — `bb741de5…`/`99f8a109…`, и это ровно `bundle.hash` текущих запросов.
// Правка манифеста (`videoHoles` перестал писаться пустым) композицию `video@1` НЕ тронула:
// поле у него непустое.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GATES_FILE_NAME, GATE_REQUESTS_DIR, gateRequestFileName, parseTemplateDirName } from '../src/index.js';

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/templates',
);

interface GatesFileShape {
  readonly entries: readonly { readonly profileId: string; readonly bundleHash: string }[];
}

interface RequestShape {
  readonly bundle: { readonly hash: string };
}

/** Папки шаблонов библиотеки — те же, по которым идёт генератор реестров. */
function templateDirs(): readonly string[] {
  return readdirSync(TEMPLATES_DIR)
    .filter((name) => statSync(path.join(TEMPLATES_DIR, name)).isDirectory())
    .filter((name) => parseTemplateDirName(name) !== null)
    .sort();
}

/**
 * Шаблоны БЕЗ `gates.json` — закрытый список, а не «пропустим, если нет файла».
 *
 * `bed@1` — аудио-домена: в `RenderIR.clips` он не попадает никогда, значит и композиции у
 * него нет, значит гейт снимать не с чего (долг №189). Список закрыт НАМЕРЕННО: шаблон,
 * потерявший записи гейта, обязан краснеть здесь, а не молча выпасть из проверки.
 */
const WITHOUT_GATES = new Set(['bed@1']);

describe('№290: `bundleHash` записи гейта == `bundle.hash` текущего запроса', () => {
  it('в библиотеке есть шаблоны — иначе проверять нечего', () => {
    expect(templateDirs().length).toBeGreaterThan(0);
  });

  it('без `gates.json` остались РОВНО известные шаблоны — список закрыт', () => {
    const missing = templateDirs().filter(
      (name) => !existsSync(path.join(TEMPLATES_DIR, name, GATES_FILE_NAME)),
    );
    expect(
      missing,
      'шаблон без записей гейта: либо гейт не снят (тогда сборка с ним не стартует — **R12**), ' +
        'либо он аудио-домена и его надо назвать в `WITHOUT_GATES` с причиной',
    ).toEqual([...WITHOUT_GATES]);
  });

  for (const dirName of templateDirs()) {
    if (WITHOUT_GATES.has(dirName)) continue;
    it(`${dirName}: каждая запись снята на композиции своего запроса`, () => {
      const dir = path.join(TEMPLATES_DIR, dirName);
      const gates = JSON.parse(
        readFileSync(path.join(dir, GATES_FILE_NAME), 'utf8'),
      ) as GatesFileShape;

      // Записей у шаблона две — `draftHalf` и `final`; меньше означало бы, что гейт снят
      // не на обеих парах, и это ловит другой охранник. Здесь важно, чтобы КАЖДАЯ
      // существующая запись нашла свой запрос: запись без запроса — запись ниоткуда.
      expect(gates.entries.length, `у \`${dirName}\` нет ни одной записи гейта`).toBeGreaterThan(0);

      for (const entry of gates.entries) {
        const requestPath = path.join(dir, GATE_REQUESTS_DIR, gateRequestFileName(entry.profileId));
        const request = JSON.parse(readFileSync(requestPath, 'utf8')) as RequestShape;
        expect(
          entry.bundleHash,
          `запись \`${entry.profileId}\` шаблона \`${dirName}\` снята на композиции ` +
            `\`${entry.bundleHash.slice(0, 12)}…\`, а текущий запрос ` +
            `(${path.relative(TEMPLATES_DIR, requestPath)}) собирает ` +
            `\`${request.bundle.hash.slice(0, 12)}…\`. Это значит «переснять гейт» ` +
            '(`docs/gate-runbook.md` §1), а не «поправить файл руками»',
        ).toBe(request.bundle.hash);
      }
    });
  }
});
