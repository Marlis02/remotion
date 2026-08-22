// `R-02` — охранники семейства `render-profile/1`.
//
// Что охраняется этим файлом:
//   * **P10** (`named → guarded`) — «профили не содержат вычисляемых полей». Исполнимая форма:
//     неизвестное поле на ЛЮБОМ уровне — ошибка с путём к полю, а не WARN и не strip.
//   * **K6** (часть профилей) — «измеренное окружение живёт только в `engineFingerprint`».
//     Исполнимая форма: в схеме нет ключа, чьё имя содержит `version`/`hash`/`sha`/`checksum`/
//     `fingerprint`. Проверяется по списку ключей zod, а не по соглашению. Вторая половина
//     строки K6 («живёт только в `engineFingerprint`») — задача `H-03`, поэтому статус K6
//     остаётся `named`.
//   * **P16** (часть `render-profile/1`) — «YAML-значения получают типы, объявленные схемой».
//     Исполнимая форма: значения-ловушки либо совпадают по типу, либо отвергаются, но никогда
//     не приводятся молча. Остальные семейства — `S-02`.
//   * **Критерий готовности roadmap `R-02`** — `draft` отличается от `final` только
//     `pixelProfile.{scale, imageFormat, jpegQuality, crf}` и `executionProfile`; дифф считается
//     механически обходом дерева, а не сравнением поимённо.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RENDER_PROFILE_IDS, RenderProfileSchema, loadRenderProfile, type RenderProfile } from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILES = path.join(REPO, 'fixtures/minimal/profiles');

/** Таблица «файл → `profileId`» — ADR-0005 §1a. Она и есть предмет первого теста. */
const FILE_TO_PROFILE_ID = {
  'render.final.yaml': 'final',
  'render.draft.yaml': 'draftHalf',
  'render.ac4.yaml': 'ac4',
} as const;

const fixtureText = (file: string): string => readFileSync(path.join(PROFILES, file), 'utf8');

// ── Приборы ────────────────────────────────────────────────────────────────────────────────
// Тесты, проверяющие ПАРСЕР (P16) и путь чтения целиком, обязаны идти через файл: половина
// ловушек — свойство YAML-текста, а не объекта. Каталог фиксированный и детерминированный
// (`mkdtemp` и `Math.random` не нужны: `vitest.config.ts` держит `fileParallelism: false`).
const TMP = path.join(tmpdir(), 'vpe-r02-render-profile');
mkdirSync(TMP, { recursive: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/**
 * Точечная правка текста фикстуры. Падает, если якорь встречается не ровно один раз, —
 * иначе тест мог бы «проверить» не то место и остаться зелёным.
 */
function patch(text: string, from: string, to: string): string {
  const occurrences = text.split(from).length - 1;
  expect(occurrences, `якорь \`${from}\` обязан встречаться ровно один раз`).toBe(1);
  return text.replace(from, to);
}

/** Пишет YAML во временный файл и читает его штатным `loadRenderProfile`. */
function loadText(name: string, text: string): unknown {
  const file = path.join(TMP, `${name}.yaml`);
  writeFileSync(file, text, 'utf8');
  return loadRenderProfile(file);
}

/** «Прочитать и получить ошибку валидации», с путями к полям в человекочитаемом виде. */
function rejectionPaths(name: string, text: string): string[] {
  try {
    loadText(name, text);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // У `unrecognized_keys` имя лишнего поля лежит в `keys`, а `path` указывает на контейнер:
      // полный путь к полю — их склейка.
      return error.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => [...issue.path, key].join('.'))
          : [issue.path.join('.')],
      );
    }
    throw error;
  }
  throw new Error(`ожидалась ZodError, но файл \`${name}\` прошёл валидацию`);
}

/** Все листья объекта как «путь → значение». Основа механического диффа. */
function leaves(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [p, v] of leaves(child, prefix === '' ? key : `${prefix}.${key}`)) out.set(p, v);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

/**
 * Все имена полей схемы zod, на всех уровнях. Ходит по `shape`, разворачивает `optional`.
 * Незнакомый узел — падение, а не пропуск: молчаливый пропуск сделал бы охранник K6
 * ложно-зелёным ровно в тот день, когда в схему добавят обёртку.
 */
