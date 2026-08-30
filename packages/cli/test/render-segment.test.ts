// **`vpe render-segment`** (`L-02`) — вторая граница того же контракта ADR-0008.
//
// ═══ ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ ═══
// **Живого рендера нет ни одного, и нового браузерного файла задача не завела.** Границу
// ПРОЦЕССА уже держит [`renderer-hyperframes/test/subprocess.test.ts`](../../renderer-hyperframes/test/subprocess.test.ts):
// он гоняет ту же точку входа настоящим `spawn` из `dist/bin/`, включая живой рендер сегмента
// и сверку «через spawn то же, что функцией». Тело у обеих точек входа с `L-02` ОДНО
// (`runSegmentEntry`), поэтому второй живой прогон измерял бы ровно то же самое второй раз.
// Здесь проверяется то, чего тот файл не знает: разбор аргументов КОМАНДЫ, коды выхода `cli`
// и форма того, что команда печатает.
//
// Все тесты ниже — договорные отказы: до браузера не доходит ни один (**R12** отвергает
// сегмент раньше, ровно как у бинаря).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { canonicalJson } from '@vpe/core-model';
import { SEGMENT_ENTRY_EXIT, type RenderResponse } from '@vpe/renderer-hyperframes';

import { EXIT, RENDER_SEGMENT_EXIT, runCli, type CliDeps } from '../src/index.js';
import { makeRequest } from './fixture.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-l02-rs-'));
  roots.push(root);
  return root;
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Запускает команду с ПОДАННЫМ stdin. Ни одна глобаль не подменяется — см. `CliDeps`. */
async function run(argv: readonly string[], stdin: string): Promise<Run> {
  let out = '';
  let err = '';
  const deps: CliDeps = {
    now: () => '2026-08-30T00:00:00.000Z',
    clock: () => 0,
    randomBytes: (byteLength: number) => new Uint8Array(byteLength),
    stdin: () => stdin,
    // ПУСТОЕ ОКРУЖЕНИЕ: команда обязана быть функцией того, что несёт запрос. Если бы она
    // читала `process.env` мимо депы, тесты этого файла отвечали бы про машину, а не про вход.
    env: {},
    out: (text) => (out += text),
    err: (text) => (err += text),
  };
  return { code: await runCli(argv, deps), out, err };
}

/** Ответ со stdout. Заодно утверждает, что напечатанное — валидный JSON, а не текст. */
function responseOf(result: Run): RenderResponse {
  return JSON.parse(result.out) as RenderResponse;
}

describe('коды выхода: у одного контракта один набор чисел', () => {
  it('коды тела точки входа и коды команды — одни и те же три числа', () => {
    expect(RENDER_SEGMENT_EXIT.ok).toBe(SEGMENT_ENTRY_EXIT.ok);
    expect(RENDER_SEGMENT_EXIT.refusal).toBe(SEGMENT_ENTRY_EXIT.refusal);
    expect(RENDER_SEGMENT_EXIT.input).toBe(SEGMENT_ENTRY_EXIT.input);
    expect([EXIT.pass, EXIT.refusal, EXIT.input]).toEqual([0, 1, 2]);
  });
});

describe('stdin не разобрался как JSON (**Н2**)', () => {
  it('код 2, stdout пуст, причина — строкой в stderr, а не стектрейсом', async () => {
    const result = await run(['render-segment'], 'это не json');

    expect(result.code).toBe(EXIT.input);
    // Пустой stdout при коде 2 — решение `H-01` («отвечать нечем и не о чем»), и обе точки
    // входа молчат ОДИНАКОВО: у бинаря это утверждает `subprocess.test.ts`.
    expect(result.out).toBe('');
    expect(result.err).toContain('stdin не разобрался как JSON');
    // Именно НЕ стектрейс: ни кадра стека, ни имени файла движка.
    expect(result.err).not.toContain('    at ');
    expect(result.err.startsWith('vpe-render-segment: stdin не разобрался')).toBe(true);
  });

  it('пустой stdin — тот же код 2: «запроса нет» и «запрос не разобрался» неразличимы по делу', async () => {
    const result = await run(['render-segment'], '');
    expect(result.code).toBe(EXIT.input);
    expect(result.out).toBe('');
  });
});

