// **K1** — МАТРИЦА МУТАЦИИ КЛЮЧЕЙ для стадий `segment` и `compose` (`M-05`; ADR-0006 §7).
//
// ADR-0006 §7 ДОСЛОВНО: «для каждого поля каждой схемы механически мутируем значение и
// утверждаем: поле в `cacheKeyView` ⇒ ключ обязан измениться; поле вне ⇒ обязан НЕ
// измениться».
//
// ПРАВИЛО ЗДЕСЬ ТРЁХЗНАЧНОЕ (решение владельца 2026-08-25, вопрос 4; долг №87). Третья
// категория — `upstream`: поле, которое в ключ не входит, но меняет ЗНАЧЕНИЕ поля view. Для
// стадий `segment` и `compose` таких полей нет ни одного, и это видно в данных
// (`upstream (0)`); категория работает на стадии `voice`, где её проверяет
// `packages/voice/test/cache-matrix-voice.test.ts`.
//
// ПОЛЯ ПЕРЕЧИСЛЯЕТ ОБХОДЧИК СХЕМЫ, А НЕ ЭТОТ ФАЙЛ. Рукописный список полон ровно до
// следующего добавленного поля; обход zod делает матрицу функцией схемы, и новое поле
// появляется в ней само — с решением «влияет или нет», без которого тест красный. Роадмап
// называет это свойство прямо: «матрица растёт с каждой схемой».
//
// ЧЕГО ЗДЕСЬ НЕТ. Стадия `compose` не имеет ни одной схемы: её входы — хэши файлов и строки
// lockfile (см. `views/compose.json`), поэтому строк, порождённых обходом zod, у неё ноль, и
// проверяется она перечислением своих же входов. Настоящие `segmentIrHash` (`CP-03`) и
// `engineFingerprint` (`H-*`) не производятся никем — они входят значениями и держатся
// константами, чтобы изменение ключа означало влияние ровно мутированного поля.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertCacheKeyViewShape,
  cacheKeyView,
  composeKey,
  familyLeaves,
  keyOf,
  mutantsOfFamily,
  projectionOf,
  segmentKey,
  type CacheKeyView,
  type KeyInputs,
  type SegmentKeyInput,
} from '../src/index.js';

import { RENDER_AC4_FILE, RENDER_FINAL_FILE } from './assemble-helpers.js';
import {
  REPO,
  RENDER_DRAFT_FILE,
  audioProfileFixture,
  compileProfileFixture,
  composeInputs,
  renderProfileFixture,
  segmentInputs,
} from './cache-helpers.js';

const COUNTS_GOLDEN = path.join(REPO, 'packages/media/test/golden/cache-matrix.txt');

const compile = compileProfileFixture();
const render = renderProfileFixture(RENDER_FINAL_FILE);
const ac4 = renderProfileFixture(RENDER_AC4_FILE);
// ТРЕТИЙ ОБРАЗЕЦ `render-profile` (`H-03`, 2026-08-28, решение владельца). После правки №154
// у `final` стоит `imageFormat: png`, и `jpegQuality` перестал быть достижим на ОБОИХ прежних
// образцах (`final`, `ac4` — оба png) — строка view осталась бы без мутанта, то есть половина
// K1 «поле в view ⇒ ключ меняется» держалась бы на дисциплине. `draft` несёт
// `imageFormat: jpeg` + `jpegQuality: 80`. Правило не ослаблено — добавлен образец.
const draft = renderProfileFixture(RENDER_DRAFT_FILE);
const audio = audioProfileFixture();

const SEGMENT_VIEW = cacheKeyView('segment');
const BASE = segmentKey(segmentInputs(compile, render));

/**
 * Путь поля СХЕМЫ в пространстве путей `cacheKeyView`.
 *
 * Два пространства имён здесь разные, и смешивать их нельзя: схема адресует файл профиля
 * (`fps.num` в `compile-profile/1`), view адресует МЕШОК ВХОДОВ КЛЮЧА
 * (`compileProfile.fps.num`). Соответствие для `segment` тождественно с точностью до
 * префикса — потому что `segmentKey` берёт профили целиком; на стадии `voice` оно
 * нетривиально, и там его несут данные (`upstream`).
 */
