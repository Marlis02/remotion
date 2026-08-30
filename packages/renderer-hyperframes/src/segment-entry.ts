// ТЕЛО ТОЧКИ ВХОДА ПОДПРОЦЕССА: JSON-запрос → JSON-ответ → код выхода, ЧИСТОЙ ФУНКЦИЕЙ.
//
// ═══ ПОЧЕМУ ЭТОТ ФАЙЛ ПОЯВИЛСЯ (`L-02`) ═══
// ADR-0008 называет границей рендерера ПОДПРОЦЕСС и называет его командой: «JSON-запрос на
// stdin `vpe render-segment`, JSON-ответ на stdout». Точек входа с этого момента ДВЕ —
// `renderer-hyperframes/bin/render-segment.ts` (та, что была: бинарь пакета, на неё смотрят
// тесты изоляции и реестр часов `d4-clock-boundary`) и команда `vpe render-segment` в `cli`.
// Две оболочки над ОДНИМ телом, а не две реализации: разойдись они, «тот же запрос через
// spawn даёт тот же результат» перестало бы что-либо значить, потому что ответ зависел бы от
// того, каким из двух способов позвали.
//
// ЧИСТАЯ ФУНКЦИЯ ВХОДА — БУКВАЛЬНО. Здесь не читается ни stdin, ни `process.argv`, ни
// `process.env`, ни часы: всё четыре приезжают полями `SegmentEntryInput`. Читают их
// оболочки, каждая на своей границе процесса. Практическое следствие ровно то же, ради
// которого приём взят в `run.ts` у `cli`: юнит-тест команды не подменяет глобалей.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: сериализации ответа. `JSON.stringify` запрещён линтом во всём
// `packages/*/src/**` (ADR-0007 §3), и это не помеха, а разделение: тело возвращает ЗНАЧЕНИЕ,
// а каждая оболочка печатает его тем писателем, который ей законен.

import { GATE_PROFILES, type GateProfileId } from '@vpe/templates-spec';

import type { RenderResponse } from './contract.js';
import { RenderAdapterError } from './errors.js';
import { loadTemplateLibrary } from './library.js';
import { renderSegment, type RenderOptions } from './run.js';
import { validateRequest } from './validate.js';

/**
 * Коды выхода точки входа. Три, и различие несущее: вызывающий отличает «сегмент не
 * собрался» от «мы говорим на разных языках», не разбирая текст.
 *
 * Числа совпадают с `EXIT.pass|refusal|input` у `cli` — не случайно: команда `vpe
 * render-segment` есть та же точка входа, и третьего набора кодов у одного контракта быть
 * не должно.
 */
export const SEGMENT_ENTRY_EXIT = {
  /** Ответ `ok: true`. */
  ok: 0,
  /** Договорный отказ: ответ `ok: false` — на stdout он ВСЁ РАВНО валиден. */
  refusal: 1,
  /** Запрос не разобрался как JSON: отвечать нечем и не о чем. */
  input: 2,
} as const;

/** Вход тела: всё, что точка входа знает о мире. */
export interface SegmentEntryInput {
  /** Тело stdin как текст — байт в байт, как пришло. Разбирает его эта функция, а не оболочка. */
  readonly raw: string;
  /** Аргументы ПОСЛЕ имени команды: `--gate-skip <причина>`, `--gate-profile final|draftHalf`. */
  readonly argv: readonly string[];
  /** Часы: `stats.wallMs` — свойство прогона, а не входа (ADR-0008). */
  readonly clock: () => number;
  /** Окружение родителя. Вход, а не `process.env`: см. шапку. */
  readonly parentEnv: NodeJS.ProcessEnv;
}

/** Выход тела: что печатать, куда и с каким кодом. */
export interface SegmentEntryResult {
  /**
   * Ответ на stdout. `null` — печатать нечего: запрос не разобрался как JSON.
   *
   * Пустой stdout при коде `2` — решение `H-01`, записанное в шапке бинаря дословно
   * («отвечать нечем и не о чем»), и `L-02` его НЕ пересматривает: обе оболочки молчат
   * одинаково, а причина уезжает в `stderr` строкой.
   */
  readonly response: RenderResponse | null;
  readonly exitCode: (typeof SEGMENT_ENTRY_EXIT)[keyof typeof SEGMENT_ENTRY_EXIT];
  /** Человекочитаемое эхо для `stderr`. Пустая строка — молчать. Перевод строки уже внутри. */
  readonly stderr: string;
}