describe('договорные отказы приходят JSON-ответом на stdout', () => {
  it('валидный JSON, но не запрос ⇒ код 1, `ok: false`, правило `ADR-0008 форма`', async () => {
    const result = await run(['render-segment'], '{}');

    expect(result.code).toBe(EXIT.refusal);
    const response = responseOf(result);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.rule).toBe('ADR-0008 форма');
    // Перечень проблем — списком, а не первой попавшейся: у формы бывает много дыр сразу.
    expect(response.error.details.length).toBeGreaterThan(1);
  });

  it('настоящий запрос с ПУСТЫМ окружением ⇒ отказ `preflight` ответом, а не стектрейсом', async () => {
    const request = makeRequest(tempRoot());
    const result = await run(['render-segment'], JSON.stringify(request));

    expect(result.code).toBe(EXIT.refusal);
    const response = responseOf(result);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    // ПОЧЕМУ `preflight`, А НЕ `R12`. Окружение здесь пусто по построению (см. `run`), а
    // отпечаток машины меряется ДО решения о гейте: у **R12** пара — это (профиль, отпечаток),
    // и спрашивать про запись, не измерив вторую половину пары, было бы спрашиванием про
    // другую пару. Без `PATH` не резолвится ffmpeg — отказ приходит оттуда.
    //
    // Тест намеренно НЕ требует здесь `R12`: чтобы дойти до него, нужна машина с браузером и
    // ffmpeg, то есть это был бы браузерный тест в юнит-файле. Что **R12** отвергает сегмент
    // раньше первого кадра, утверждают два теста ниже (аргументы гейта) и живой
    // `subprocess.test.ts` — на той же точке входа.
    expect(response.error.rule).toBe('preflight');
    expect(result.err).toContain('preflight');
  });

  it('`--gate-profile ac4` ⇒ `R12`: профилей гейта ровно два', async () => {
    const request = makeRequest(tempRoot());
    const result = await run(
      ['render-segment', '--gate-profile', 'ac4'],
      JSON.stringify(request),
    );

    expect(result.code).toBe(EXIT.refusal);
    const response = responseOf(result);
    if (response.ok) return;
    expect(response.error.rule).toBe('R12');
    expect(response.error.message).toContain('final');
    expect(response.error.message).toContain('draftHalf');
  });

  it('`--gate-skip` с пустой причиной ⇒ `R12`: проход без следа запрещён', async () => {
    const request = makeRequest(tempRoot());
    const result = await run(['render-segment', '--gate-skip', '   '], JSON.stringify(request));

    const response = responseOf(result);
    if (response.ok) return;
    expect(response.error.rule).toBe('R12');
    expect(response.error.details[0]?.at).toBe('RenderOptions.gate.why');
  });

  it('ответ на stdout — КАНОНИЧЕСКАЯ форма и ровно одна строка', async () => {
    const result = await run(['render-segment'], '{}');
    expect(result.out.endsWith('\n')).toBe(true);
    expect(result.out.trimEnd().split('\n')).toHaveLength(1);
    // Печатается `canonicalJson` (в `src/**` `JSON.stringify` запрещён линтом): признак —
    // текст равен канонической форме разобранного значения.
    expect(result.out.trimEnd()).toBe(canonicalJson(responseOf(result)));
  });
});

describe('аргументы команды разбираются ДО запроса', () => {
  it('неизвестный флаг ⇒ отказ `argv` и код 2, а не отказ `R12`', async () => {
    const result = await run(['render-segment', '--gate-skipp', 'опечатка'], '{}');
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('неизвестный флаг `--gate-skipp`');
    expect(result.err).not.toContain('R12');
    expect(result.out).toBe('');
  });

  it('путь к запросу аргументом ⇒ отказ: запрос приезжает на stdin (ADR-0008)', async () => {
    const result = await run(['render-segment', 'request.json'], '{}');
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('НА STDIN');
  });

  it('`--gate-profile` без значения ⇒ отказ `argv`, а не профиль `final` по умолчанию', async () => {
    const result = await run(['render-segment', '--gate-profile'], '{}');
    expect(result.code).toBe(EXIT.input);
    expect(result.err).toContain('требует значения');
  });

  it('команда названа в `USAGE` вместе с тем, что запрос — на stdin', async () => {
    const result = await run(['--help'], '');
    expect(result.err).toContain('vpe render-segment');
    expect(result.err).toContain('stdin');
  });
});
