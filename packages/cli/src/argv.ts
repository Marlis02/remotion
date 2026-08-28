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

/** `vpe template list` — таблица каталога. */
export interface TemplateListArgs {
  readonly command: 'template list';
  readonly gatesDir: string | null;
}

export type CliCommand = TemplateGateArgs | TemplateListArgs;

/** Строка помощи — единственное место, где перечислены обе команды. */
export const USAGE = [
  'vpe template gate <id>@<N> --profile final|draftHalf --request <файл> --render-profile <файл.yaml>',
  '                           [--gates-dir <кат>] [--run-root <кат>]',
  'vpe template list [--gates-dir <кат>]',
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
    given === 'ac4' || given === 'render.ac4' || given === 'render.ac4.yaml'
      ? ' `render.ac4.yaml` формально тоже пара, но гейта ШАБЛОНА на нём нет: он остаётся ' +
        'ПОЛНЫМ ПРОГОНОМ ФИКСТУРНОГО ПРОЕКТА (Charter AC4 rev5, решение владельца 12, RM1), ' +
        'то есть проверкой всей цепочки, а не проверкой шаблона.'
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
