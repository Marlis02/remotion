// **ВОСЕМЬ ФАЙЛОВ ЗАПРОСОВ ГЕЙТА СВЕРЯЮТСЯ С БИЛДЕРОМ ПОБАЙТОВО.** Браузер здесь не нужен.
//
// ЧТО ЭТО ЗА ФАЙЛЫ. `gate-requests/<шаблон>.<профиль>.json` — вход команды
// `vpe template gate --request`, которой владелец снимает записи гейта V13 (решение владельца 5,
// RM1: ночного CI в v1 нет, гейты снимает автор руками). Порядок действий — `docs/gate-runbook.md`.
//
// ПОЧЕМУ СВЕРКА, А НЕ ПРОСТО НАЛИЧИЕ. Файлы ПРОИЗВОДНЫЕ: единственный источник — билдеры
// `test/fixture.ts` (долг №179: третьей копии фикстуры не заводится). Производное, которое
// никто не сверяет с источником, живёт своей жизнью ровно до первой правки источника — и
// тогда владелец снимает гейт на композиции, которой в репозитории уже нет. Здесь сверка
// ПОБАЙТОВАЯ, и в неё входит `bundle.hash`: правка `runtime.js`, шаблона или манифеста меняет
// хэш каталога композиции, и файл краснеет С ИМЕНЕМ, а не молча измеряет вчерашнее.
//
// КАК ОБНОВЛЯТЬ (образец — `pnpm golden:update` у `core-model`):
//   VPE_GATE_REQUESTS_UPDATE=1 pnpm vitest run packages/renderer-hyperframes/test/gate-requests.test.ts
// Обычный прогон флага не ставит и файлов не трогает. Перегенерация — ОСОЗНАННОЕ действие:
// в дифф обязано быть видно, какой хэш сдвинулся.
//
// ЧЕГО ЗДЕСЬ НЕТ. Нет сверки тройки **K4** с yaml-профилем и нет охранника №181: обе живут в
// команде, а `@vpe/schema` (то есть `readFamily`) в зависимостях этого пакета нет по ADR-0009.
// Они проверены в `packages/cli/test/gate-requests-cli.test.ts` — на ТЕХ ЖЕ файлах.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isInside } from '../src/validate.js';
import {
  GATE_REQUEST_CASES,
  GATE_REQUEST_PATHS,
  GATE_REQUEST_PROFILES,
  PNG_PATTERN_32,
  SYSTEM_FONT_PATH,
  buildGateRequestFile,
  gateRequestFileName,
  gateRequestsDir,
  sha256Hex,
} from './fixture.js';

/** Порождение восьми файлов дороже обычного юнита: восемь материализаций каталога композиции. */
const TIMEOUT = 120_000;

const UPDATE = process.env['VPE_GATE_REQUESTS_UPDATE'] === '1';
const DIR = gateRequestsDir();
const ASSET = path.join(DIR, GATE_REQUEST_PATHS.asset);

/** Все восемь пар (случай, профиль) — то, что обязано лежать файлами. */
const PAIRS = GATE_REQUEST_CASES.flatMap((kase) =>
  GATE_REQUEST_PROFILES.map((profile) => ({ kase, profile, name: gateRequestFileName(kase, profile) })),
);

const HOWTO =
  'Если расхождение ОСОЗНАННОЕ (правка билдера, шаблона или композиции) — перегенерировать: ' +
  '`VPE_GATE_REQUESTS_UPDATE=1 pnpm vitest run packages/renderer-hyperframes/test/gate-requests.test.ts` ' +
  '— и посмотреть дифф глазами: сдвиг `bundle.hash` означает, что ПРЕЖНИЕ записи гейта устарели.';

describe('`GATE-PREP` — ассет запросов лежит файлом и это те самые байты', () => {
  it('`assets/pattern-32.png` побайтово равен `PNG_PATTERN_32` фикстуры', () => {
    if (UPDATE) {
      mkdirSync(path.dirname(ASSET), { recursive: true });
      writeFileSync(ASSET, PNG_PATTERN_32);
    }
    expect(existsSync(ASSET), `нет файла ассета \`${ASSET}\`. ${HOWTO}`).toBe(true);
    // Сравниваются sha256, а не буферы: сообщение о разнице двух картинок в 32×32 нечитаемо,
    // а хэш называет факт «байты другие» одной строкой. Та же величина едет в `bundle.hash`.
    expect(sha256Hex(readFileSync(ASSET)), `байты \`${ASSET}\` разошлись с фикстурой. ${HOWTO}`).toBe(
      sha256Hex(PNG_PATTERN_32),
    );
  });
});

