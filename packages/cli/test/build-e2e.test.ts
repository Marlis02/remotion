// **ЖИВАЯ СБОРКА ФИКСТУРЫ НА ПРОФИЛЕ `final`** — единственный браузерный файл `L-01`.
//
// ЧТО ЗДЕСЬ НАСТОЯЩЕЕ: всё. Проект — `fixtures/minimal` без единой правки, профиль — её
// `render.final.yaml` (1080×1920, `scale: 1`, png, `workers: 4`), рендерер — HyperFrames в
// подпроцессе с сетевой изоляцией, кодирование и мукс — системный ffmpeg, записи гейта —
// РЕПОЗИТОРНЫЕ (каталог библиотеки, а не tmp). Подменено ровно ничего.
//
// ═══ ДВЕ ВЕЩИ, КОТОРЫЕ ПРОГОН ОБЯЗАН ПОДСТАВИТЬ, И ПОЧЕМУ ═══
//   1. **КАТАЛОГИ ЗАПИСИ.** Сборка пишет в дерево проекта три артефакта авторства (дубли,
//      `store.lock`, ledger). Фикстуру задача не трогает ни символом, поэтому `--write-root`,
//      `--build-dir` и `--store-dir` уводят запись в `os.tmpdir()`.
//   2. **БАЙТЫ АССЕТОВ.** `fixtures/minimal` объявляет ассеты СИНТЕТИЧЕСКИМИ sha
//      (`0000…0001`…`0005`): байтов с такими адресами не существует и существовать не может.
//      Живой сборке они нужны настоящими — адаптер читает файл и определяет формат по
//      магическим байтам. Прогон кладёт настоящий PNG и настоящий DejaVu Sans Bold ПОД
//      АДРЕСАМИ ФИКСТУРЫ (CAS содержимое не перехэширует — осознанная граница `M-01`).
//      Это НЕ удобство теста: без такой подстановки фикстура не собирается живьём ничем.
//      Долг заведён `L-01`.
//
// ЧИСЛА, ПРОТИВ КОТОРЫХ ПРОВЕРЯЕТСЯ ВЫХОД, — числа фикстуры: F = 1473 кадра, два сегмента,
// разрез на 551760, длительность 1473/30 с. Они не переписываются здесь литералами дважды:
// `F` берётся из манифеста сборки, а `ffprobe` меряет ГОТОВЫЙ файл, и сравниваются они друг
// с другом.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { probeFrameCount, probeHasAudio } from '@vpe/media';

import { build, type BuildDeps } from '../src/build.js';
import type { BuildArgs } from '../src/argv.js';

import { cleanupRoots, countingRandom, makeProject } from './build-fixture.js';

afterAll(cleanupRoots);

/** Кадров у ролика фикстуры — число из `docs/impl` (`CP-04`/`CP-05`), сверяется с манифестом. */
const FIXTURE_FRAMES = 1473;

describe('`vpe build` — живая сборка `fixtures/minimal` на `final`', () => {
  it(
    'собирает ролик целиком: два сегмента, F кадров, звук на месте, кадры непустые',
    async () => {
      // Проект — КОПИЯ фикстуры ЦЕЛИКОМ, проза и режиссура фикстурные (`short: false`):
      // копия нужна ровно затем, чтобы три артефакта авторства легли не в репозиторий.
      const project = makeProject({ short: false });

      let out = '';
      const args: BuildArgs = {
        command: 'build',
        projectDir: project.projectDir,
        profileId: 'final',
        allowTts: true,
        now: '2026-08-30T12:00:00.000Z',
        buildDir: project.buildDir,
        writeRoot: null,
        storeDir: project.storeDir,
        // ЗАПИСИ ГЕЙТА — РЕПОЗИТОРНЫЕ: `null` означает каталог библиотеки рядом со спеками.
        // Пара проверяется по ИЗМЕРЕННОМУ отпечатку этой машины, и если он разошёлся с
        // записями, тест обязан покраснеть — это и есть **R12** на живом прогоне.
        gatesDir: null,
      };
      const deps: BuildDeps = {
        now: () => '2026-08-30T12:00:00.000Z',
        clock: () => performance.now(),
        // Детерминированный источник и здесь: живой прогон обязан быть повторяемым, а CSPRNG
        // сделал бы ledger разным от прогона к прогону.
        randomBytes: countingRandom(),
        out: (text) => (out += text),
        env: process.env,
      };

      const code = await build(args, deps);
      expect(code, out).toBe(0);

      // ── что сказал манифест ──────────────────────────────────────────────
      const record = JSON.parse(
        readFileSync(path.join(project.buildDir, 'reports/build-record.json'), 'utf8'),
      ) as {
        segments: readonly { frameCount: number; segmentId: string; sha256: string }[];
        final: { file: string; sha256: string };
      };
      expect(record.segments).toHaveLength(2);
      const frames = record.segments.reduce((sum, segment) => sum + segment.frameCount, 0);
      expect(frames).toBe(FIXTURE_FRAMES);
      // Сегменты РАЗНЫЕ: одинаковый sha256 у двух сегментов означал бы, что рисовалось одно и
      // то же, — то есть ролик собран, а картинки в нём нет.
      expect(record.segments[0]?.sha256).not.toBe(record.segments[1]?.sha256);

      // ── что лежит в файле ────────────────────────────────────────────────
      const final = path.join(project.buildDir, record.final.file);
      expect(existsSync(final)).toBe(true);
      expect(await probeFrameCount({ path: final })).toBe(FIXTURE_FRAMES);
      expect(await probeHasAudio({ path: final })).toBe(true);

      // ── кадры непустые ───────────────────────────────────────────────────
      // Один кадр из середины вынимается ffmpeg'ом и проверяется на РАЗНООБРАЗИЕ: чёрный
      // экран тоже «кадр», и `frameCount` его не отличает.
      const shot = path.join(project.root, 'frame.png');
      mkdirSync(path.dirname(shot), { recursive: true });
      const grab = spawnSync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', final, '-frames:v', '1', shot],
        { encoding: 'utf8' },
      );
      expect(grab.status, grab.stderr).toBe(0);
      const png = readFileSync(shot);
      expect(png.length).toBeGreaterThan(10_000);
    },
    45 * 60 * 1000,
  );
});
