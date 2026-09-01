// **РАЗБОР АРГУМЕНТОВ — РУКАМИ, БЕЗ БИБЛИОТЕКИ** (задание `E-00`; образец —
// `renderer-hyperframes/bin/render-segment.ts`).
//
// ПОЧЕМУ РУКАМИ. Лок не меняется этой задачей, а парсер аргументов — зависимость, которая
// тянет свою модель ошибок и своё представление о том, что такое «неизвестный флаг». Здесь
// нужен один разбор с ЗАКРЫТЫМИ списками (две команды, два профиля), и он умещается в файл,
// который читается целиком.
//
// НЕИЗВЕСТНЫЙ ФЛАГ — ОТКАЗ, А НЕ ИГНОР. `--profil final` (опечатка) при игноре дал бы гейт на
// умолчании: N = 10 вместо 3 или наоборот, то есть запись про другую пару. Молчание здесь
// стоило бы дороже отказа ровно на цену прогона.

import { GATE_PROFILES, type GateProfileId } from '@vpe/templates-spec';

import { AC4_PROFILE_ID, type BuildProfileId } from './ac4.js';
import { CliError, EXIT } from './errors.js';

/** `vpe template gate <id>@<N> --profile final|draftHalf --request <файл>`. */
export interface TemplateGateArgs {
  readonly command: 'template gate';
  /** Имя вызова шаблона, как его написал автор: `kenburns@1`, `local:kenburns@1`. */
  readonly template: string;
  readonly profileId: GateProfileId;
  /**
   * Файл `SegmentRenderRequest` — **фикстура шаблона** (ADR-0008 «Процедура», п. 1: «шаблон
   * вызывается с зафиксированными `params` на фикстуре шаблона»).
   *
   * Решение владельца (`E-00`, развилка 1): фикстура приезжает ФАЙЛОМ. Механизма «фикстура
   * шаблона» в проекте ещё нет — реализаций шаблонов нет до `H-06`, а сборка запроса из
   * проекта есть `vpe build` (`L-01`). Охранник против подмены — «все клипы запроса зовут
   * НАЗВАННЫЙ шаблон» (см. `template-gate.ts`).
   */
  readonly requestPath: string;
  /**
   * Файл `render-profile/1` — ПОЛНЫЙ профиль пары, включая параметры энкодера.
   *
   * ПОЧЕМУ ОН ОБЯЗАТЕЛЕН И ПОЧЕМУ ЕГО НЕ ЗАМЕНЯЕТ ЗАПРОС. Запрос рендерера несёт ТРИ поля
   * `pixelProfile` — те, что читает адаптер (`browserGpu`, `scale`, `imageFormat`, **K4**).
   * Кодирует кадры `media` полным профилем (кодек, crf, `gopSize`, `encoder.*`), и выдумать
   * его нельзя: `FACT` (SP-3 блок D, SP-3d §4.3) `threads=1` и `threads=4` дают РАЗНЫЕ
   * битстримы на одном входе — то есть выдуманный энкодер дал бы `sha256` про другой файл.
   * Сверх того файл делает пару ПРОВЕРЯЕМОЙ: его `profileId` обязан совпасть с `--profile`.
   */
  readonly renderProfilePath: string;
  /** Куда класть/откуда читать записи. `null` — каталог библиотеки рядом со спеками. */
  readonly gatesDir: string | null;
  /** Рабочий каталог прогонов гейта. `null` — свежий каталог в `tmpdir()`. */
  readonly runRoot: string | null;
}

/**
 * `vpe build --project <dir> --profile final|draftHalf [--allow-tts] …` (`L-01`).
 *
 * ФЛАГОВ РАСКЛАДКИ ТРИ, И КАЖДЫЙ ОТВЕЧАЕТ НА СВОЙ ВОПРОС: `--build-dir` — куда класть
 * производное, `--write-root` — куда писать артефакты авторства (дубли, `store.lock`, ledger),
 * `--store-dir` — где CAS. Умолчания взяты из проекта, поэтому обычная сборка зовётся двумя
 * флагами; врозь они разводятся ровно тогда, когда проект менять нельзя — например, прогон на
 * `fixtures/minimal`, которую задача не трогает ни символом.
 */