function viewPath(family: string, leafPath: string): string {
  if (family === 'compile-profile') return `compileProfile.${leafPath}`;
  if (family === 'audio-profile') return `audioProfile.${leafPath}`;
  if (leafPath.startsWith('pixelProfile.') || leafPath.startsWith('executionProfile.')) return leafPath;
  return `renderProfile.${leafPath}`;
}

/** Совпадает ли путь с записью исключения (`audioProfile.*` покрывает всё поддерево). */
function excludedBy(view: CacheKeyView, path: string): boolean {
  return view.excluded.some((entry) =>
    entry.path.endsWith('.*') ? path.startsWith(entry.path.slice(0, -1)) : entry.path === path,
  );
}

/** Пересборка мешка входов из мутированного профиля того или иного семейства. */
function inputsWith(family: string, mutant: unknown): KeyInputs {
  if (family === 'compile-profile') return segmentInputs(mutant as typeof compile, render) as unknown as KeyInputs;
  if (family === 'render-profile') return segmentInputs(compile, mutant as typeof render) as unknown as KeyInputs;
  // `audio-profile` в мешок входов `segmentKey` НЕ ВХОДИТ ВООБЩЕ, и это половина смысла его
  // присутствия в матрице: сегмент нем (**R5**), аудио-профиль не влияет на его пиксели ни
  // одним полем, и «не влияет» здесь проверяется, а не подразумевается.
  return segmentInputs(compile, render) as unknown as KeyInputs;
}

const FAMILIES = ['compile-profile', 'render-profile', 'audio-profile'] as const;

/**
 * Строки матрицы, порождённые ОБХОДОМ СХЕМ. Живут вне `describe`, потому что их читают два
 * блока: сама матрица и strict-полнота прямых входов (иначе второй блок не смог бы отличить
 * «поле покрыто обходом» от «поле не покрыто ничем»).
 */
const counts = { inView: 0, outside: 0, skipped: 0 };
const rows: { family: string; path: string; inView: boolean; changed: boolean }[] = [];
const skippedPaths: string[] = [];

