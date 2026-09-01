// Диспетчер команд: argv → команда → КОД ВЫХОДА. Единственное место, где отказ превращается
// в код, а исключение — в строку stderr.
//
// ПОЧЕМУ ОН НЕ ЧИТАЕТ `process` НИ ОДНИМ ПОЛЕМ. Часы, аргументы, окружение и оба потока вывода
// приезжают в `CliDeps` — тем же приёмом, что `clock` у `renderSegment` (**D4**). Следствие,
// ради которого приём и взят: юнит-тест команды не подменяет глобалей и не читает stdout
// процесса, а просто смотрит на строки, которые команда напечатала.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadTemplateLibrary } from '@vpe/renderer-hyperframes';

import { parseArgv } from './argv.js';
import { build, type BuildDeps } from './build.js';
import { CliError, EXIT } from './errors.js';
import { renderSegmentCommand } from './render-segment.js';
import { formatSpecExport, specExport, specExportJson } from './spec-export.js';
import { store } from './store.js';
import { templateGate, type TemplateGateDeps } from './template-gate.js';
import { formatTemplateTable, templateRows } from './template-list.js';

export interface CliDeps extends TemplateGateDeps, Omit<BuildDeps, 'env'> {
  /** Диагностика и отказы. Отделено от `out`: stdout — результат, stderr — почему. */
  readonly err: (text: string) => void;
  /** Окружение процесса. Обязательно для `build`: им меряется отпечаток (**R14**). */
  readonly env: NodeJS.ProcessEnv;
  /**
   * Тело stdin как текст — вход `vpe render-segment` (ADR-0008), и больше ничей.
   *
   * ФУНКЦИЯ, А НЕ СТРОКА: чтение fd 0 при каждом вызове `vpe` подвесило бы на терминале
   * `vpe build`, который stdin не читает вовсе. Депа обязательная, а не опциональная, — иначе
   * «команда без stdin» стала бы ошибкой прогона вместо ошибки типа. *(Добавлено: `L-02`.)*
   */
  readonly stdin: () => string;
}

/**
 * Исполняет одну команду. Возвращает код выхода; исключения наружу не выпускает — иначе
 * вызывающий скрипт получил бы стек вместо ответа.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const command = parseArgv(argv);
    if (command.command === 'build') return await build(command, deps);
    if (command.command === 'render-segment') return await renderSegmentCommand(command, deps);
    if (command.command === 'store') return await store(command, deps);
    if (command.command === 'template gate') return await templateGate(command, deps);

    if (command.command === 'spec export') {
      // ═══ ЧТЕНИЕ КАТАЛОГА — ТЕМ ЖЕ ЗАГРУЗЧИКОМ, ЧТО У `template list` ═══
      // «Манифест собирается из двух мест» обязано означать ОДНО чтение: выгрузка, собравшая
      // записи гейта своим способом, показала бы статус, отличный от таблицы каталога.
      const doc = specExport(loadTemplateLibrary().loaded);
      const text = command.json ? specExportJson(doc) : `${formatSpecExport(doc)}`;
      if (command.out === null) {
        deps.out(text);
        return EXIT.pass;
      }
      // Каталог создаётся: выгрузку кладут рядом с отчётом задачи, и падение на
      // несуществующем каталоге здесь было бы отказом про `mkdir`, а не про выгрузку.
      mkdirSync(path.dirname(path.resolve(command.out)), { recursive: true });
      writeFileSync(command.out, text, 'utf8');
      deps.err(`vpe: выгрузка записана в ${command.out}\n`);
      return EXIT.pass;
    }

    // `template list` — чтение каталога тем же загрузчиком, что и гейт: «манифест собирается
    // из двух мест» обязано означать ОДНО чтение, а не два похожих.
    const library = loadTemplateLibrary(
      command.gatesDir === null ? {} : { dir: command.gatesDir },
    );
    deps.out(`${formatTemplateTable(templateRows(library.loaded))}\n`);
    return EXIT.pass;
  } catch (error) {
    if (error instanceof CliError) {
      deps.err(`vpe: ${error.message}\n`);
      return error.exitCode;
    }
    // Чужая ошибка (`TemplateSpecError` из `attachGates`, `RenderAdapterError` из каталога) —
    // это договорный отказ, а не сбой команды: правило названо в её собственном тексте.
    deps.err(`vpe: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.refusal;
  }
}
