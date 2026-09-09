// **~~ВОСЕМЬ~~ ~~десять~~ ДВЕНАДЦАТЬ ФАЙЛОВ ЗАПРОСОВ ГЕЙТА СВЕРЯЮТСЯ С БИЛДЕРОМ ПОБАЙТОВО.**
// Браузер здесь не нужен. *(восемь — `GATE-PREP`; девятый и десятый — `grade@1`, `E-07`,
// 2026-08-31; одиннадцатый и двенадцатый — `parallax25@1`, `E-02`, 2026-08-31.)*
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
  PARALLAX_LAYER_PNGS,
  PNG_PATTERN_32,
  buildGateRequestFile,
  gateRequestFileName,
  gateRequestsDir,
  sha256Hex,
} from './fixture.js';

/** Порождение двенадцати файлов дороже обычного юнита: двенадцать материализаций композиции. */
const TIMEOUT = 120_000;

const UPDATE = process.env['VPE_GATE_REQUESTS_UPDATE'] === '1';

/**
 * **КАТАЛОГ ЗАПРОСОВ ТЕПЕРЬ СВОЙ У КАЖДОГО ШАБЛОНА** (`TPL-01a`, 2026-09-09): он лежит в папке
 * шаблона, `templates-spec/src/templates/<id>@<N>/gate-requests/`. Прежний общий `DIR` снят —
 * одного каталога больше нет, и ассеты вместе с ним разъехались по папкам (решение владельца
 * В2: общих ассетов почти нет — 705 KB шрифта нужны одному шаблону, а 432-байтовая шахматка
 * трём, и две её лишние копии дешевле, чем правка байтов двенадцати запросов).
 */
const dirOf = (call: string): string => gateRequestsDir(call);

/** Все ДВЕНАДЦАТЬ пар (случай, профиль) — то, что обязано лежать файлами. */
const PAIRS = GATE_REQUEST_CASES.flatMap((kase) =>
  GATE_REQUEST_PROFILES.map((profile) => ({
    kase,
    profile,
    name: gateRequestFileName(profile),
    dir: dirOf(kase.call),
    label: `${kase.call}/${gateRequestFileName(profile)}`,
  })),
);

const HOWTO =
  'Если расхождение ОСОЗНАННОЕ (правка билдера, шаблона или композиции) — перегенерировать: ' +
  '`VPE_GATE_REQUESTS_UPDATE=1 pnpm vitest run packages/renderer-hyperframes/test/gate-requests.test.ts` ' +
  '— и посмотреть дифф глазами: сдвиг `bundle.hash` означает, что ПРЕЖНИЕ записи гейта устарели.';

describe('`GATE-PREP` — ассет запросов лежит файлом и это те самые байты', () => {
  // **ТРИ КОПИИ ОДНОЙ ШАХМАТКИ, И ЭТО ЦЕНА, НАЗВАННАЯ ВЛАДЕЛЬЦЕМ** (`TPL-01a`, В2). Запрос
  // адресует ассет ОТНОСИТЕЛЬНЫМ путём от каталога САМОГО ФАЙЛА (`resolveRequestPaths`), и
  // единственный способ переехать в папки шаблонов, не тронув байты запросов, — положить файл
  // рядом с каждым, кто его просит. Просят трое, файл весит 432 байта, лишних копий две.
  // Список ВЫЧИСЛЯЕТСЯ из самих запросов, а не переписывается: восьмой шаблон, которому нужна
  // та же шахматка основанием, попадёт сюда сам — вместе со своим файлом.
  const owners = GATE_REQUEST_CASES.map((kase) => kase.call).filter((call) =>
    GATE_REQUEST_PROFILES.some((profile) =>
      (
        JSON.parse(
          readFileSync(path.join(dirOf(call), gateRequestFileName(profile)), 'utf8'),
        ) as { assets: readonly { path: string }[] }
      ).assets.some((asset) => asset.path === GATE_REQUEST_PATHS.asset),
    ),
  );

  for (const call of owners) {
    it(`\`${call}/gate-requests/assets/pattern-32.png\` побайтово равен \`PNG_PATTERN_32\``, () => {
      const asset = path.join(dirOf(call), GATE_REQUEST_PATHS.asset);
      if (UPDATE) {
        mkdirSync(path.dirname(asset), { recursive: true });
        writeFileSync(asset, PNG_PATTERN_32);
      }
      expect(existsSync(asset), `нет файла ассета \`${asset}\`. ${HOWTO}`).toBe(true);
      // Сравниваются sha256, а не буферы: сообщение о разнице двух картинок в 32×32 нечитаемо,
      // а хэш называет факт «байты другие» одной строкой. Та же величина едет в `bundle.hash`.
      expect(sha256Hex(readFileSync(asset)), `байты \`${asset}\` разошлись с фикстурой. ${HOWTO}`).toBe(
        sha256Hex(PNG_PATTERN_32),
      );
    });
  }
});