describe('`GATE-PREP` — восемь файлов запросов равны порождению билдера', () => {
  for (const { kase, profile, name } of PAIRS) {
    it(
      `\`${name}\` совпадает с билдером байт в байт`,
      async () => {
        const file = path.join(DIR, name);
        const built = await buildGateRequestFile(kase, profile);
        if (UPDATE) {
          mkdirSync(DIR, { recursive: true });
          writeFileSync(file, built, 'utf8');
        }
        expect(existsSync(file), `нет файла запроса \`${file}\`. ${HOWTO}`).toBe(true);
        expect(readFileSync(file, 'utf8'), `\`${name}\` разошёлся с билдером. ${HOWTO}`).toBe(built);
      },
      TIMEOUT,
    );
  }

  it('в каталоге ровно восемь файлов запросов — ни одного лишнего', () => {
    const found = readdirSync(DIR)
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    // Лишний файл — это запрос, которого не порождает билдер: его никто не сверяет, а
    // владелец увидит его в каталоге наравне с настоящими и может снять по нему гейт.
    expect(found, `лишние или пропавшие файлы в \`${DIR}\`. ${HOWTO}`).toEqual(
      PAIRS.map((pair) => pair.name).sort(),
    );
  });
});

describe('`GATE-PREP` — пути внутри файлов: относительные разрешимы, шрифт системный', () => {
  for (const { name } of PAIRS) {
    it(`\`${name}\`: ассет резолвится от каталога файла, шрифт абсолютен, R2 соблюдён`, () => {
      const parsed = JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as {
        tmpDir: string;
        outputPath: string;
        bundle: { path: string };
        assets: readonly { path: string }[];
        fonts: readonly { path: string }[];
      };

      // ── ассет: относительный и УКАЗЫВАЕТ НА СУЩЕСТВУЮЩИЙ ФАЙЛ ────────────────────────
      // Относительность — решение владельца `GATE-PREP`: абсолютный путь привязал бы файлы к
      // одному чекауту, а владелец работает с двух машин. Резолвит команда — от каталога
      // ФАЙЛА ЗАПРОСА, не от `cwd`.
      for (const asset of parsed.assets) {
        expect(path.isAbsolute(asset.path), `\`${name}\`: ассет обязан быть ОТНОСИТЕЛЬНЫМ`).toBe(false);
        expect(existsSync(path.resolve(DIR, asset.path)), `\`${name}\`: ассет \`${asset.path}\` не резолвится`).toBe(true);
      }

      // ── шрифт: системный абсолютный (долг №187 — он приезжает из машины, а не из проекта) ──
      for (const font of parsed.fonts) {
        expect(font.path, `\`${name}\`: шрифт обязан быть системным абсолютным`).toBe(SYSTEM_FONT_PATH);
      }

      // ── три плейсхолдера: их перекрывает `requestForRun`, но форму держит валидатор ──────
      expect(parsed.tmpDir).toBe(GATE_REQUEST_PATHS.tmpDir);
      expect(parsed.outputPath).toBe(GATE_REQUEST_PATHS.outputPath);
      expect(parsed.bundle.path).toBe(GATE_REQUEST_PATHS.bundlePath);
      // **R2** проверяется на РАЗРЕШЁННЫХ путях: каталог композиции внутри `tmpDir`, выход —
      // снаружи. Проверка здесь, а не «на глаз в файле», потому что отказ команды по R2
      // владелец увидел бы уже во время ручного гейта.
      const tmpDir = path.resolve(DIR, parsed.tmpDir);
      expect(isInside(tmpDir, path.resolve(DIR, parsed.bundle.path))).toBe(true);
      expect(isInside(tmpDir, path.resolve(DIR, parsed.outputPath))).toBe(false);
    });
  }
});