export interface BuildArgs {
  readonly command: 'build';
  /** Корень дерева проекта: `project.yaml` лежит здесь. */
  readonly projectDir: string;
  /**
   * Пара сборки. Умолчания нет — по той же причине, что у гейта: пара называется явно.
   *
   * ТИП ШИРЕ, ЧЕМ РАЗБОР (`F-01`). `BuildProfileId` включает третий профиль `ac4`, но
   * `parseBuild` его НЕ ПРОИЗВОДИТ: `profileOf` отвергает такое значение отдельным текстом.
   * Значение `ac4` попадает сюда ровно из одного места — `vpe verify ac4`, конструирующей
   * аргументы сама, — то есть выпускной путь не может обойти **R12** флагом командной строки.
   */
  readonly profileId: BuildProfileId;
  /**
   * ЯВНЫЙ файл профиля рендера вместо названного проектом. `null` — как называет проект
   * (`profiles.render` / `profiles.draft` / `profiles.renderAc4`).
   *
   * ФЛАГА У `vpe build` У НЕГО НЕТ (`F-01`): подменять профиль выпускной сборки командной
   * строкой значило бы собирать «не на той паре» молча — ровно то, от чего `--profile`
   * умолчания не имеет. Поле наполняет `vpe verify ac4 --profile <файл.yaml>`, где подмена
   * законна: профиль AC4 парой гейта не является, и сверка `profileId` файла с профилем
   * сборки остаётся на месте.
   */
  readonly profilePath: string | null;
  /** **K8**: разрешён ли промах `voice`. Без него промах — падение с инструкцией. */
  readonly allowTts: boolean;
  /** Момент сборки (**D9**). `null` — берётся `VPE_NOW`, затем часы процесса. */
  readonly now: string | null;
  readonly buildDir: string | null;
  readonly writeRoot: string | null;
  readonly storeDir: string | null;
  /** Каталог записей гейта. `null` — каталог библиотеки рядом со спеками. */
  readonly gatesDir: string | null;
}

/**
 * `vpe verify ac4 --project <кат> [--profile <файл.yaml>] …` — **AC4 на настоящем проекте**
 * (`F-01`; Charter AC4 rev5, ADR-0007 §10 «полный прогон — ночной или по метке»).
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ КОМАНДА, А НЕ ФЛАГ У `build`. Предмет здесь не ролик, а РАВЕНСТВО ДВУХ
 * РОЛИКОВ: команда собирает проект дважды и сравнивает кадры, байты финала и звук. Флагом это
 * было бы «собери и заодно собери ещё раз» — вторая сборка в команде, которая по контракту
 * собирает одну. Сверх того у команды свой код выхода: расхождение — не отказ входа и не сбой
 * сборки, а FAIL критерия приёмки.
 *
 * `--profile` — ПУТЬ К ФАЙЛУ, а не имя пары: третий профиль пары гейта не образует
 * (решение владельца 12). `null` — `profiles.renderAc4` из `project.yaml`.
 */
export interface VerifyAc4Args {
  readonly command: 'verify ac4';
  readonly projectDir: string;
  /** Файл `render-profile/1`. `null` — профиль, названный проектом в `profiles.renderAc4`. */
  readonly profilePath: string | null;
  /**
   * Корень для двух каталогов сборки. `null` — свежий каталог в `tmpdir()`.
   *
   * ДВА КАТАЛОГА, А НЕ ОДИН: прогоны обязаны быть независимы по выходу, иначе второй писал бы
   * поверх первого и сравнивать было бы нечего.
   */
  readonly runRoot: string | null;
  readonly storeDir: string | null;
  /** **K8** для обоих прогонов. Умолчание — не разрешать: AC4 гоняется на готовых дублях. */
  readonly allowTts: boolean;
  /** Момент ОБОИХ прогонов (**D9**). `null` — `VPE_NOW`, затем часы процесса. */
  readonly now: string | null;
}

/** `vpe template list` — таблица каталога. */
export interface TemplateListArgs {
  readonly command: 'template list';
  readonly gatesDir: string | null;
}