describe('K1 — матрица мутации `segmentKey` по всем полям всех задействованных схем', () => {
  for (const family of FAMILIES) {
    // ДВА ОБРАЗЦА У `render-profile`, И ЭТО НЕ ИЗБЫТОЧНОСТЬ. Необязательные поля схемы
    // достижимы только там, где они заполнены: `maxProbeDurationFrames` есть у `ac4` и нет у
    // `final`, `jpegQuality` — наоборот (при `imageFormat: png` он запрещён). На одном образце
    // такое поле молча выпало бы из матрицы, то есть «покрыты все поля» было бы правдой
    // только про заполненные. Поле считается покрытым, если достижимо ХОТЬ В ОДНОМ образце.
    const samples: unknown[] =
      family === 'compile-profile'
        ? [compile]
        : family === 'render-profile'
          ? [render, ac4, draft]
          : [audio];

    // МУТАНТ СРАВНИВАЕТСЯ СО СВОИМ ОБРАЗЦОМ, А НЕ С ОБЩИМ. Профили `final` и `ac4` отличаются
    // друг от друга законно (`imageFormat`, `scale`, `threads`), и ключ мутанта от `ac4`
    // разошёлся бы с ключом `final` независимо от мутации — тест краснел бы на КАЖДОМ поле
    // второго образца. Ошибка была допущена и поймана этим же тестом.
    const reached = new Map<string, { mutant: unknown; base: string }>();
    const missed = new Set<string>();
    for (const sample of samples) {
      const base = String(segmentKey(inputsWith(family, sample) as never));
      const { mutants, skipped } = mutantsOfFamily(family, sample);
      for (const { path: leafPath, mutant } of mutants) if (!reached.has(leafPath)) reached.set(leafPath, { mutant, base });
      for (const entry of skipped) missed.add(entry.path);
    }
    for (const leafPath of missed) if (!reached.has(leafPath)) skippedPaths.push(`${family}:${leafPath}`);

    for (const [leafPath, { mutant, base }] of reached) {
      const full = viewPath(family, leafPath);
      const inView = SEGMENT_VIEW.fields.some((field) => field.path === full);
      if (inView) counts.inView += 1;
      else counts.outside += 1;
      rows.push({ family, path: full, inView, changed: String(segmentKey(inputsWith(family, mutant) as never)) !== base });
    }
  }
  counts.skipped = skippedPaths.length;

  it('каждое поле схемы получило решение: оно в view, в исключениях или в `upstream`', () => {
    // Это и есть «матрица растёт с каждой схемой»: новое поле, которому никто не назначил
    // категорию, роняет тест — то есть решение «влияет или нет» принять ПРИДЁТСЯ.
    const undecided = rows
      .filter((row) => !row.inView)
      .filter((row) => !excludedBy(SEGMENT_VIEW, row.path))
      .filter((row) => !SEGMENT_VIEW.upstream.some((entry) => entry.path === row.path))
      .map((row) => row.path);
    expect(
      undecided,
      'Поле схемы не названо ни в `fields`, ни в `excluded`, ни в `upstream` стадии `segment`. ' +
        'ADR-0006 §6: «добавляя поле в схему, разработчик ОБЯЗАН решить, влияет ли оно на ' +
        'результат, и это решение видно в git-диффе».',
    ).toEqual([]);
  });

  it('поле В view ⇒ ключ обязан измениться', () => {
    const silent = rows.filter((row) => row.inView && !row.changed).map((row) => row.path);
    expect(
      silent,
      'Поле перечислено в `cacheKeyView`, но его мутация ключ НЕ ДВИНУЛА. Это ровно тот класс ' +
        'тихой ошибки, ради которого написан ADR-0006: величина влияет на результат, а кэш ' +
        'её не замечает.',
    ).toEqual([]);
  });

  it('поле ВНЕ view ⇒ ключ обязан не измениться', () => {
    const leaked = rows.filter((row) => !row.inView && row.changed).map((row) => row.path);
    expect(
      leaked,
      'Поле НЕ перечислено в `cacheKeyView`, а ключ от его мутации сдвинулся: значит ключ ' +
        'считается не по тем данным, которые объявлены. Тюнинг производительности не имеет ' +
        'права выбрасывать кэш пикселей (ADR-0006 §5).',
    ).toEqual([]);
  });

  it('счёт полей ПЕЧАТАЕТСЯ в golden: сколько в view, сколько вне, сколько недостижимо', () => {
    // ПЕЧАТЬ, А НЕ `console.log`. Число покрытых полей — величина, которая обязана меняться
    // ОСОЗНАННО: она растёт ровно тогда, когда в схему добавили поле. В stdout его никто не
    // прочтёт, а в golden оно попадает в git-дифф вместе с полем, которое его сдвинуло, —
    // то есть ревьюер видит «поле добавлено, решение принято, счёт вырос» одной строкой.
    // Отдельно печатаются НЕДОСТИЖИМЫЕ пути: «покрыты все поля» без них было бы правдой
    // только про те, что случайно заполнены в фикстуре (ADR-0006 §7 требует все).
    const lines: string[] = ['# матрица мутации ключей (K1) — счёт полей', ''];
    for (const family of FAMILIES) {
      const own = rows.filter((row) => row.family === family);
      lines.push(
        `${family}: ${String(own.length)} полей = ` +
          `${String(own.filter((row) => row.inView).length)} в view + ` +
          `${String(own.filter((row) => !row.inView).length)} вне`,
      );
    }
    lines.push('');
    lines.push(`segment: всего ${String(rows.length)} полей; в ключе ${String(counts.inView)}`);
    lines.push(`недостижимо в образце фикстуры: ${String(counts.skipped)}`);
    for (const path of skippedPaths) lines.push(`  - ${path}`);
    lines.push('');
    lines.push(`compose: 0 полей схем (входы стадии — хэши файлов и строки lockfile)`);
    lines.push(`voice: матрица в packages/voice/test/cache-matrix-voice.test.ts (там же upstream)`);
    const dump = lines.join('\n');

    if (process.env['VPE_GOLDEN_UPDATE'] === '1') writeFileSync(COUNTS_GOLDEN, `${dump}\n`, 'utf8');
    expect(
      dump,
      'Счёт полей матрицы разошёлся с golden. Он растёт ровно тогда, когда в схему добавили ' +
        'поле, — покажите в диффе, какое именно и какое решение оно получило.',
    ).toBe(readFileSync(COUNTS_GOLDEN, 'utf8').replace(/\n$/u, ''));

    expect(rows.length).toBe(counts.inView + counts.outside);
    // Контроль прибора: обход обязан видеть много полей, а не два случайных.
    expect(rows.length).toBeGreaterThanOrEqual(50);
    // И каждый путь view, адресующий поле ПРОФИЛЯ, обязан быть ДОСТИГНУТ обходом схемы —
    // иначе строка view описывала бы поле, которого в схеме нет.
    //
    // ЭТА СТРОКА СВЕРЯЕТ ТОЛЬКО ПУТИ С ТОЧКОЙ, И В ЭТОМ БЫЛА ДЫРА ПРИБОРА (найдена проверкой
    // владельца 2026-08-25). Пять ПРЯМЫХ входов `segmentKey` — `segmentIrHash`,
    // `engineFingerprint`, `assetShas`, `fontShas`, `gridShas` — обходом схемы не достигаются
    // (схем у них нет), поэтому здесь их и не должно быть. Но блока «вход в view ⇒ ключ
    // меняется» у них не было ВООБЩЕ: `filter` по `field.path === 'segmentIrHash'` в
    // `projectFields` оставлял всю матрицу зелёной. Закрыто блоком ниже плюс strict-полнотой,
    // которая требует мутанта для КАЖДОЙ строки view, а не только для точечных.
    expect(counts.inView).toBe(SEGMENT_VIEW.fields.filter((field) => field.path.includes('.')).length);
  });
});