describe('`E-02` — два слоя параллакса лежат файлами и это те самые байты', () => {
  // ТА ЖЕ ПРИРОДА, ЧТО У `pattern-32.png`, И ТОТ ЖЕ ПОРЯДОК: файлы ПРОИЗВОДНЫЕ от литералов
  // фикстуры, `VPE_GATE_REQUESTS_UPDATE=1` их перезаписывает. Отличие одно и оно в предмете:
  // у ближнего слоя есть АЛЬФА, и именно она делает запрос гейта параллаксом, а не стопкой
  // непрозрачных прямоугольников. Байты сверяются, а альфа — нет: PNG здесь читать нечем
  // (декодера в пакете нет), и «в файле есть прозрачность» проверяется там, где есть браузер
  // (`parallax-cover.test.ts`).
  for (const [index, bytes] of PARALLAX_LAYER_PNGS.entries()) {
    const rel = GATE_REQUEST_PATHS.layers[index] ?? '';
    it(`\`${rel}\` побайтово равен слою ${String(index)} фикстуры`, () => {
      const file = path.join(dirOf('parallax25@1'), rel);
      if (UPDATE) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, bytes);
      }
      expect(existsSync(file), `нет файла слоя \`${file}\`. ${HOWTO}`).toBe(true);
      expect(sha256Hex(readFileSync(file)), `байты \`${file}\` разошлись с фикстурой. ${HOWTO}`).toBe(
        sha256Hex(bytes),
      );
    });
  }

  it('путей слоёв ровно столько же, сколько байтовых литералов', () => {
    // Разъехались бы — билдер писал бы в файл запроса путь `undefined` либо ронял
    // `relPathForRole`, и оба варианта заметны позже и хуже, чем эта строка.
    expect(GATE_REQUEST_PATHS.layers).toHaveLength(PARALLAX_LAYER_PNGS.length);
  });
});

const FONT = path.join(dirOf('captionEmphasis@1'), GATE_REQUEST_PATHS.font);

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
        'то есть ДВЕНАДЦАТЬ записей гейта устарели',
    ).toBe(GATE_FONT_SHA256);
  });

  // Контроль того, что путь фикстуры и путь этого теста — один файл. Без него константа
  // `GATE_FONT_PATH` могла бы указывать куда угодно: билдер читал бы один файл, тест сверял
  // другой, и оба были бы зелены.
  it('`GATE_FONT_PATH` фикстуры — тот же файл, что адресует `GATE_REQUEST_PATHS.font`', () => {
    expect(path.resolve(GATE_FONT_PATH)).toBe(path.resolve(FONT));
  });
});