/**
 * `vpe spec export [--json] [--out <файл>]` — правила движка одной выгрузкой (`SPEC-01`).
 *
 * **ФЛАГОВ РОВНО ДВА, И `--gates-dir` СРЕДИ НИХ НЕТ.** Каталог записей у выгрузки один —
 * тот, что рядом со спеками: она отвечает на вопрос «что умеет ДВИЖОК», а не «что снято на
 * этой машине». Подмена каталога записей сделала бы выгрузку зависящей от аргумента, которого
 * читатель выгрузки не видит.
 *
 * УМОЛЧАНИЕ — MARKDOWN В STDOUT: выгрузку вставляют в чат, а не скармливают программе.
 * `--json` — та же структура машинно, для того, кто её разбирает.
 */
export interface SpecExportArgs {
  readonly command: 'spec export';
  readonly json: boolean;
  /** Куда положить выгрузку. `null` — в stdout. */
  readonly out: string | null;
}

/**
 * `vpe render-segment [--gate-skip <причина>] [--gate-profile final|draftHalf]` (`L-02`).
 *
 * ЗАПРОСА В АРГУМЕНТАХ НЕТ, И ЭТО КОНТРАКТ, А НЕ ЭКОНОМИЯ: ADR-0008 говорит «JSON-запрос на
 * stdin». Флага `--request <файл>` здесь нет намеренно — он есть у `vpe template gate`, где
 * фикстура шаблона коммитится файлом (решение владельца `E-00`, развилка 1), а тут вызывающий
 * — сборка, и запрос она порождает, а не хранит.
 */
export interface RenderSegmentArgs {
  readonly command: 'render-segment';
  /**
   * Флаги гейта ДОСЛОВНО, как их написал вызывающий.
   *
   * Разбирает их `gateFromArgv` в теле точки входа — тот же код, что у бинаря пакета. Здесь
   * проверяется ДРУГОЕ: что среди аргументов нет неизвестного флага. Два разбора отвечают на
   * два разных вопроса, а решение о **R12** остаётся одно.
   */
  readonly gateArgv: readonly string[];
}

/**
 * `vpe store verify|fetch|push --project <кат> …` (`L-02`).
 *
 * **`gc` НЕ СУЩЕСТВУЕТ** и в `USAGE` не упоминается: `.store` не подлежит LRU-GC никогда
 * (**K10**, ADR-0005 §8 — в интерфейсе `Store` нет метода удаления).
 */
export interface StoreArgs {
  readonly command: 'store';
  readonly action: StoreAction;
  /** Корень дерева проекта: `project.yaml` и `store.lock` лежат здесь. */
  readonly projectDir: string;
  /** CAS проекта. `null` — `store.path` из `project.yaml`, с раскрытием `~`. */
  readonly storeDir: string | null;
  /**
   * Вторая сторона переноса: `--from` у `fetch`, `--to` у `push`. У `verify` — `null`.
   *
   * ПУТЬ, А НЕ URL: сетевых протоколов в v1 нет вовсе. Второй бэкенд (rclone) — `G-03`, и он
   * появится тем же интерфейсом из пяти методов, а не вторым видом этого флага.
   */
  readonly peerDir: string | null;
  /**
   * `verify --write-verified`: проставить `lastVerifiedAt` в `store.lock` (решение владельца, В2).
   *
   * УМОЛЧАНИЕ — НЕ ПИСАТЬ. `verify` — команда чтения, и запись по умолчанию тронула бы
   * коммитимый файл при первом же прогоне, включая прогон на фикстуре.
   */
  readonly writeVerified: boolean;
  /** Момент для `lastVerifiedAt`. `null` — `VPE_NOW`, затем часы процесса. */
  readonly now: string | null;
}

export type StoreAction = 'verify' | 'fetch' | 'push';

/** Подкоманды `store` — закрытым списком; `gc` среди них нет и не будет (**K10**). */
const STORE_ACTIONS: readonly StoreAction[] = ['verify', 'fetch', 'push'];

export type CliCommand =
  | BuildArgs
  | RenderSegmentArgs
  | SpecExportArgs
  | StoreArgs
  | TemplateGateArgs
  | TemplateListArgs
  | VerifyAc4Args;