function schemaKeys(node: unknown, prefix = ''): string[] {
  const def = (node as { _zod: { def: { type: string; shape?: Record<string, unknown> } } })._zod.def;
  switch (def.type) {
    case 'object': {
      const shape = def.shape ?? {};
      return Object.entries(shape).flatMap(([key, child]) => {
        const full = prefix === '' ? key : `${prefix}.${key}`;
        return [full, ...schemaKeys(child, full)];
      });
    }
    case 'optional':
      return schemaKeys((node as { unwrap: () => unknown }).unwrap(), prefix);
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
      return [];
    default:
      throw new Error(`обходчик схемы не знает узел \`${def.type}\` (путь \`${prefix}\`)`);
  }
}

// ── 1. Фикстура ────────────────────────────────────────────────────────────────────────────

describe('render-profile/1 — три файла фикстуры', () => {
  it.each(Object.entries(FILE_TO_PROFILE_ID))(
    '%s проходит валидацию и несёт profileId из таблицы ADR-0005 §1a',
    (file, profileId) => {
      const profile = loadRenderProfile(path.join(PROFILES, file));
      expect(profile.schema).toBe('render-profile/1');
      expect(profile.profileId).toBe(profileId);
    },
  );

  it('множество profileId схемы совпадает с таблицей ADR-0005 §1a', () => {
    expect([...RENDER_PROFILE_IDS].sort()).toEqual(
      [...Object.values(FILE_TO_PROFILE_ID)].sort(),
    );
  });

  it('шапка проверяется до схемы: чужое семейство и отсутствие шапки — ошибка', () => {
    const final = fixtureText('render.final.yaml');
    expect(() =>
      loadText('wrong-family', patch(final, 'schema: render-profile/1', 'schema: compile-profile/1')),
    ).toThrow(/ожидалась `render-profile\/1`/);
    expect(() =>
      loadText('wrong-version', patch(final, 'schema: render-profile/1', 'schema: render-profile/2')),
    ).toThrow(/ожидалась `render-profile\/1`/);
    expect(() =>
      loadText('no-header', patch(final, 'schema: render-profile/1\n', '')),
    ).toThrow(/нет шапки/);
  });
});

// ── 2. P10 ─────────────────────────────────────────────────────────────────────────────────

describe('P10 — неизвестное поле на любом уровне отвергается с путём к полю', () => {
  // Каждый нарушитель — поле, которое РЕАЛЬНО лежало в этих файлах или в первой редакции
  // профиля: `gl`/`concurrency`/`disallowParallelEncoding` — снятые поля Remotion
  // (roadmap §9 п. 1), `compositionHash` — вычисляемая величина, удалённая из `pixelProfile`
  // решением M9 (ADR-0006 §3). Это регрессия дрейфа, а не абстрактное `foo: 1`.
  const cases: ReadonlyArray<readonly [string, string, string, string]> = [
    ['root', 'schema: render-profile/1', 'schema: render-profile/1\ncompositionHash: "0000"', 'compositionHash'],
    ['pixel', 'pixelProfile:\n', 'pixelProfile:\n  gl: swangle\n', 'pixelProfile.gl'],
    ['encoder', '  encoder:\n', '  encoder:\n    disallowParallelEncoding: false\n', 'pixelProfile.encoder.disallowParallelEncoding'],
    ['execution', 'executionProfile:\n', 'executionProfile:\n  concurrency: 4\n', 'executionProfile.concurrency'],
  ];

  it.each(cases)('уровень %s: лишнее поле ⇒ ошибка с путём', (name, from, to, expectedPath) => {
    const broken = patch(fixtureText('render.final.yaml'), from, to);
    expect(rejectionPaths(`p10-${name}`, broken)).toContain(expectedPath);
  });
});

// ── 3. Критерий готовности roadmap: draft против final ─────────────────────────────────────

