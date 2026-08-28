#!/usr/bin/env node
// ТОЧКА ВХОДА ПОДПРОЦЕССА: JSON-запрос на stdin → JSON-ответ на stdout → код выхода.
//
// Это ровно то, что ADR-0008 называет границей рендерера: «Рендерер — подпроцесс: JSON-запрос
// на stdin `vpe render-segment`, JSON-ответ на stdout». Команда `vpe render-segment` — задача
// `L-02`; здесь живёт то, что она обернёт, и оно обязано работать само по себе.
//
// ═══ ГРАНИЦА ПРОЦЕССА: ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЧИТАЕТСЯ СИСТЕМНОЕ ВРЕМЯ ═══
// `Date.now` запрещён инвариантом **D4** (ADR-0007 §4) во всём `packages/*/src/**`. Здесь он
// законен по решению владельца `H-01` (поправка П1) и по расположению: файл лежит в `bin/`,
// а не в `src/`, то есть вне зоны действия правила, и это ЕДИНСТВЕННЫЙ такой файл во всём
// пакете. Охранник — `tests/lints/d4-clock-boundary.test.ts`: он перечисляет исключение
// ПОИМЁННО и краснеет, если часы появятся где-то ещё.
//
// Почему часы вообще нужны: `stats.wallMs` — поле ADR-0008, и «сколько шёл рендер» есть
// свойство прогона, а не входа. Детерминизм от этого не страдает: величина попадает в отчёт
// сборки, а не в ключ кэша (ADR-0006 §2 — `segmentKey` времени не содержит).
//
// КОДЫ ВЫХОДА. `0` — ответ `ok: true`; `1` — договорный отказ (`ok: false`, ответ на stdout
// ВСЁ РАВНО валиден); `2` — запрос не разобрался как JSON, то есть отвечать нечем и не о чем.
// Различие несущее: вызывающий отличает «сегмент не собрался» от «мы говорим на разных языках».
//
// `stderr` — ТОЛЬКО лог. Всё, что относится к делу, уезжает в stdout структурой; человекочитаемое
// эхо в stderr нужно, чтобы `vpe build` мог его показать, не разбирая JSON.

import { readFileSync } from 'node:fs';

import { GATE_PROFILES, createRegistry, FIXTURE_TEMPLATES, type GateProfileId } from '@vpe/templates-spec';

import {
  renderSegment,
  validateRequest,
  RenderAdapterError,
  type RenderOptions,
  type RenderResponse,
} from '../src/index.js';

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
 * РЕЕСТР СПЕКОВ — ФИКСТУРНЫЙ, И ЭТО СЕГОДНЯШНЕЕ СОСТОЯНИЕ, А НЕ ЗАГЛУШКА. Настоящей библиотеки
 * шаблонов ещё нет (`E-00`/`H-06`); у пяти фикстурных спеков `gates: []`, то есть `require`
 * ОТКАЖЕТ, и это правильный ответ: ни один шаблон гейта пока не проходил. Когда библиотека
 * появится, здесь поменяется одна строка — источник реестра.
 */
function gateFromArgv(argv: readonly string[]): NonNullable<RenderOptions['gate']> {
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
  return { mode: 'require', specs: createRegistry(FIXTURE_TEMPLATES), profileId };
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<number> {
  const raw = readStdin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `vpe-render-segment: stdin не разобрался как JSON: ${String((err as Error).message)}\n`,
    );
    return 2;
  }

  let response: RenderResponse;
  try {
    const request = validateRequest(parsed);
    response = await renderSegment(request, {
      // ЕДИНСТВЕННОЕ чтение системного времени во всём пакете — см. шапку.
      clock: () => Date.now(),
      parentEnv: process.env,
      // **R12**: сборка сегмента без записи гейта не стартует. Умолчания «рендерить» нет —
      // см. `gateFromArgv`.
      gate: gateFromArgv(process.argv.slice(2)),
    });
  } catch (err) {
    if (err instanceof RenderAdapterError) {
      response = {
        ok: false,
        error: { rule: err.rule, message: err.message, details: err.problems },
      };
    } else {
      response = {
        ok: false,
        error: { rule: 'прогон', message: String((err as Error).message), details: [] },
      };
    }
  }

  // Обычный `JSON.stringify`, а не `canonicalJson`: канонический вид нужен ХЭШИРУЕМЫМ
  // величинам (ADR-0007 §3, инвариант D4 — запрет `JSON.stringify` вне `canonical/json.ts`
  // действует на `packages/*/src/**`, а это `bin/`). Ответ подпроцесса не хэшируется ничем:
  // он читается вызывающим и попадает в отчёт сборки.
  process.stdout.write(JSON.stringify(response) + '\n');
  if (!response.ok) {
    process.stderr.write(`vpe-render-segment: ${response.error.rule}: ${response.error.message}\n`);
  }
  return response.ok ? 0 : 1;
}

process.exitCode = await main();