// ── K1: прямые входы `segmentKey` ──────────────────────────────────────────────────────────

describe('K1 — каждый ПРЯМОЙ вход `segmentKey`, названный в view, меняет ключ', () => {
  // ЗАЧЕМ ОТДЕЛЬНЫЙ БЛОК, ЕСЛИ ВЫШЕ УЖЕ ЕСТЬ МАТРИЦА. Матрица выше механическая: она
  // перечисляет поля ОБХОДОМ zod-схем, и это её сила — новое поле профиля попадает в неё само.
  // Оборотная сторона ровно там же: у входов, за которыми схемы НЕТ, обходить нечего, и они
  // выпадали из in-view половины целиком. `segmentIrHash` производит `CP-03`,
  // `engineFingerprint` — `H-*`, три списка sha приходят от каталога ассетов и шрифтов; ни у
  // одного нет семейства, и не будет. Поэтому им нужна ЯВНАЯ карта мутантов — как у стадии
  // `compose`, где схем нет вовсе и весь блок устроен так же.
  //
  // ПОЧЕМУ ЭТО НЕ ФОРМАЛЬНОСТЬ. `engineFingerprint` — единственное место измеренного окружения
  // (M9, K6), `segmentIrHash` — всё содержимое сегмента, `fontShas` — растр текста. Величина,
  // влияющая на пиксели и не входящая в ключ, — тот самый класс тихой ошибки, ради которого
  // написан ADR-0006; до этой правки он был не покрыт именно у самых крупных входов.
  const base = segmentInputs(compile, render);

  /** Мутант на каждый прямой вход. Значения правдоподобные: в диффе видно, что менялось. */
  const DIRECT: Readonly<Record<string, (input: SegmentKeyInput) => SegmentKeyInput>> = {
    segmentIrHash: (input) => ({ ...input, segmentIrHash: `${input.segmentIrHash}-b` }),
    assetShas: (input) => ({ ...input, assetShas: [...input.assetShas, 'a3'] }),
    fontShas: (input) => ({ ...input, fontShas: [...input.fontShas, 'f2'] }),
    // ADR-0006 §15: в v1 список ВСЕГДА пуст (`gridPoint` отвергается валидатором), и строка
    // введена заранее — beat detection определяет позиции клипов, то есть пиксели. Мутант
    // проверяет, что заранее введённая строка работает, а не украшает файл.
    gridShas: (input) => ({ ...input, gridShas: [...input.gridShas, 'g1'] }),
    engineFingerprint: (input) => ({ ...input, engineFingerprint: `${input.engineFingerprint}-b` }),
  };

  it('КАЖДАЯ строка view покрыта мутантом — и профильная, и прямая (strict-полнота)', () => {
    // Ровно то утверждение, отсутствие которого и было дырой: покрытие сверяется со ВСЕМИ
    // строками view, без деления на точечные и бес-точечные. Новая строка в `views/segment.json`
    // без мутанта роняет тест — «для строки view нет мутанта» означает «матрица неполна».
    const bySchema = new Set(rows.filter((row) => row.inView).map((row) => row.path));
    const covered = new Set([...bySchema, ...Object.keys(DIRECT)]);
    const uncovered = SEGMENT_VIEW.fields.map((field) => field.path).filter((path) => !covered.has(path));
    expect(
      uncovered,
      'Строка `cacheKeyView` стадии `segment` не покрыта ни обходом схемы, ни явной картой ' +
        'мутантов: её влияние на ключ не проверяется ничем. Половина K1 «поле в view ⇒ ключ ' +
        'меняется» на ней держится на дисциплине, а не на тесте.',
    ).toEqual([]);
    // И обратно: в карте нет мутантов на пути, которых в view уже нет (мёртвая строка теста).
    expect(Object.keys(DIRECT).filter((path) => !SEGMENT_VIEW.fields.some((field) => field.path === path))).toEqual([]);
  });

  it.each(Object.keys(DIRECT))('`%s`: мутация меняет `segmentKey`', (path) => {
    const mutate = DIRECT[path] as (input: SegmentKeyInput) => SegmentKeyInput;
    expect(segmentKey(mutate(base)), path).not.toBe(BASE);
  });

  it('и каждая мутация меняет РОВНО своё поле проекции, а не задевает соседей', () => {
    // Контроль осмысленности предыдущего блока: ключ мог бы сдвинуться и от того, что мутант
    // случайно перестроил весь мешок входов. Дифф проекции показывает, что двигалось.
    for (const [path, mutate] of Object.entries(DIRECT)) {
      const before = projectionOf(SEGMENT_VIEW, base as unknown as KeyInputs);
      const after = projectionOf(SEGMENT_VIEW, mutate(base) as unknown as KeyInputs);
      const changed = [...before.keys()].filter((key) => before.get(key) !== after.get(key));
      expect(changed, path).toEqual([path]);
    }
  });
});

