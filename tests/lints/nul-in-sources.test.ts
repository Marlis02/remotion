// NUL (`U+0000`) в исходниках запрещён — литеральным байтом. Экранированная форма `\u0000`
// разрешена и нужна: символ у нас законный разделитель (см. ниже).
//
// ЗАЧЕМ ОХРАННИК. Литеральный NUL делает файл **бинарным для git**: `git diff` показывает
// `Bin 0 -> 4858 bytes` вместо диффа. Последствия — не косметические:
//   * ревью исчезает. Правка в таком файле не видна ни в диффе, ни в PR, ни в `git log -p`;
//   * сам символ невидим в редакторе — он неотличим от пробела, которого на его месте ждёшь;
//   * `grep`, `sed` и половина текстовых инструментов на таком файле ведут себя иначе
//     (GNU grep без `-a` объявляет «binary file matches» и не печатает строку).
// То есть литеральный NUL отключает и ревью, и поиск — два механизма, на которых стоит весь
// процесс `00-PROCESS.md`.
//
// ЧТО ИМЕННО ЗАПРЕЩЕНО, А ЧТО НЕТ. Запрещён БАЙТ `0x00` в файле. Последовательность из шести
// символов `\u0000` в исходнике — это не байт NUL, а его экранированная запись; JS-строка из
// неё получается ровно та же. То есть правило не отнимает у кода ни одной возможности, а
// требует записывать её видимо.
//
// ГДЕ ПРОВЕРЯЕТСЯ: `packages/`, `tests/`, `fixtures/` целиком, без `node_modules/` и `dist/`
// (первое чужое, второе — сборка, и в `.d.ts` NUL приезжает из исходника). **`docs/` НЕ
// проверяется**, и это названо явно: там лежат измеренные бинарные артефакты спайков —
// сорок с лишним `.pcm`-файлов SP-2 (`docs/spikes/sp2/out/`), в которых NUL законен по
// природе аудио. Проверять `docs/` значило бы завести список исключений длиной со спайк.
//
// ~~СПИСОК ИСКЛЮЧЕНИЙ ПУСТ, И ЭТО ИЗМЕРЕНО~~ *(изменено: `GATE-PREP`, 2026-08-29 — в списке
// ОДНА строка; `ENV-01`, 2026-08-31 — две; `E-02`, 2026-08-31 — ЧЕТЫРЕ; `TPL-01a`, 2026-09-09 —
// поимённых НОЛЬ, вместо них ЗОНА.)* Правило «исключение обязано быть обосновано» исполнено
// по-прежнему, но обоснование стало ОДНИМ на зону, а не копией на файл: три причины «почему не
// текстом» у всех этих файлов дословно одни и те же, и четвёртая копия одного абзаца не
// добавляла ревью ничего. Что зона не подменяет проверку — см. комментарий у `ALLOWED_PATTERNS`.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT } from '../boundaries/repo';

/** Корни, в которых NUL запрещён. */
const ROOTS = ['packages', 'tests', 'fixtures'];

/** Каталоги, которые не обходим: чужое и сборка. */
const SKIP = new Set(['node_modules', 'dist', '.git']);

