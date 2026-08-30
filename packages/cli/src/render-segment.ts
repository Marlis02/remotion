// **`vpe render-segment`** — вторая граница процесса того же контракта (`L-02`).
//
// ADR-0008 называет рендерер подпроцессом И называет его командой: «JSON-запрос на stdin
// `vpe render-segment`, JSON-ответ на stdout». До `L-02` команда была только в тексте ADR, а
// работал бинарь пакета `renderer-hyperframes`; теперь есть обе точки входа — и они зовут
// ОДНО тело (`runSegmentEntry`), а не две похожие реализации.
//
// ПОЧЕМУ ОБЁРТКА, А НЕ ПЕРЕНОС (решение владельца, В1). Перенос тела в `cli` невозможен без
// обратной стрелки `renderer → cli`, которой по карте ADR-0009 нет; а бинарь пакета —
// объявленная точка подпроцесса, на неё смотрят тесты изоляции и реестр часов
// `d4-clock-boundary`. Обёртка через `spawn` бинаря была бы процессом внутри процесса: команда
// `vpe render-segment` есть САМА граница, а не запускатель границы.
//
// ЧИСТАЯ ФУНКЦИЯ ВХОДА. Команда не читает ни stdin, ни `process.env`, ни часы: всё приезжает
// депами (`CliDeps`), а читает их `bin/vpe.ts` — единственная граница процесса у `cli`.
// Единственный вход команды — то, что несёт запрос, плюс два флага гейта.

import { canonicalJson } from '@vpe/core-model';
import { runSegmentEntry } from '@vpe/renderer-hyperframes';

import type { RenderSegmentArgs } from './argv.js';
import { EXIT } from './errors.js';

export interface RenderSegmentDeps {
  /**
   * Тело stdin как текст. ЛЕНИВО: остальные команды stdin не читают вовсе, и чтение fd 0
   * при каждом вызове `vpe` подвесило бы их на терминале.
   */
  readonly stdin: () => string;
  /** Часы прогона: `stats.wallMs` — свойство запуска (ADR-0008). */
  readonly clock: () => number;
  /** Окружение родителя: им резолвится браузер и ffmpeg внутри адаптера. */
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/**
 * Рендерит один сегмент. Возвращает КОД ВЫХОДА; исключений наружу не выпускает — их не
 * выпускает и тело.
 *
 * КОДЫ — те же три числа, что у бинаря: `0` ответ `ok: true`, `1` договорный отказ (ответ на
 * stdout всё равно валиден), `2` запрос не разобрался как JSON. Совпадение с
 * `EXIT.pass|refusal|input` проверяется тестом, а не подразумевается.
 */
export async function renderSegmentCommand(
  args: RenderSegmentArgs,
  deps: RenderSegmentDeps,
): Promise<number> {
  const result = await runSegmentEntry({
    raw: deps.stdin(),
    // Флаги гейта уезжают в тело ДОСЛОВНО: решение о **R12** принимает `gateFromArgv`, и
    // второго разборщика тех же двух флагов в репозитории быть не должно. Разбор в `argv.ts`
    // отвечает на другой вопрос — «нет ли здесь неизвестного флага».
    argv: args.gateArgv,
    clock: deps.clock,
    parentEnv: deps.env,
  });

  // `canonicalJson`, а не `JSON.stringify`: последний запрещён линтом во всём
  // `packages/*/src/**` (ADR-0007 §3). Бинарь пакета лежит в `bin/` и печатает обычным
  // `JSON.stringify` — то же ЗНАЧЕНИЕ в другом порядке ключей; ответ подпроцесса не
  // хэшируется ничем, поэтому разница формы ни на что не влияет, а каноническая форма из
  // двух возможных — более узкая.
  if (result.response !== null) deps.out(`${canonicalJson(result.response)}\n`);
  if (result.stderr !== '') deps.err(result.stderr);
  return result.exitCode;
}

/** Соответствие кодов тела и кодов команды — одно место, где оно записано. */
export const RENDER_SEGMENT_EXIT = {
  ok: EXIT.pass,
  refusal: EXIT.refusal,
  input: EXIT.input,
} as const;