/** Строка помощи — единственное место, где перечислены обе команды. */
export const USAGE = [
  'vpe build --project <кат> --profile final|draftHalf [--allow-tts] [--now <ISO>]',
  '          [--build-dir <кат>] [--write-root <кат>] [--store-dir <кат>] [--gates-dir <кат>]',
  'vpe render-segment [--gate-skip <причина>] [--gate-profile final|draftHalf]   (запрос — на stdin)',
  'vpe store verify --project <кат> [--store-dir <кат>] [--write-verified] [--now <ISO>]',
  'vpe store fetch  --project <кат> --from <кат> [--store-dir <кат>]',
  'vpe store push   --project <кат> --to <кат>   [--store-dir <кат>]',
  'vpe template gate <id>@<N> --profile final|draftHalf --request <файл> --render-profile <файл.yaml>',
  '                           [--gates-dir <кат>] [--run-root <кат>]',
  'vpe template list [--gates-dir <кат>]',
  'vpe spec export [--json] [--out <файл>]',
  'vpe verify ac4 --project <кат> [--profile <файл.yaml>] [--run-root <кат>] [--store-dir <кат>]',
  '               [--allow-tts] [--now <ISO>]',
].join('\n');

/** Значение флага: следующий аргумент. Пропущенное значение — отказ, а не пустая строка. */
function valueOf(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CliError('argv', `\`${flag}\` требует значения`, EXIT.input);
  }
  return value;
}

/** Профиль гейта из строки. `ac4` назван отдельно: это не опечатка, а неверное представление. */
function profileOf(given: string): GateProfileId {
  if ((GATE_PROFILES as readonly string[]).includes(given)) return given as GateProfileId;
  const extra =
    given === AC4_PROFILE_ID || given === 'render.ac4' || given === 'render.ac4.yaml'
      ? ' `render.ac4.yaml` формально тоже пара, но гейта ШАБЛОНА на нём нет: он остаётся ' +
        'ПОЛНЫМ ПРОГОНОМ ФИКСТУРНОГО ПРОЕКТА (Charter AC4 rev5, решение владельца 12, RM1), ' +
        'то есть проверкой всей цепочки, а не проверкой шаблона. Прогон на нём зовётся ' +
        'своей командой: `vpe verify ac4 --project <кат>` — она собирает проект ДВАЖДЫ и ' +
        'сверяет кадры, байты финала и звук. Сборка на этом профиле одиночным `vpe build` ' +
        'невыразима намеренно: она прошла бы мимо **R12**, а выпуск идёт только через гейт.'
      : '';
  throw new CliError(
    'argv',
    `\`--profile ${given}\` — не профиль гейта; их ровно два: ${GATE_PROFILES.join(', ')}.${extra}`,
    EXIT.input,
  );
}

/**
 * Разбор командной строки. Закрытые списки: две команды, два профиля, шесть флагов.
 *
 * @throws {CliError} `argv` — код выхода `EXIT.input`.
 */
export function parseArgv(argv: readonly string[]): CliCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    throw new CliError('argv', `команда не названа. Формы:\n${USAGE}`, EXIT.input);
  }
  if (argv[0] === 'build') return parseBuild(argv.slice(1));
  if (argv[0] === 'render-segment') return parseRenderSegment(argv.slice(1));
  if (argv[0] === 'store') return parseStore(argv.slice(1));
  if (argv[0] === 'spec') return parseSpec(argv.slice(1));
  if (argv[0] === 'verify') return parseVerify(argv.slice(1));
  if (argv[0] !== 'template') {
    throw new CliError('argv', `неизвестная команда \`${argv[0]}\`. Формы:\n${USAGE}`, EXIT.input);
  }

  const sub = argv[1];
  if (sub === 'gate') return parseGate(argv.slice(2));
  if (sub === 'list') return parseList(argv.slice(2));
  throw new CliError(
    'argv',
    `неизвестная подкоманда \`template ${sub ?? ''}\`. Есть \`gate\` и \`list\`.\n${USAGE}`,
    EXIT.input,
  );
}