/**
 * **ФАЙЛЫ, КОТОРЫМ ЛИТЕРАЛЬНЫЙ NUL РАЗРЕШЁН — ЗОНА, А НЕ ЧЕТЫРЕ ИМЕНИ** *(изменено: `TPL-01a`,
 * 2026-09-09, решение владельца В6)*.
 *
 * ~~Список поимённый: строка сюда добавляется только вместе с ответом «почему этот файл не
 * может быть текстовым» и попадает в ревью, потому что это дифф.~~ Ассеты запросов гейта
 * переехали в папки шаблонов (`<id>@<N>/gate-requests/assets/`), и поимённый список стал бы
 * тем же, чем был реестр: местом, которое правит каждый новый шаблон.
 *
 * **ЧТО СТАЛО СЛАБЕЕ И ЧЕМ ЭТО КОМПЕНСИРОВАНО.** Слабее ровно одно: новый бинарник в такой
 * папке проходит без строки-обоснования в диффе. Компенсаций ДВЕ, и обе — проверки, а не
 * обещания: (1) байты каждого такого файла сверяются побайтово с литералом фикстуры
 * (`renderer-hyperframes/test/gate-requests.test.ts`), то есть подложить туда «что угодно»
 * нельзя; (2) там же стоит охранник СИРОТ — каждый файл под `gate-requests/assets/` обязан
 * быть назван хотя бы одним запросом своей папки, иначе красный. То есть либо файл входит в
 * `bundle.hash` и сверяется, либо его не пускают.
 *
 * ПОЧЕМУ ЭТИ ФАЙЛЫ НЕ МОГУТ БЫТЬ ТЕКСТОВЫМИ — три причины, общие для всех, и ни одна не про
 * удобство:
 *   1. их БАЙТЫ читает `materialize.ts`, кладёт в каталог композиции и считает их `sha256` в
 *      `bundle.hash`; base64 или любая текстовая форма дала бы в композиции ДРУГОЙ файл и
 *      другой хэш — то есть гейт, снятый не на той картинке;
 *   2. расширение определяется по МАГИЧЕСКИМ БАЙТАМ (`extensionOf`, правило R3), и текстовая
 *      форма отказала бы на них, а не отрисовалась; у TrueType это `00 01 00 00`, то есть
 *      первый же NUL и есть опознавательный знак формата;
 *   3. подделка ИЗМЕРЕНА и отвергнута трижды: ровная заливка вместо шахматки дала бы PASS, не
 *      измерив движения (ложно-зелёный №164, `H-06`); 12-байтовый `TTF_STUB` вгонял в кадры
 *      таймер `font-display: block` вместо типографики (долг №187, `ENV-01`); PNG без альфы
 *      дал бы гейт параллакса на стопке непрозрачных прямоугольников (`E-02`).
 */
const ALLOWED_PATTERNS: readonly RegExp[] = [
  // Ассеты запросов гейта в папке шаблона — оба пакета не при чём, каталог один
  // (`templates-spec/src/templates/<id>@<N>/gate-requests/assets/**`).
  /^packages\/templates-spec\/src\/templates\/[^/]+@[0-9]+\/gate-requests\/assets\/[^/]+$/u,
  // ВТОРАЯ ЗОНА — СВОИ ФАЙЛЫ ДЕМО (`<id>@<N>/demo/assets/**`, `TPL-01c`, 2026-09-10).
  //
  // Заведена не «по аналогии»: у `bed@1` ассет обязан быть ЗВУКОМ, а звука среди ассетов
  // запросов гейта нет и быть не может — `bed@1` аудио-домена, в `RenderIR.clips` не
  // попадает никогда и запроса гейта не имеет вовсе (долг №189). Демо без подложки не
  // показывало бы шаблон.
  //
  // ОБЕ КОМПЕНСАЦИИ ЗОНЫ ИСПОЛНЕНЫ ТЕМИ ЖЕ ДВУМЯ ПРОВЕРКАМИ, что у соседней, и живут они в
  // [`cli/test/template-demo.test.ts`](../../packages/cli/test/template-demo.test.ts):
  // (1) sha256 каждого файла зоны сверяется с ЛИТЕРАЛОМ теста — подложить туда «что угодно»
  // нельзя; (2) охранник СИРОТ — каждый файл обязан быть назван `demo.json` своей папки,
  // иначе красный. То есть либо файл входит в собираемое демо и сверяется, либо его не
  // пускают.
  /^packages\/templates-spec\/src\/templates\/[^/]+@[0-9]+\/demo\/assets\/[^/]+$/u,
];

/** Файлы, которым литеральный NUL разрешён поимённо. Пуст: зона выражена паттерном выше. */
const ALLOWED: readonly string[] = [];

/** Все файлы под корнями, путями от корня репозитория, в байтовом порядке. */
function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(path.relative(ROOT, abs));
    }
  };
  for (const root of ROOTS) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

/** Разрешён ли файлу литеральный NUL — поимённо либо зоной. */
function allowed(relPath: string): boolean {
  return ALLOWED.includes(relPath) || ALLOWED_PATTERNS.some((re) => re.test(relPath));
}

/** `путь: сколько NUL` — только для файлов, где они есть и не разрешены. */
function offenders(): string[] {
  const out: string[] = [];
  for (const relPath of scannedFiles()) {
    if (allowed(relPath)) continue;
    let count = 0;
    for (const byte of fs.readFileSync(path.join(ROOT, relPath))) {
      if (byte === 0) count += 1;
    }
    if (count > 0) out.push(`${relPath}: ${String(count)} NUL`);
  }
  return out;
}