describe('`GATE-PREP`/`E-07`/`E-02` — двенадцать файлов запросов равны порождению билдера', () => {
  for (const { kase, profile, name, dir, label } of PAIRS) {
    it(
      `\`${label}\` совпадает с билдером байт в байт`,
      async () => {
        const file = path.join(dir, name);
        const built = await buildGateRequestFile(kase, profile);
        if (UPDATE) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, built, 'utf8');
        }
        expect(existsSync(file), `нет файла запроса \`${file}\`. ${HOWTO}`).toBe(true);
        expect(readFileSync(file, 'utf8'), `\`${label}\` разошёлся с билдером. ${HOWTO}`).toBe(built);
      },
      TIMEOUT,
    );
  }

  // ~~В каталоге ровно двенадцать файлов.~~ *(изменено: `TPL-01a`.)* Каталог теперь свой у
  // каждого шаблона, и лишний файл ловится В ЕГО ПАПКЕ. Смысл прежний: запрос, которого не
  // порождает билдер, никто не сверяет, а владелец увидит его наравне с настоящими и может
  // снять по нему гейт.
  for (const kase of GATE_REQUEST_CASES) {
    it(`в \`${kase.call}/gate-requests/\` ровно два файла запросов — ни одного лишнего`, () => {
      const dir = dirOf(kase.call);
      const found = readdirSync(dir)
        .filter((entry) => entry.endsWith('.json'))
        .sort();
      expect(found, `лишние или пропавшие файлы в \`${dir}\`. ${HOWTO}`).toEqual(
        GATE_REQUEST_PROFILES.map((profile) => gateRequestFileName(profile)).sort(),
      );
    });
  }

  // **ОХРАННИК СИРОТ** (`TPL-01a`, компенсация к решению владельца В6). Список исключений
  // NUL-линта стал ПАТТЕРНОМ (`*@*/gate-requests/assets/**`), и без этой строки под паттерн
  // прошёл бы любой бинарник, который никто не сверяет. Здесь правило обратное к «лишнему
  // запросу»: каждый файл ассета обязан быть НАЗВАН хотя бы одним запросом своей папки.
  for (const kase of GATE_REQUEST_CASES) {
    it(`в \`${kase.call}/gate-requests/assets/\` нет сирот: каждый файл назван запросом`, () => {
      const assetsDir = path.join(dirOf(kase.call), 'assets');
      const onDisk = existsSync(assetsDir) ? readdirSync(assetsDir).sort() : [];
      const named = new Set<string>();
      for (const profile of GATE_REQUEST_PROFILES) {
        const parsed = JSON.parse(
          readFileSync(path.join(dirOf(kase.call), gateRequestFileName(profile)), 'utf8'),
        ) as { assets: readonly { path: string }[]; fonts: readonly { path: string }[] };
        for (const ref of [...parsed.assets, ...parsed.fonts]) named.add(path.basename(ref.path));
      }
      // Лицензия шрифта — ЗАКОННАЯ спутница байтов (V10, provenance), и запросом она не
      // адресуется: её читает человек, а не рендерер. Названа поимённо, а не разрешена
      // расширением: `.txt` рядом с гейтом мог бы оказаться чем угодно.
      const allowedCompanions = new Set(['DejaVuSans-Bold.LICENSE.txt']);
      const orphans = onDisk.filter((file) => !named.has(file) && !allowedCompanions.has(file));
      expect(
        orphans,
        `в \`${assetsDir}\` лежат файлы, которых не просит ни один запрос этой папки. Байты, ` +
          'которые никто не сверяет, живут своей жизнью: они проходят исключение NUL-линта и ' +
          'при этом не входят ни в один `bundle.hash`',
      ).toEqual([]);
    });
  }
});

describe('`GATE-PREP`/`ENV-01` — пути внутри файлов: относительные разрешимы, R2 соблюдён', () => {
  for (const { name, dir: DIR, label } of PAIRS) {
    it(`\`${label}\`: ассет и шрифт резолвятся от каталога файла, R2 соблюдён`, () => {
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
        expect(path.isAbsolute(asset.path), `\`${label}\`: ассет обязан быть ОТНОСИТЕЛЬНЫМ`).toBe(false);
        expect(existsSync(path.resolve(DIR, asset.path)), `\`${label}\`: ассет \`${asset.path}\` не резолвится`).toBe(true);
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
        expect(path.isAbsolute(font.path), `\`${label}\`: шрифт обязан быть ОТНОСИТЕЛЬНЫМ`).toBe(false);
        const resolved = path.resolve(DIR, font.path);
        expect(existsSync(resolved), `\`${label}\`: шрифт \`${font.path}\` не резолвится`).toBe(true);
        expect(
          sha256Hex(readFileSync(resolved)),
          `\`${label}\`: шрифт \`${font.path}\` — не те байты, под которыми сняты записи гейта`,
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
