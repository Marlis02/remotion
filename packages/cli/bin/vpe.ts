#!/usr/bin/env node
// ТОЧКА ВХОДА `vpe`: аргументы → команда → код выхода.
//
// ═══ ГРАНИЦА ПРОЦЕССА: ЗДЕСЬ ЧИТАЕТСЯ СИСТЕМНОЕ ВРЕМЯ ═══
// `Date`/`Date.now` запрещены инвариантом **D4** (ADR-0007 §4) во всём `packages/*/src/**`.
// Файл лежит в `bin/`, то есть вне зоны действия правила, — тем же приёмом, что
// `renderer-hyperframes/bin/render-segment.ts` (решение владельца `H-01`, поправка П1).
// Охранник `tests/lints/d4-clock-boundary.test.ts` перечисляет ОБА файла поимённо и краснеет,
// если часы появятся третьим местом.
//
// ПОЧЕМУ ЧАСЫ ВООБЩЕ НУЖНЫ. `GateRecord.date` — поле записи гейта (**R12**: «запись обязана
// содержать N, оба хэша, ДАТУ и отпечаток окружения — иначе она не отличима от „прогнали
// когда-то на другой машине“»). Дату знает только тот, кто снимает гейт, и она приезжает
// внутрь входом `now`, а не читается в `runGate`.
//
// КОДЫ ВЫХОДА — `EXIT` из `src/errors.ts`: 0 PASS · 1 отказ · 2 вход не разобрался ·
// 3 FLAKY · 4 FAIL · 5 `error` (гейта не было).

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runCli } from '../src/index.js';

import { envWithFile } from './env-file.js';
import { liveTransport } from './http.js';

// ═══ ГРАНИЦА ПРОЦЕССА: ЗДЕСЬ ЧИТАЕТСЯ `.env` ═══
// Секреты берутся ТОЛЬКО из окружения (CLAUDE.md §2), а `.env` — способ его наполнить, и
// потому он читается здесь же, где часы и случайность. Переменные процесса ИМЕЮТ ПРИОРИТЕТ
// над файлом, а денежный флаг `ELEVENLABS_LIVE` файл не даёт вовсе (решение владельца
// 2026-08-31): разрешение потратить деньги пишется рукой в командной строке.
const env = envWithFile(path.join(process.cwd(), '.env'), process.env);
const transport = liveTransport(process.env);

process.exitCode = await runCli(process.argv.slice(2), {
  // ЕДИНСТВЕННОЕ чтение стенных часов во всём пакете — см. шапку.
  now: () => new Date().toISOString(),
  clock: () => Date.now(),
  // ═══ ГРАНИЦА ПРОЦЕССА: ЗДЕСЬ БЕРЁТСЯ СЛУЧАЙНОСТЬ ═══
  // Минт якорей `w:` обязан идти из CSPRNG (ADR-0004 §4), а **V8** запрещает недетерминизм в
  // движке. Совмещаются они тем же приёмом, что часы: источник разрешён в ОДНОМ объявленном
  // месте — здесь, — а всё остальное берёт его параметром (`RandomBytes`, `C-04`).
  randomBytes: (byteLength) => new Uint8Array(randomBytes(byteLength)),
  // ═══ ГРАНИЦА ПРОЦЕССА: ЗДЕСЬ ЧИТАЕТСЯ STDIN ═══
  // Вход `vpe render-segment` — «JSON-запрос на stdin» (ADR-0008). Лениво: остальные команды
  // stdin не читают, и безусловное чтение fd 0 подвесило бы их на терминале.
  stdin: () => {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  },
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env,
  // ═══ ГРАНИЦА ПРОЦЕССА: ЗДЕСЬ ОТКРЫВАЕТСЯ СЕТЬ ═══
  // Единственный `fetch` движка (`bin/http.ts`), и он создаётся только при `ELEVENLABS_LIVE=1`.
  // Поля НЕТ вовсе, если флага нет: при `exactOptionalPropertyTypes: true` «поля нет» и «поле
  // есть со значением `undefined`» — разные типы, и первое читается однозначно («сети нет»).
  ...(transport === undefined ? {} : { httpTransport: transport }),
});