describe('roadmap `R-02` — draft отличается от final только разрешённым', () => {
  // Чтение — внутри `it`, а не в теле `describe`: сломанная фикстура обязана уронить
  // ИМЕНОВАННЫЙ тест, а не сбор файла целиком (тогда в отчёте видно «no tests»).
  const final = (): RenderProfile => loadRenderProfile(path.join(PROFILES, 'render.final.yaml'));
  const draft = (): RenderProfile => loadRenderProfile(path.join(PROFILES, 'render.draft.yaml'));

  // `profileId` — идентичность профиля, а не настройка; `executionProfile` разрешён целиком
  // (ADR-0008 «Draft»: меняются `scale`, `imageFormat`, `jpegQuality`, `crf`, `executionProfile`).
  const ALLOWED = /^(profileId|executionProfile\..+|pixelProfile\.(scale|imageFormat|jpegQuality|crf))$/;

  it('множество путей одинаково: ни одно поле не появилось и не исчезло', () => {
    expect([...leaves(draft()).keys()].sort()).toEqual([...leaves(final()).keys()].sort());
  });

  it('дифф считается механически и целиком лежит в разрешённом множестве', () => {
    const a = leaves(final());
    const b = leaves(draft());
    const differing = [...a.keys()].filter((key) => !Object.is(a.get(key), b.get(key))).sort();

    expect(differing.filter((key) => !ALLOWED.test(key))).toEqual([]);
    // Контроль осмысленности: если дифф пуст, предыдущая строка зелёная по недоразумению.
    expect(differing).toEqual(['pixelProfile.crf', 'pixelProfile.jpegQuality', 'pixelProfile.scale', 'profileId']);
  });

  it('`fps` в профиле рендера отсутствует у обоих — геометрия времени живёт в compileProfile', () => {
    // ADR-0006 §5: `fps` — поле compileProfile, оно входит в ключи `renderIr` и `segment`.
    // Проверяется трижды: в двух артефактах и в самой схеме, чтобы поле нельзя было завести.
    for (const [name, profile] of [['final', final()], ['draft', draft()]] as const) {
      expect([...leaves(profile).keys()].filter((key) => key.endsWith('fps')), name).toEqual([]);
    }
    expect(schemaKeys(RenderProfileSchema).filter((key) => key.endsWith('fps'))).toEqual([]);
  });
});

// ── 4. Ограничения, записанные в ADR ───────────────────────────────────────────────────────

describe('ограничения ADR: каждое нарушение отвергается', () => {
  const final = fixtureText('render.final.yaml');
  const ac4 = fixtureText('render.ac4.yaml');

  const cases: ReadonlyArray<readonly [string, string, string]> = [
    // ADR-0006 §5 / D13: число, никогда `auto` — `threads=1` и `threads=4` дают разный битстрим.
    ['threads-auto', patch(final, 'threads: 4', 'threads: auto'), 'pixelProfile.encoder.threads'],
    ['threads-zero', patch(final, 'threads: 4', 'threads: 0'), 'pixelProfile.encoder.threads'],
    // ADR-0008 «Параллелизм»: в v1 константа, а не настройка.
    ['chapter-parallelism-2', patch(final, 'chapterParallelism: 1', 'chapterParallelism: 2'), 'executionProfile.chapterParallelism'],
    // ADR-0008 «Draft»: `scale` ∈ (0, 1]; увеличение контрактом не предусмотрено.
    ['scale-zero', patch(final, 'scale: 1', 'scale: 0'), 'pixelProfile.scale'],
    ['scale-above-one', patch(final, 'scale: 1', 'scale: 1.5'), 'pixelProfile.scale'],
    // `jpegQuality` при `png` — вычисляемо бессмысленное поле: `ac4` хэширует кадр ДО энкода.
    ['jpeg-quality-with-png', patch(ac4, 'pixelProfile:\n', 'pixelProfile:\n  jpegQuality: 90\n'), 'pixelProfile.jpegQuality'],
    // Обратная половина того же правила.
    ['jpeg-quality-missing', patch(final, '  jpegQuality: 90\n', ''), 'pixelProfile.jpegQuality'],
    // `workers` — целое ≥ 1 (ADR-0008).
    ['workers-zero', patch(final, 'workers: 4', 'workers: 0'), 'executionProfile.workers'],
  ];

  it.each(cases)('%s отвергается с путём к полю', (name, text, expectedPath) => {
    expect(rejectionPaths(name, text)).toContain(expectedPath);
  });
});

// ── 5. K6 (часть профилей) ─────────────────────────────────────────────────────────────────