/**
 * Решение о гейте **R12** из аргументов: дефолт — `require` (решение владельца `H-04`, вопрос 2).
 *
 * `--gate-skip <причина>` — осознанный проход мимо охранника, и причина ОБЯЗАТЕЛЬНА: она
 * приезжает аргументом, потому что подпроцесс запускает не человек, а `vpe build`, и «почему
 * этот сегмент собирается без гейта» обязано быть видно в командной строке, а не в умолчании.
 *
 * `--gate-profile final|draftHalf` — какая ПАРА проверяется. Умолчание `final`: профиль
 * выпуска; черновик называется явно.
 *
 * РЕЕСТР — ПРОД-КАТАЛОГ, СОБРАННЫЙ ИЗ ДВУХ МЕСТ (`E-00`, долг №171): пять версионированных
 * единиц `TEMPLATE_LIBRARY` плюс записи гейта из файлов `<id>@<N>.gates.json`, лежащих рядом
 * со спеками (`loadTemplateLibrary`).
 */
export function gateFromArgv(argv: readonly string[]): NonNullable<RenderOptions['gate']> {
  const skipAt = argv.indexOf('--gate-skip');
  if (skipAt >= 0) {
    const why = argv[skipAt + 1] ?? '';
    return { mode: 'skip', why };
  }
  const profileAt = argv.indexOf('--gate-profile');
  const given = profileAt >= 0 ? (argv[profileAt + 1] ?? '') : 'final';
  const profileId = (GATE_PROFILES as readonly string[]).includes(given)
    ? (given as GateProfileId)
    : null;
  if (profileId === null) {
    throw new RenderAdapterError(
      'R12',
      `\`--gate-profile ${given}\` — не профиль гейта; их ровно два: ${GATE_PROFILES.join(', ')}`,
      [
        {
          rule: 'R12',
          at: '--gate-profile',
          message:
            '`render.ac4.yaml` формально тоже пара, но гейта шаблона на нём нет: он остаётся ' +
            'полным прогоном фикстурного проекта (решение владельца 12, RM1)',
        },
      ],
    );
  }
  return { mode: 'require', specs: loadTemplateLibrary().registry, profileId };
}

/**
 * Разбирает запрос, рендерит сегмент и отдаёт ответ, код и строку `stderr`.
 *
 * Исключений наружу не выпускает НИ ОДНОГО — в этом весь смысл: у точки входа подпроцесса
 * стектрейс на stdout есть худший из возможных ответов, потому что вызывающий разбирает
 * stdout как JSON и получит про свой запрос ровно ничего.
 */
export async function runSegmentEntry(input: SegmentEntryInput): Promise<SegmentEntryResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw);
  } catch (error) {
    return {
      response: null,
      exitCode: SEGMENT_ENTRY_EXIT.input,
      stderr: `vpe-render-segment: stdin не разобрался как JSON: ${String((error as Error).message)}\n`,
    };
  }

  let response: RenderResponse;
  try {
    const request = validateRequest(parsed);
    response = await renderSegment(request, {
      clock: input.clock,
      parentEnv: input.parentEnv,
      // **R12**: сборка сегмента без записи гейта не стартует. Умолчания «рендерить» нет —
      // см. `gateFromArgv`.
      gate: gateFromArgv(input.argv),
    });
  } catch (error) {
    response =
      error instanceof RenderAdapterError
        ? { ok: false, error: { rule: error.rule, message: error.message, details: error.problems } }
        : {
            ok: false,
            error: { rule: 'прогон', message: String((error as Error).message), details: [] },
          };
  }

  return {
    response,
    exitCode: response.ok ? SEGMENT_ENTRY_EXIT.ok : SEGMENT_ENTRY_EXIT.refusal,
    stderr: response.ok
      ? ''
      : `vpe-render-segment: ${response.error.rule}: ${response.error.message}\n`,
  };
}
