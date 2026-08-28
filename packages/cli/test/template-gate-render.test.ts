// **КОМАНДА `vpe template gate` ЖИВЬЁМ** — гейт снимается настоящим браузером, запись
// ложится файлом во tmp, код выхода `0`.
//
// ═══ ЭТОТ ФАЙЛ ТРЕБУЕТ БРАУЗЕРА, ffmpeg И `unshare`/`ip`. SKIP'А ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у пяти браузерных файлов рендерера (решение владельца `H-01`, §4 п. 2):
// тест либо зелёный, либо красный, но не «пропущен». На приёмной машине без браузера он
// красный — это ШЕСТОЙ файл нормы, и он назван в отчёте `E-00`, чтобы норма пересчитывалась
// осознанно, а не «привыкли».
//
// ПОЧЕМУ ТЕСТОВЫЙ РЕЕСТР, А НЕ НАСТОЯЩИЙ ШАБЛОН. Реализаций шаблонов нет ни одной до `H-06`,
// то есть живой прогон команды на ПРОД-паре сегодня невозможен ПО ПОСТРОЕНИЮ. Синтетический
// `solid@1` доказывает сквозной путь команды: аргументы → каталог → `runGate` → N прогонов
// браузера → запись на диске. Он живёт в тестах и в прод-каталог не входит.
//
// `mountSource` живёт В ОТДЕЛЬНОМ ФАЙЛЕ `test/solid.ts` — не для красоты: греп **D4**
// (`tests/lints/d4-composition.test.ts`) запрещает часы и случайность во ВСЁМ файле рендер-пути,
// а тесту часы нужны законно (`performance.now` как вход `clock`). Разделение оставляет
// охранника строгим там, где он и должен быть строгим, — в коде композиции.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSegment, validateRequest } from '@vpe/renderer-hyperframes';
import { GateFileSchema, still1, type AnyTemplateSpec } from '@vpe/templates-spec';

import { EXIT, runCli, type CliDeps } from '../src/index.js';
import { makeRequest, tempDir, writeRenderProfile } from './fixture.js';
import { TEST_TEMPLATES } from './solid.js';

const FRAMES = 6;
const TIMEOUT = 900_000;

/**
 * Спек `solid@1`: манифест `still1` с подставленным ИМЕНЕМ.
 *
 * Настоящего спека `solid@1` нет и не будет — тот же приём, что в `H-04`: синтетический
 * шаблон доказывает путь, а не претендует на место в библиотеке.
 */
const SOLID_SPEC: AnyTemplateSpec = {
  ...still1,
  templateId: 'solid',
  manifest: { ...still1.manifest, templateId: 'solid', templateVersion: 1 },
};

/** Счётчик — там, где время не измеряется (проба `bundle.hash`). */
const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/**
 * Запрос с ВЕРНЫМ `bundle.hash`: его считает материализация, и узнать его можно только у неё.
 * Приём — из `render.test.ts`/`gate-render.test.ts` (`H-01`, `H-04`).
 */
async function readyRequest(root: string): Promise<{ request: unknown; hash: string }> {
  const raw = makeRequest(root, { template: 'solid@1', frames: FRAMES });
  const probe = await renderSegment(validateRequest(raw), {
    clock: fakeClock(),
    gate: { mode: 'skip', why: 'подготовка запроса к гейту: считается `bundle.hash`, рендера ещё не было' },
    registry: TEST_TEMPLATES,
    spawnRenderer: () => Promise.resolve(0),
  });
  if (probe.ok) throw new Error('ожидался отказ по `bundle.hash`');
  const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
  if (hash === undefined) throw new Error(probe.error.message);
  const request = makeRequest(root, { template: 'solid@1', frames: FRAMES, bundleHash: hash });
  return { request, hash };
}

