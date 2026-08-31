// **~~ВОСЕМЬ~~ ДЕСЯТЬ ФАЙЛОВ ЗАПРОСОВ ГЕЙТА СВЕРЯЮТСЯ С БИЛДЕРОМ ПОБАЙТОВО.** Браузер здесь
// не нужен. *(восемь — `GATE-PREP`; девятый и десятый — `grade@1`, `E-07`, 2026-08-31.)*
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
  GATE_FONT_PATH,
  GATE_FONT_SHA256,
  PNG_PATTERN_32,
  buildGateRequestFile,
  gateRequestFileName,
  gateRequestsDir,
  sha256Hex,
} from './fixture.js';

/** Порождение десяти файлов дороже обычного юнита: десять материализаций каталога композиции. */
const TIMEOUT = 120_000;

const UPDATE = process.env['VPE_GATE_REQUESTS_UPDATE'] === '1';
const DIR = gateRequestsDir();
const ASSET = path.join(DIR, GATE_REQUEST_PATHS.asset);
const FONT = path.join(DIR, GATE_REQUEST_PATHS.font);

/** Все ДЕСЯТЬ пар (случай, профиль) — то, что обязано лежать файлами. */
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

describe('`ENV-01` — шрифт запросов лежит файлом и это те самые байты (долг №187)', () => {
  // ЧЕМ ЭТОТ ФАЙЛ ОТЛИЧАЕТСЯ ОТ СОСЕДА СВЕРХУ. `pattern-32.png` ПРОИЗВОДНЫЙ: его порождает
  // литерал фикстуры, и `VPE_GATE_REQUESTS_UPDATE=1` его перезаписывает. Шрифт — ИСХОДНЫЙ:
  // 705684 байта пришли из системного пакета `fonts-dejavu-core` один раз, породить их нечем,
  // и флаг обновления его НЕ трогает. Значит, здесь не сверка с источником, а утверждение о
  // самих байтах: под ними сняты десять записей гейта.
  it('`assets/DejaVuSans-Bold.ttf` есть, и его sha равен объявленному `d1c3ff99…`', () => {
    expect(
      existsSync(FONT),
      `нет файла шрифта \`${FONT}\`. Он лежит в репозитории с \`ENV-01\` и ничем не ` +
        'порождается — восстанавливать из git, а не перегенерировать',
    ).toBe(true);
    expect(
      sha256Hex(readFileSync(FONT)),
      `байты \`${FONT}\` разошлись с объявленными. Другой шрифт — другой \`bundle.hash\`, ` +
        'то есть ДЕСЯТЬ записей гейта устарели',
    ).toBe(GATE_FONT_SHA256);
  });

  // Контроль того, что путь фикстуры и путь этого теста — один файл. Без него константа
  // `GATE_FONT_PATH` могла бы указывать куда угодно: билдер читал бы один файл, тест сверял
  // другой, и оба были бы зелены.
  it('`GATE_FONT_PATH` фикстуры — тот же файл, что адресует `GATE_REQUEST_PATHS.font`', () => {
    expect(path.resolve(GATE_FONT_PATH)).toBe(path.resolve(FONT));
  });
});

describe('`GATE-PREP`/`E-07` — десять файлов запросов равны порождению билдера', () => {
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

  it('в каталоге ровно десять файлов запросов — ни одного лишнего', () => {
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

describe('`GATE-PREP`/`ENV-01` — пути внутри файлов: относительные разрешимы, R2 соблюдён', () => {
  for (const { name } of PAIRS) {
    it(`\`${name}\`: ассет и шрифт резолвятся от каталога файла, R2 соблюдён`, () => {
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

      // ── шрифт: ~~системный абсолютный~~ ИЗ КАТАЛОГА ЗАПРОСОВ ─────────────────────────
      // *(перевёрнуто: `ENV-01`, 2026-08-31 — долг №187 закрыт.)* Прежнее утверждение стерегло
      // РОВНО ТО, из-за чего юнит был непроходим на чужой машине: «путь обязан быть
      // `/usr/share/fonts/…`» зелено ровно там, где этот файл лежит и совпадает побайтово.
      // Теперь шрифт — такой же ассет, как картинка, и проверяется тем же тройным способом:
      // путь ОТНОСИТЕЛЕН, файл по нему СУЩЕСТВУЕТ, и его БАЙТЫ те самые. Третьего мало кому
      // хватает и здесь оно главное: под этими байтами посчитаны `bundle.hash` десяти
      // запросов и сняты десять записей гейта.
      for (const font of parsed.fonts) {
        expect(path.isAbsolute(font.path), `\`${name}\`: шрифт обязан быть ОТНОСИТЕЛЬНЫМ`).toBe(false);
        const resolved = path.resolve(DIR, font.path);
        expect(existsSync(resolved), `\`${name}\`: шрифт \`${font.path}\` не резолвится`).toBe(true);
        expect(
          sha256Hex(readFileSync(resolved)),
          `\`${name}\`: шрифт \`${font.path}\` — не те байты, под которыми сняты записи гейта`,
        ).toBe(GATE_FONT_SHA256);
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