function parseGate(rest: readonly string[]): TemplateGateArgs {
  let template: string | null = null;
  let profile: string | null = null;
  let requestPath: string | null = null;
  let renderProfilePath: string | null = null;
  let gatesDir: string | null = null;
  let runRoot: string | null = null;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    switch (arg) {
      case '--profile':
        profile = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--request':
        requestPath = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--render-profile':
        renderProfilePath = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--gates-dir':
        gatesDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--run-root':
        runRoot = valueOf(rest, i, arg);
        i += 1;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new CliError('argv', `неизвестный флаг \`${arg}\`.\n${USAGE}`, EXIT.input);
        }
        if (template !== null) {
          throw new CliError(
            'argv',
            `лишний аргумент \`${arg}\`: гейт снимается с ОДНОГО шаблона за вызов ` +
              `(уже назван \`${template}\`)`,
            EXIT.input,
          );
        }
        template = arg;
    }
  }

  if (template === null) {
    throw new CliError('argv', `шаблон не назван.\n${USAGE}`, EXIT.input);
  }
  if (profile === null) {
    throw new CliError(
      'argv',
      '`--profile` обязателен: профиль определяет N (10 на `final`, 3 на `draftHalf`) и слот ' +
        'записи. Умолчания здесь нет намеренно — гейт снят «не на том» профиле есть запись ' +
        'про другую пару',
      EXIT.input,
    );
  }
  if (requestPath === null) {
    throw new CliError(
      'argv',
      '`--request` обязателен: гейт снимается на ФИКСТУРЕ ШАБЛОНА (ADR-0008 «Процедура», ' +
        'п. 1), и запрос приезжает файлом (решение владельца `E-00`, развилка 1)',
      EXIT.input,
    );
  }

  if (renderProfilePath === null) {
    throw new CliError(
      'argv',
      '`--render-profile` обязателен: кадры кодируются ПОЛНЫМ `pixelProfile` (кодек, crf, ' +
        '`encoder.*`), а запрос несёт лишь три поля адаптера. Выдуманные параметры энкодера ' +
        'дали бы `sha256` про другой файл — `FACT` (SP-3 блок D): `threads=1` и `threads=4` ' +
        'дают разные битстримы на одном входе',
      EXIT.input,
    );
  }

  return {
    command: 'template gate',
    template,
    profileId: profileOf(profile),
    requestPath,
    renderProfilePath,
    gatesDir,
    runRoot,
  };
}

function parseBuild(rest: readonly string[]): BuildArgs {
  let projectDir: string | null = null;
  let profile: string | null = null;
  let allowTts = false;
  let now: string | null = null;
  let buildDir: string | null = null;
  let writeRoot: string | null = null;
  let storeDir: string | null = null;
  let gatesDir: string | null = null;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    switch (arg) {
      case '--project':
        projectDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--profile':
        profile = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--allow-tts':
        // ФЛАГ БЕЗ ЗНАЧЕНИЯ, и это не экономия: `--allow-tts=false` был бы вторым способом
        // сказать «не разрешаю», а первый — не писать флаг вовсе.
        allowTts = true;
        break;
      case '--now':
        now = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--build-dir':
        buildDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--write-root':
        writeRoot = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--store-dir':
        storeDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--gates-dir':
        gatesDir = valueOf(rest, i, arg);
        i += 1;
        break;
      default:
        throw new CliError(
          'argv',
          arg.startsWith('--')
            ? `неизвестный флаг \`${arg}\`.\n${USAGE}`
            : `лишний аргумент \`${arg}\`: проект называется флагом \`--project\`.\n${USAGE}`,
          EXIT.input,
        );
    }
  }

  if (projectDir === null) {
    throw new CliError('argv', `\`--project\` обязателен: собирать нечего.\n${USAGE}`, EXIT.input);
  }
  if (profile === null) {
    throw new CliError(
      'argv',
      '`--profile` обязателен: пара сборки определяет и профиль рендера, и слот записи гейта ' +
        '(**R12**). Умолчания здесь нет намеренно — сборка «не на том» профиле есть ролик, ' +
        'снятый на непроверенной паре',
      EXIT.input,
    );
  }

  return {
    command: 'build',
    projectDir,
    profileId: profileOf(profile),
    // Флага нет — см. поле: профиль выпускной сборки называет проект, а не командная строка.
    profilePath: null,
    allowTts,
    now,
    buildDir,
    writeRoot,
    storeDir,
    gatesDir,
  };
}

/**
 * `vpe spec export` — подкоманда названа явно, как у `template` и `store`.
 *
 * ПОЧЕМУ НЕ `vpe spec` БЕЗ СЛОВА `export`. Выгрузка — не единственное, что можно спросить у
 * спецификации (проверка сценария файлом, диф выгрузок), и команда без подкоманды заняла бы
 * имя всего семейства первым же случаем. Тот же довод, по которому `template` имеет `gate` и
 * `list`, а не одну безымянную форму.
 */