describe('K5 — `sampleRate` не входит в ключ немых сегментов', () => {
  it('другой `projectSampleRate` ⇒ ТОТ ЖЕ `segmentKey`', () => {
    // ЕДИНСТВЕННОЕ место, где K5 имеет зубы. ADR-0006 §5 отправляет `compileProfile` в ключ
    // `segment`, а `projectSampleRate` — поле `compileProfile`; если бы профиль входил в ключ
    // ЦЕЛИКОМ, K5 нарушался бы по построению. Он не нарушается ровно потому, что view
    // перечисляет пути-поля, и этого пути там нет.
    const other = { ...compile, projectSampleRate: compile.projectSampleRate * 2 };
    expect(segmentKey(segmentInputs(other, render))).toBe(BASE);
  });

  it('другой `deliverySampleRate` ⇒ тот же ключ: аудио-профиль в ключ сегмента не входит', () => {
    const { mutants } = mutantsOfFamily('audio-profile', audio);
    const delivery = mutants.find((mutant) => mutant.path === 'deliverySampleRate');
    expect(delivery, 'обходчик обязан видеть `deliverySampleRate`').toBeDefined();
    expect(segmentKey(segmentInputs(compile, render))).toBe(BASE);
  });

  it('поле в форме ВЫРАЗИМО: K5 доказывается мутацией, а не отсутствием строки', () => {
    // Если бы `projectSampleRate` не было во входе `segmentKey`, предыдущий тест был бы
    // зелёным по недоразумению — мутировать было бы нечего.
    expect(familyLeaves('compile-profile').map((leaf) => leaf.path)).toContain('projectSampleRate');
    expect(Object.keys(segmentInputs(compile, render).compileProfile)).toContain('projectSampleRate');
  });
});

describe('метаданные ADR-0006 §6 физически не могут попасть в ключ', () => {
  const METADATA = ['reason', 'createdAt', 'retrievedAt', 'billedUnits', 'generatedAt'];

  it('их мутация не двигает ни `segmentKey`, ни `composeKey`', () => {
    // Мешок входов НАРОЧНО загрязняется метаданными: ключ считается проекцией по view, а их
    // там нет — значит и в ключ они не попадают, сколько бы их ни положили рядом.
    const dirty = { ...segmentInputs(compile, render) } as Record<string, unknown>;
    for (const [index, name] of METADATA.entries()) dirty[name] = `значение-${String(index)}`;
    expect(keyOf(SEGMENT_VIEW, dirty)).toBe(BASE);

    const compose = composeInputs();
    const base = composeKey(compose);
    const dirtyCompose = { ...compose } as Record<string, unknown>;
    for (const name of METADATA) dirtyCompose[name] = 'значение';
    expect(keyOf(cacheKeyView('compose'), dirtyCompose)).toBe(base);
  });
});