describe('K6 — в схеме `render-profile/1` нет полей измеренного окружения', () => {
  // ADR-0006 §3: версии hyperframes / chrome-headless-shell / gsap / three / ffmpeg,
  // `compositionHash`, checksum шрифтов и `hostClass` живут ТОЛЬКО в `engineFingerprint`.
  // Charter §6 rev7 закрыл последнее исключение: версия `chrome-headless-shell` пришпилена
  // в lockfile/`vendor/` и охраняется R14, в профиле её нет.
  const FORBIDDEN = ['version', 'hash', 'sha', 'checksum', 'fingerprint'];

  it('обходчик схемы видит все ключи всех уровней', () => {
    // Контроль прибора: без него следующий тест зелёный и на пустом списке.
    const keys = schemaKeys(RenderProfileSchema);
    expect(keys).toContain('profileId');
    expect(keys).toContain('pixelProfile.encoder.bitexact');
    expect(keys).toContain('pixelProfile.jpegQuality'); // optional разворачивается
    expect(keys).toContain('maxProbeDurationFrames');
    expect(keys.length).toBeGreaterThanOrEqual(21);
  });

  it('ни одно имя поля не содержит version/hash/sha/checksum/fingerprint', () => {
    const offenders = schemaKeys(RenderProfileSchema).filter((full) => {
      const leaf = (full.split('.').at(-1) ?? '').toLowerCase();
      return FORBIDDEN.some((word) => leaf.includes(word));
    });
    expect(offenders, 'K6: измеренное окружение обязано жить только в `engineFingerprint`').toEqual([]);
  });

  it('то же правило выполнено и в трёх артефактах фикстуры', () => {
    for (const file of Object.keys(FILE_TO_PROFILE_ID)) {
      const keys = [...leaves(loadRenderProfile(path.join(PROFILES, file))).keys()];
      const offenders = keys.filter((full) => {
        const leaf = (full.split('.').at(-1) ?? '').toLowerCase();
        return FORBIDDEN.some((word) => leaf.includes(word));
      });
      expect(offenders, file).toEqual([]);
    }
  });
});

// ── 6. P16 на семействе `render-profile/1` ────────────────────────────────────────────────

describe('P16 — YAML-значения получают типы схемы, без тихого приведения', () => {
  const final = fixtureText('render.final.yaml');

  it('`bitexact: yes` — парсер оставляет строку, схема отвергает', () => {
    // Ровно то, ради чего выбран `yaml` (YAML 1.2), а не `js-yaml` (YAML 1.1):
    // в 1.1 `yes` стал бы boolean `true` и прошёл бы валидацию как написанный человеком `true`.
    const text = patch(final, 'bitexact: true', 'bitexact: yes');
    const raw = parseYaml(text) as { pixelProfile: { encoder: { bitexact: unknown } } };
    expect(raw.pixelProfile.encoder.bitexact).toBe('yes');
    expect(rejectionPaths('p16-bitexact-yes', text)).toContain('pixelProfile.encoder.bitexact');
  });

  it('`threads: "4"` — строка не приводится к числу', () => {
    const text = patch(final, 'threads: 4', 'threads: "4"');
    expect(parseYaml(text).pixelProfile.encoder.threads).toBe('4');
    expect(rejectionPaths('p16-threads-string', text)).toContain('pixelProfile.encoder.threads');
  });

  it('`crf: 18.0` — тип совпадает со схемой, значение то же самое', () => {
    // В JS одно числовое представление: `18.0` и `18` — один и тот же double, поэтому здесь
    // приведения нет и быть не может. Тест фиксирует именно это, а не «схема лояльна».
    const text = patch(final, 'crf: 18', 'crf: 18.0');
    const raw = parseYaml(text).pixelProfile.crf as unknown;
    expect(typeof raw).toBe('number');
    expect(Object.is(raw, 18)).toBe(true);
    const profile = loadText('p16-crf-float', text) as { pixelProfile: { crf: number } };
    expect(profile.pixelProfile.crf).toBe(18);
  });

  it('контроль: `crf: "18"` отвергается — схема не приводит строку к числу', () => {
    const text = patch(final, 'crf: 18', 'crf: "18"');
    expect(rejectionPaths('p16-crf-string', text)).toContain('pixelProfile.crf');
  });

  it('контроль парсера: `04:30` — строка, а не шестидесятеричное 270', () => {
    // Это вторая половина выбора парсера. В YAML 1.1 `04:30` — целое 270, и
    // `segmentTimeoutMs` молча получил бы осмысленный тип с бессмысленным значением.
    const text = patch(final, 'segmentTimeoutMs: 900000', 'segmentTimeoutMs: 04:30');
    expect(parseYaml(text).executionProfile.segmentTimeoutMs).toBe('04:30');
    expect(rejectionPaths('p16-sexagesimal', text)).toContain('executionProfile.segmentTimeoutMs');
  });
});