describe('`vpe template gate` живьём: `solid@1`, профиль `draftHalf`, N = 3', () => {
  it(
    'команда снимает гейт настоящим браузером и КЛАДЁТ ЗАПИСЬ ФАЙЛОМ; код выхода 0',
    async () => {
      const root = tempDir('cmd');
      const gatesDir = tempDir('cmd-lib');
      const { request, hash } = await readyRequest(root);
      const requestFile = path.join(root, 'request.json');
      writeFileSync(requestFile, JSON.stringify(request), 'utf8');
      const profileFile = writeRenderProfile(root);

      let out = '';
      let err = '';
      const deps: CliDeps = {
        now: () => '2026-08-29T00:00:00Z',
        // Живой прогон — НАСТОЯЩИЕ часы: в таблице гейта стоит `wallMs`, и счётчик напечатал
        // бы там выдумку (`performance.now` в тестах законен, у них своя зона).
        clock: () => performance.now(),
        out: (text) => (out += text),
        err: (text) => (err += text),
        env: process.env,
        specs: [SOLID_SPEC],
        templates: TEST_TEMPLATES,
      };

      const code = await runCli(
        [
          'template',
          'gate',
          'solid@1',
          '--profile',
          'draftHalf',
          '--request',
          requestFile,
          '--render-profile',
          profileFile,
          '--gates-dir',
          gatesDir,
          '--run-root',
          path.join(root, 'runs'),
        ],
        deps,
      );

      // Печать — то, что увидит автор шаблона; она же уезжает в отчёт `E-00`.
      console.log(out);
      expect(code, `${out}\n${err}`).toBe(EXIT.pass);

      const file = path.join(gatesDir, 'solid@1.gates.json');
      expect(existsSync(file), out).toBe(true);
      expect(out).toContain(file);

      const parsed = GateFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      expect(parsed.templateId).toBe('solid');
      expect(parsed.entries).toHaveLength(1);
      const entry = parsed.entries[0];
      expect(entry?.gate.profileId).toBe('draftHalf');
      expect(entry?.gate.N).toBe(3);
      expect(entry?.gate.class).toBe('PASS');
      expect(entry?.gate.date).toBe('2026-08-29T00:00:00Z');
      // Отпечаток — НАСТОЯЩИЙ, этой машины (64 hex `blake3`, `H-03`), а не выдумка.
      expect(entry?.gate.engineFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      // `bundleHash` записи — тот же, что у композиции, на которой гейт снят.
      expect(entry?.bundleHash).toBe(hash);
      // Обе величины ADR-0008 записаны и различимы: файл и картинка — разные вопросы.
      expect(entry?.gate.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry?.gate.framemd5).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry?.gate.sha256).not.toBe(entry?.gate.framemd5);
    },
    TIMEOUT,
  );

  it(
    'записанный файл ЧИТАЕТСЯ каталогом обратно: `vpe template list` видит `PASS`',
    async () => {
      const root = tempDir('cmd2');
      const gatesDir = tempDir('cmd2-lib');
      const { request } = await readyRequest(root);
      const requestFile = path.join(root, 'request.json');
      writeFileSync(requestFile, JSON.stringify(request), 'utf8');
      const profileFile = writeRenderProfile(root);

      let out = '';
      const deps: CliDeps = {
        now: () => '2026-08-29T00:00:00Z',
        clock: () => performance.now(),
        out: (text) => (out += text),
        err: () => undefined,
        env: process.env,
        specs: [SOLID_SPEC],
        templates: TEST_TEMPLATES,
      };
      const argv = [
        'template',
        'gate',
        'solid@1',
        '--profile',
        'draftHalf',
        '--request',
        requestFile,
        '--render-profile',
        profileFile,
        '--gates-dir',
        gatesDir,
        '--run-root',
        path.join(root, 'runs'),
      ];

      expect(await runCli(argv, deps)).toBe(EXIT.pass);

      // Второй прогон той же команды: прежняя запись ДЕЙСТВУЮЩАЯ (та же машина, та же
      // композиция) и ЗАМЕЩАЕТСЯ свежей — записей по-прежнему одна.
      out = '';
      expect(await runCli(argv, deps)).toBe(EXIT.pass);
      expect(out).toMatch(/была ДЕЙСТВУЮЩЕЙ/u);

      const parsed = GateFileSchema.parse(
        JSON.parse(readFileSync(path.join(gatesDir, 'solid@1.gates.json'), 'utf8')),
      );
      expect(parsed.entries).toHaveLength(1);
    },
    TIMEOUT,
  );
});