describe('NUL в исходниках запрещён (`CP-04fix`, 2026-08-27)', () => {
  it('ни одного байта `0x00` в `packages/`, `tests/`, `fixtures/`', () => {
    expect(
      offenders(),
      'В исходнике появился ЛИТЕРАЛЬНЫЙ NUL. Файл с ним git считает бинарным ' +
        '(`Bin 0 -> N bytes`), то есть дифф исчезает и правка перестаёт быть ревьюируемой; ' +
        'в редакторе символ неотличим от пробела. Разделитель `U+0000` — законный приём ' +
        '(инъективная склейка ключа), и запрещён не он, а его ЗАПИСЬ байтом: пишите ' +
        '`\\u0000` — поведение тождественно, а файл остаётся текстовым.',
    ).toEqual([]);
  });

  it('охранник НЕ мёртвый: он обходит настоящее дерево и видит достаточно файлов', () => {
    const files = scannedFiles();
    expect(files.length, 'обход не нашёл файлов — корни или фильтр каталогов сломались').toBeGreaterThan(200);
    expect(files).toContain('packages/compile/src/render-ir/records.ts');
    expect(files).toContain('tests/lints/nul-in-sources.test.ts');
    expect(files).toContain('fixtures/minimal/project.yaml');
    // `dist/` и `node_modules/` действительно не обходятся: в `dist` NUL приезжает из
    // исходника, и без фильтра тест краснел бы на сборке, а не на коде.
    expect(files.some((file) => file.includes('/dist/'))).toBe(false);
    expect(files.some((file) => file.includes('/node_modules/'))).toBe(false);
  });

  // **ЗОНЫ ИСКЛЮЧЕНИЯ НАЙДЕНЫ И НЕ ШИРЕ, ЧЕМ ОБЪЯВЛЕНЫ** (`TPL-01a`; вторая зона — `TPL-01c`).
  // Паттерн без этого утверждения — обещание: опечатка в регулярке дала бы либо мёртвое
  // исключение (и тогда тест краснеет на шрифте гейта), либо слишком широкое (и тогда молчал
  // бы весь пакет).
  it('исключение накрывает ровно ассеты запросов гейта и свои файлы демо — и ничего сверх', () => {
    const files = scannedFiles();
    const covered = files.filter((file) => allowed(file)).sort();
    // Ассеты запросов гейта: три копии шахматки, шрифт с лицензией, два слоя параллакса.
    expect(covered).toContain(
      'packages/templates-spec/src/templates/captionEmphasis@1/gate-requests/assets/DejaVuSans-Bold.ttf',
    );
    expect(covered).toContain(
      'packages/templates-spec/src/templates/still@1/gate-requests/assets/pattern-32.png',
    );
    // Свои файлы демо: подложка `bed@1` — звук, и в запросах гейта звука нет по построению.
    expect(covered).toContain(
      'packages/templates-spec/src/templates/bed@1/demo/assets/bed-loop.wav',
    );
    // Ни один файл вне ДВУХ названных зон под исключение не подпадает.
    expect(
      covered.every(
        (file) => file.includes('/gate-requests/assets/') || file.includes('/demo/assets/'),
      ),
    ).toBe(true);
    // И ни один ИСХОДНИК шаблона — тем более: спек, запросы, пресеты и `demo.json` обязаны
    // быть текстом. `demo.json` лежит в `demo/`, а не в `demo/assets/`, и зоной не накрыт.
    expect(covered.some((file) => file.endsWith('.ts') || file.endsWith('.json'))).toBe(false);
  });

  it('охранник РАБОТАЕТ: подставной нарушитель краснеет, экранированная форма — нет', () => {
    const probeDir = path.join(ROOT, 'tests', '__nul_probe__');
    const probe = path.join(probeDir, 'probe.ts');
    fs.mkdirSync(probeDir, { recursive: true });
    try {
      // Литеральный байт — краснеет.
      fs.writeFileSync(probe, 'export const bad = "a\u0000b";\n', 'utf8');
      expect(offenders()).toEqual(['tests/__nul_probe__/probe.ts: 1 NUL']);

      // Экранированная запись тех же шести символов — не краснеет, а строка получается та же.
      fs.writeFileSync(probe, 'export const ok = "a\\u0000b";\n', 'utf8');
      expect(offenders()).toEqual([]);
      expect('a\u0000b').toHaveLength(3);
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
  });
});
