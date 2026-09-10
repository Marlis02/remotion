// **ЖИВАЯ СБОРКА ДЕМО ШАБЛОНА** — единственный браузерный файл `TPL-01c` (охранник §B5.2).
//
// ЧТО ЗДЕСЬ НАСТОЯЩЕЕ: всё. Демо — `kenburns@1/demo/demo.json` из репозитория без единой
// правки, профиль — `draftHalf` скелета демо-проекта, рендерер — HyperFrames в подпроцессе с
// сетевой изоляцией, кодирование и мукс — системный ffmpeg, записи гейта — РЕПОЗИТОРНЫЕ.
// Подменено ровно ничего: команда сама разворачивает временный проект и сама сеет свой CAS.
//
// ПОЧЕМУ ИМЕННО `kenburns@1`. Он единственный ДВИГАЕТ пиксели и при этом показывает ТРИ
// пресета в трёх сценах — то есть один прогон проверяет и «шаблон рисует», и «демо
// показывает все пресеты», и «сегментов больше одного». Демо на `still@1` было бы дешевле и
// проверяло бы неподвижную картинку.
//
// ПОЧЕМУ ДВА ПРОГОНА И ПОЧЕМУ ОБА С `--no-cache`. Утверждение теста — «демо ВОСПРОИЗВОДИМО»,
// а попадание межсборочного кэша (`CACHE-01`) сделало бы второй прогон копированием байтов:
// равенство `sha256` тогда доказывало бы работу кэша, а не детерминизм сборки. С `noCache`
// оба прогона рендерят по-настоящему, и равенство означает то, что написано.
//
// ЧИСЛА НЕ ПЕРЕПИСЫВАЮТСЯ ЛИТЕРАЛАМИ: кадры берутся из `demo-record.json`, который пишет
// сама команда, а `ffprobe` меряет ГОТОВЫЙ файл — сравниваются они друг с другом.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { probeFrameCount, probeHasAudio } from '@vpe/media';

import type { TemplateDemoArgs } from '../src/argv.js';
import { templateDemo, type TemplateDemoDeps } from '../src/template-demo.js';
import { EXIT } from '../src/errors.js';

import { countingRandom } from './build-fixture.js';

const TEMPLATE = 'kenburns@1';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface DemoRecordShape {
  readonly template: string;
  readonly profileId: string;
  readonly frames: number;
  readonly segments: number;
  readonly final: { readonly file: string; readonly sha256: string };
  readonly presetsShown: readonly string[];
  readonly presetsDeclared: readonly string[];
}

/** Один прогон команды в свой каталог. Возвращает запись демо и путь ролика. */
async function runDemo(): Promise<{ record: DemoRecordShape; final: string; out: string }> {
  const out = mkdtempSync(path.join(tmpdir(), 'vpe-demo-e2e-'));
  roots.push(out);

  let printed = '';
  const args: TemplateDemoArgs = {
    command: 'template demo',
    template: TEMPLATE,
    profileId: 'draftHalf',
    out,
    // ЗАПИСИ ГЕЙТА — РЕПОЗИТОРНЫЕ: `null` означает каталог библиотеки рядом со спеками. Пара
    // проверяется по ИЗМЕРЕННОМУ отпечатку этой машины, и если он разошёлся с записями, тест
    // обязан покраснеть — это и есть **R12** на живом прогоне.
    gatesDir: null,
    now: '2026-09-10T12:00:00.000Z',
    noCache: true,
    keepTmp: false,
  };
  const deps: TemplateDemoDeps = {
    now: () => '2026-09-10T12:00:00.000Z',
    clock: () => performance.now(),
    // Детерминированный источник: живой прогон обязан быть повторяемым, а CSPRNG сделал бы
    // ledger разным от прогона к прогону.
    randomBytes: countingRandom(),
    out: (text) => (printed += text),
    err: (text) => (printed += text),
    env: process.env,
  };

  const code = await templateDemo(args, deps);
  expect(code, printed).toBe(EXIT.pass);

  const dir = path.join(out, TEMPLATE);
  const record = JSON.parse(
    readFileSync(path.join(dir, 'demo-record.json'), 'utf8'),
  ) as DemoRecordShape;
  return { record, final: path.join(dir, record.final.file), out };
}

describe('`vpe template demo kenburns@1 --profile draftHalf` — живая сборка', () => {
  it(
    'даёт `final.mp4`, кадров больше нуля, два прогона — ТОТ ЖЕ sha256',
    async () => {
      const first = await runDemo();

      expect(existsSync(first.final), first.final).toBe(true);
      expect(path.basename(first.final)).toBe('final.mp4');
      expect(first.record.template).toBe(TEMPLATE);
      expect(first.record.profileId).toBe('draftHalf');

      // Кадры: число из записи демо сверяется с ИЗМЕРЕННЫМ у готового файла.
      expect(first.record.frames).toBeGreaterThan(0);
      expect(await probeFrameCount({ path: first.final })).toBe(first.record.frames);
      // Дорожка на месте: демо без звука было бы демо половины конвейера.
      expect(await probeHasAudio({ path: first.final })).toBe(true);

      // Демо показывает ВСЕ пресеты шаблона — то, ради чего оно и заведено.
      expect(first.record.presetsShown).toEqual(first.record.presetsDeclared);
      expect(first.record.presetsShown.length).toBeGreaterThan(1);
      // Три сцены — три сегмента: демо `kenburns@1` показывает пресеты ПОСЛЕДОВАТЕЛЬНО.
      expect(first.record.segments).toBe(first.record.presetsShown.length);

      const second = await runDemo();
      expect(second.record.final.sha256).toBe(first.record.final.sha256);
      expect(second.record.frames).toBe(first.record.frames);
      expect(second.record.segments).toBe(first.record.segments);
    },
    45 * 60 * 1000,
  );
});