function parseSpec(rest: readonly string[]): SpecExportArgs {
  const sub = rest[0];
  if (sub !== 'export') {
    throw new CliError(
      'argv',
      `неизвестная подкоманда \`spec ${sub ?? ''}\`. Есть одна — \`export\`.\n${USAGE}`,
      EXIT.input,
    );
  }

  let json = false;
  let out: string | null = null;
  for (let i = 1; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--json') {
      // ФЛАГ БЕЗ ЗНАЧЕНИЯ — тем же правилом, что `--allow-tts`: `--json=false` был бы вторым
      // способом сказать «markdown», а первый — не писать флаг вовсе.
      json = true;
      continue;
    }
    if (arg === '--out') {
      out = valueOf(rest, i, arg);
      i += 1;
      continue;
    }
    throw new CliError(
      'argv',
      arg.startsWith('--')
        ? `неизвестный флаг \`${arg}\`.\n${USAGE}`
        : `лишний аргумент \`${arg}\`: файл называется флагом \`--out\`.\n${USAGE}`,
      EXIT.input,
    );
  }
  return { command: 'spec export', json, out };
}

function parseList(rest: readonly string[]): TemplateListArgs {
  let gatesDir: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--gates-dir') {
      gatesDir = valueOf(rest, i, arg);
      i += 1;
      continue;
    }
    throw new CliError('argv', `неизвестный аргумент \`${arg}\`.\n${USAGE}`, EXIT.input);
  }
  return { command: 'template list', gatesDir };
}

/**
 * `vpe render-segment` — флаги гейта и ничего больше.
 *
 * ЗАЧЕМ РАЗБОР, ЕСЛИ ФЛАГИ ВСЁ РАВНО УЕЗЖАЮТ ДОСЛОВНО. Затем же, зачем он у остальных
 * команд: `--gate-skipp` (опечатка) без этой проверки уехал бы в `gateFromArgv`, тот не нашёл
 * бы `--gate-skip`, взял бы умолчание `require` — и вызывающий получил бы отказ **R12** вместо
 * «неизвестный флаг», то есть узнал бы про гейт вместо того, чтобы узнать про свою опечатку.
 */
function parseRenderSegment(rest: readonly string[]): RenderSegmentArgs {
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--gate-skip' || arg === '--gate-profile') {
      valueOf(rest, i, arg);
      i += 1;
      continue;
    }
    throw new CliError(
      'argv',
      arg.startsWith('--')
        ? `неизвестный флаг \`${arg}\`.\n${USAGE}`
        : `лишний аргумент \`${arg}\`: запрос приезжает НА STDIN (ADR-0008), а не путём.\n${USAGE}`,
      EXIT.input,
    );
  }
  return { command: 'render-segment', gateArgv: [...rest] };
}

/**
 * `vpe store verify|fetch|push`.
 *
 * `--from` законен только у `fetch`, `--to` — только у `push`, и обязателен каждый у своей
 * подкоманды: «перенести блобы» без второй стороны есть команда без адресата. У `verify`
 * второй стороны нет вовсе — он спрашивает ОДИН стор про список `store.lock`.
 */