describe('K1 — матрица стадии `compose`: схем нет, входы перечислены', () => {
  const view = cacheKeyView('compose');
  const base = composeKey(composeInputs());

  it('каждый вход, названный в view, меняет ключ', () => {
    const mutated: Record<string, KeyInputs> = {
      sourceHashes: { ...composeInputs(), sourceHashes: { 'renderer-hyperframes': 'other' } },
      lockfileLines: { ...composeInputs(), lockfileLines: ['  gsap@3.12.6:'] },
      compilerVersion: { ...composeInputs(), compilerVersion: 'compiler@2' },
    };
    for (const field of view.fields) {
      const inputs = mutated[field.path];
      expect(inputs, `для строки view \`${field.path}\` нет мутанта — матрица неполна`).toBeDefined();
      expect(keyOf(view, inputs as KeyInputs), field.path).not.toBe(base);
    }
  });

  it('у стадии нет ни одной схемы, и это записано в данных, а не подразумевается', () => {
    expect(view.upstream).toEqual([]);
    expect(view.note).toContain('Схем в этом ключе НЕТ НИ ОДНОЙ');
  });
});

describe('`engineFingerprint` входит в `segmentKey` ровно один раз', () => {
  it('дважды НЕВЫРАЗИМО формой входа: поле одно, а не список', () => {
    const inputs = segmentInputs(compile, render) as unknown as Record<string, unknown>;
    const mentions = Object.keys(inputs).filter((key) => key.toLowerCase().includes('fingerprint'));
    expect(mentions).toEqual(['engineFingerprint']);
  });

  it('дважды НЕВЫРАЗИМО и в view: путь-префикс другого пути отвергается загрузчиком', () => {
    // Вторая половина правила. Без неё пара `engineFingerprint` + `engineFingerprint.chrome`
    // прошла бы: одно значение вошло бы в ключ и целиком, и отдельной строкой — то есть
    // дважды (ADR-0006 §3: «ни одна величина не учитывается дважды»).
    const twice = {
      ...SEGMENT_VIEW,
      fields: [
        ...SEGMENT_VIEW.fields,
        { path: 'engineFingerprint.chrome', kind: 'text' as const, why: 'нарушение' },
      ],
    };
    expect(() => assertCacheKeyViewShape(twice)).toThrow(/лежит ВНУТРИ пути/u);
  });

  it('дубль пути отвергается тем же охранником', () => {
    const duplicated = { ...SEGMENT_VIEW, fields: [...SEGMENT_VIEW.fields, SEGMENT_VIEW.fields[0]!] };
    expect(() => assertCacheKeyViewShape(duplicated)).toThrow(/дважды/u);
  });

  it('пустой view отвергается: ключ от пустого кортежа одинаков для всех входов', () => {
    expect(() => assertCacheKeyViewShape({ ...SEGMENT_VIEW, fields: [] })).toThrow(/пуст/u);
  });
});

describe('проектор: опечатка в пути — отказ, а не тихое выпадение поля из ключа', () => {
  it('путь, которого нет во входах, роняет расчёт с именем пути', () => {
    const view: CacheKeyView = {
      ...SEGMENT_VIEW,
      fields: [{ path: 'compileProfile.fpsX', kind: 'int', why: 'опечатка' }],
    };
    expect(() => keyOf(view, segmentInputs(compile, render) as unknown as KeyInputs)).toThrow(
      /называет путь `compileProfile.fpsX`/u,
    );
  });

  it('тип поля берётся из данных: объявленный `int` при строке — отказ', () => {
    const view: CacheKeyView = {
      ...SEGMENT_VIEW,
      fields: [{ path: 'segmentIrHash', kind: 'int', why: 'не то' }],
    };
    expect(() => keyOf(view, segmentInputs(compile, render) as unknown as KeyInputs)).toThrow(/int/u);
  });

  it('проекция печатается путями: она и есть предмет диффа для `upstream`', () => {
    const projection = projectionOf(SEGMENT_VIEW, segmentInputs(compile, render) as unknown as KeyInputs);
    expect(projection.size).toBe(SEGMENT_VIEW.fields.length);
    expect(projection.get('compileProfile.fps.num')).toBe(String(compile.fps.num));
  });
});
