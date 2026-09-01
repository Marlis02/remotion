// **AC4 В КОММИТ-ЦИКЛЕ: ДВА ПРОГОНА ФИКСТУРЫ НА `render.ac4.yaml`** (`F-01`; **D10**, **D11**).
//
// БРАУЗЕР ЗДЕСЬ НАСТОЯЩИЙ, И ЭТО ВЕСЬ СМЫСЛ ФАЙЛА. Подменённый рендерер (как в `build.test.ts`)
// отвечал бы на вопрос «детерминирована ли наша обвязка», а Charter AC4 спрашивает про ПАРУ
// (рендерер+бэкенд, композиция): `FACT` (серия SP-3) — из десяти измеренных пар гейт прошли
// четыре, и правила, предсказывающего исход, не найдено. Заглушка сделала бы тест зелёным
// ровно там, где он обязан краснеть.
//
// ═══ ПОЧЕМУ ТЕСТ ЗОВЁТ ТУ ЖЕ КОМАНДУ, ЧТО И НОЧНОЙ ПРОГОН ═══
// `verifyAc4` — единственная реализация сверки на оба контура (`F-01`, решения задачи).
// Второй, «тестовый», путь сравнения означал бы, что ночью и в коммит-цикле проверяются
// разные утверждения, а расхождение между ними никто не заметит: у теста нет читателя, кроме
// красного цвета. Отличие контуров — РАЗМЕР ПРОБЫ, а не способ сверки.
//
// ЧТО ЗДЕСЬ ФИКСТУРНОЕ: профиль (`fixtures/minimal/profiles/render.ac4.yaml` ДОСЛОВНО, копией
// вместе с проектом), геометрия, кадр, звук. ЧТО ПОДМЕНЕНО: проза — короткая (`makeProject`),
// потому что ADR-0007 §10 говорит буквально «в коммит-цикле — СОКРАЩЁННАЯ фикстура (≤ 3 с
// видео) на ТОМ ЖЕ профиле», и байты ассетов под адресами фикстуры (см. `build-fixture.ts`).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readProject, readRenderProfile } from '../src/build-stages/inputs.js';
import type { BuildRecord } from '../src/build-stages/record.js';
import { AC4_PROFILE_ID } from '../src/ac4.js';
import { verifyAc4, type VerifyAc4Deps } from '../src/verify-ac4.js';
import type { VerifyAc4Args } from '../src/argv.js';

import { cleanupRoots, countingRandom, makeProject } from './build-fixture.js';

afterAll(cleanupRoots);

describe('**AC4** — два прогона фикстуры на `render.ac4.yaml` дают один ролик', () => {
  it(
    'равны `framemd5` сегментов, байты финала и sha256 ДЕКОДИРОВАННОГО PCM; проба ≤ предела',
    async () => {
      const project = makeProject();

      let out = '';
      let err = '';
      const args: VerifyAc4Args = {
        command: 'verify ac4',
        projectDir: project.projectDir,
        // Профиль называет ПРОЕКТ (`profiles.renderAc4`), а не тест: подмена файла здесь
        // означала бы, что измерено не то, что лежит в фикстуре.
        profilePath: null,
        runRoot: path.join(project.root, 'ac4'),
        storeDir: project.storeDir,
        allowTts: true,
        now: '2026-09-01T00:00:00.000Z',
      };
      const deps: VerifyAc4Deps = {
        now: () => '2026-09-01T00:00:00.000Z',
        clock: () => performance.now(),
        // Детерминированный источник минта: CSPRNG сделал бы ledger разным у двух прогонов —
        // и красный AC4 означал бы «якоря другие», а не «кадры другие».
        randomBytes: countingRandom(),
        out: (text) => (out += text),
        err: (text) => (err += text),
        env: process.env,
      };

      const code = await verifyAc4(args, deps);
      expect(code, `${out}\n${err}`).toBe(0);

      // ── проба помещается в предел профиля (**решение владельца В3, `F-01`**) ──
      // Утверждает ИМЕННО ТЕСТ, а не команда: `maxProbeDurationFrames` — правило
      // коммит-цикла (ADR-0007 §10), и на настоящем ролике оно неприменимо по построению
      // (`examples/ai-test-1` — 1119 кадров). Здесь же превышение означает, что проба
      // разрослась и коммит-цикл начал платить за неё минутами.
      const inputs: never[] = [];
      const read = readProject({
        projectDir: project.projectDir,
        buildDir: path.join(project.root, 'ac4', 'run-1'),
        takesRoot: null,
        storeDir: project.storeDir,
      });
      const profile = readRenderProfile(
        read.layout.projectRoot,
        read.project,
        AC4_PROFILE_ID,
        inputs,
      );
      const record = JSON.parse(
        readFileSync(path.join(project.root, 'ac4/run-1/reports/build-record.json'), 'utf8'),
      ) as BuildRecord;
      const frames = record.segments.reduce((sum, segment) => sum + segment.frameCount, 0);
      expect(profile.maxProbeDurationFrames).toBeDefined();
      expect(
        frames,
        `проба AC4 — ${String(frames)} кадров при пределе ` +
          `${String(profile.maxProbeDurationFrames)}: ADR-0007 §10 говорит «в коммит-цикле — ` +
          'сокращённая фикстура (≤ 3 с видео)». Полный прогон живёт в `vpe verify ac4`.',
      ).toBeLessThanOrEqual(profile.maxProbeDurationFrames ?? 0);

      // Прогон обязан быть ВИДЕН: «AC4 зелёный» без строки про пропущенный гейт читалось бы
      // как «пара проверена V13», а на этом профиле его нет (решение владельца 12).
      expect(out).toContain('гейт V13 не спрашивается');
      expect(out).toContain('AC4: ПРОГОНЫ РАВНЫ');
    },
    45 * 60 * 1000,
  );
});