function parseStore(rest: readonly string[]): StoreArgs {
  const given = rest[0] ?? '';
  if (!(STORE_ACTIONS as readonly string[]).includes(given)) {
    // `gc` называется отдельно — как `ac4` у профиля: это не опечатка, а неверное
    // представление о том, что команда умеет.
    const extra =
      given === 'gc'
        ? ' `vpe store gc` НЕ СУЩЕСТВУЕТ и написан не будет: `.store` не подлежит LRU-GC ' +
          'никогда (**K10**, ADR-0005 §8 — в интерфейсе `Store` нет метода удаления). Потеря ' +
          'оплаченного PCM не восстанавливается деньгами (`FACT` r1 §2.3).'
        : '';
    throw new CliError(
      'argv',
      `неизвестная подкоманда \`store ${given}\`. Их ровно три: ${STORE_ACTIONS.join(', ')}.${extra}\n${USAGE}`,
      EXIT.input,
    );
  }
  const action = given as StoreAction;

  let projectDir: string | null = null;
  let storeDir: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let writeVerified = false;
  let now: string | null = null;

  for (let i = 1; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    switch (arg) {
      case '--project':
        projectDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--store-dir':
        storeDir = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--from':
        from = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--to':
        to = valueOf(rest, i, arg);
        i += 1;
        break;
      case '--write-verified':
        writeVerified = true;
        break;
      case '--now':
        now = valueOf(rest, i, arg);
        i += 1;
        break;
      default:
        throw new CliError(
          'argv',
          arg.startsWith('--')
            ? `неизвестный флаг \`${arg}\`.\n${USAGE}`
            : `лишний аргумент \`${arg}\`: проект называется флагом \`--project\`.\n${USAGE}`,
          EXIT.input,
        );
    }
  }

  if (projectDir === null) {
    throw new CliError(
      'argv',
      '`--project` обязателен: список того, что ОБЯЗАНО лежать в сторе, живёт в `store.lock` ' +
        `проекта, а не в сторе.\n${USAGE}`,
      EXIT.input,
    );
  }
  if (action === 'fetch' && from === null) {
    throw new CliError('argv', `\`store fetch\` требует \`--from <кат>\`.\n${USAGE}`, EXIT.input);
  }
  if (action === 'push' && to === null) {
    throw new CliError('argv', `\`store push\` требует \`--to <кат>\`.\n${USAGE}`, EXIT.input);
  }
  if (action !== 'fetch' && from !== null) {
    throw new CliError('argv', `\`--from\` есть только у \`store fetch\`.\n${USAGE}`, EXIT.input);
  }
  if (action !== 'push' && to !== null) {
    throw new CliError('argv', `\`--to\` есть только у \`store push\`.\n${USAGE}`, EXIT.input);
  }
  if (action !== 'verify' && (writeVerified || now !== null)) {
    throw new CliError(
      'argv',
      '`--write-verified` и `--now` есть только у `store verify`: `lastVerifiedAt` — момент ' +
        `ПРОВЕРКИ, а перенос блобов ничего не проверяет.\n${USAGE}`,
      EXIT.input,
    );
  }

  return {
    command: 'store',
    action,
    projectDir,
    storeDir,
    peerDir: action === 'fetch' ? from : action === 'push' ? to : null,
    writeVerified,
    now,
  };
}

/**
 * `vpe verify ac4` — подкоманда названа явно, как у `template`, `store` и `spec`.
 *
 * ПОЧЕМУ `verify ac4`, А НЕ `verify`. Критериев приёмки шесть, и проверяемых прогоном из них
 * не один: AC2 (бюджет кадра) и AC3 (draft) — тоже прогоны, и они придут задачей `G-04`.
 * Команда без подкоманды заняла бы имя всего семейства первым же случаем — тот же довод, по
 * которому `template` имеет `gate` и `list`.
 */
function parseVerify(rest: readonly string[]): VerifyAc4Args {
  const sub = rest[0];
  if (sub !== 'ac4') {
    throw new CliError(
      'argv',
      `неизвестная подкоманда \`verify ${sub ?? ''}\`. Есть одна — \`ac4\`.\n${USAGE}`,
      EXIT.input,
    );
  }

  let projectDir: string | null = null;
  let profilePath: string | null = null;
  let runRoot: string | null = null;
  let storeDir: string | null = null;
  let allowTts = false;
  let now: string | null = null;

  const tail = rest.slice(1);
  for (let i = 0; i < tail.length; i += 1) {
    const arg = tail[i] ?? '';
    switch (arg) {
      case '--project':
        projectDir = valueOf(tail, i, arg);
        i += 1;
        break;
      case '--profile':
        profilePath = valueOf(tail, i, arg);
        i += 1;
        break;
      case '--run-root':
        runRoot = valueOf(tail, i, arg);
        i += 1;
        break;
      case '--store-dir':
        storeDir = valueOf(tail, i, arg);
        i += 1;
        break;
      case '--allow-tts':
        allowTts = true;
        break;
      case '--now':
        now = valueOf(tail, i, arg);
        i += 1;
        break;
      default:
        throw new CliError(
          'argv',
          arg.startsWith('--')
            ? `неизвестный флаг \`${arg}\`.\n${USAGE}`
            : `лишний аргумент \`${arg}\`: проект называется флагом \`--project\`.\n${USAGE}`,
          EXIT.input,
        );
    }
  }

  if (projectDir === null) {
    throw new CliError('argv', `\`--project\` обязателен: проверять нечего.\n${USAGE}`, EXIT.input);
  }

  return { command: 'verify ac4', projectDir, profilePath, runRoot, storeDir, allowTts, now };
}
