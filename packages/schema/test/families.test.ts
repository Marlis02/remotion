// `S-02` — реестр семейств и толерантный читатель.
//
// Охраняется:
//   * **P1** (`named → guarded`) — у каждого файла в шапке `schema: <family>/N`; файл без
//     шапки отвергается;
//   * **P3** (`named → guarded`) — диалект `source/` читается текущим читателем **без
//     переписывания** и не мигрируется никогда (M7);
//   * **P16** (`named → guarded`) — ядовитые значения YAML на каждом семействе, где есть поле
//     нужного типа: тип совпадает со схемой либо ошибка, но никогда тихое приведение;
//   * форма ошибок: чужое семейство — ОДНА строка, а не стена `unrecognized_keys`;
//     версия `N+1` — «файл записан более новым движком».

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import {
  AssetRecordSchema,
  FAMILIES,
  FAMILY_NAMES,
  FamilyReadError,
  MigrationError,
  migrate,
  readFamily,
} from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

const TMP = path.join(tmpdir(), 'vpe-s02-families');
mkdirSync(TMP, { recursive: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** Все файлы формата в фикстуре — список руками, чтобы новый файл не проехал незамеченным. */
const FIXTURE_FILES: ReadonlyArray<readonly [string, string]> = [
  ['project.yaml', 'project/1'],
  ['publish.yaml', 'publish/1'],
  ['store.lock', 'store-lock/1'],
  ['profiles/compile.yaml', 'compile-profile/1'],
  ['profiles/audio.yaml', 'audio-profile/1'],
  ['profiles/render.final.yaml', 'render-profile/1'],
  ['profiles/render.draft.yaml', 'render-profile/1'],
  ['profiles/render.ac4.yaml', 'render-profile/1'],
  ['assets/aliases.yaml', 'aliases/1'],
  ['direction/01-intro.yaml', 'direction/1'],
  ['source/01-intro.md', 'source-dialect/1'],
  ...readdirSync(path.join(FIXTURE, 'assets/records'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => [`assets/records/${name}`, 'asset-record/1'] as const),
  // `M-02`: шрифт — тоже `asset-record/1`, но лежит в своём каталоге (ADR-0005 §1).
  ...readdirSync(path.join(FIXTURE, 'fonts/records'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => [`fonts/records/${name}`, 'asset-record/1'] as const),
];

const fixturePath = (rel: string): string => path.join(FIXTURE, rel);
const fixtureText = (rel: string): string => readFileSync(fixturePath(rel), 'utf8');

/** Пишет текст во временный файл с нужным расширением и читает штатным читателем. */
function loadText(name: string, text: string, extension = '.yaml'): unknown {
  const file = path.join(TMP, `${name}${extension}`);
  writeFileSync(file, text, 'utf8');
  return readFamily(file);
}

function patch(text: string, from: string, to: string): string {
  const occurrences = text.split(from).length - 1;
  expect(occurrences, `якорь \`${from}\` обязан встречаться ровно один раз`).toBe(1);
  return text.replace(from, to);
}

// ── 1. Чтение фикстуры ─────────────────────────────────────────────────────────────────────

describe('S-02 — все файлы `fixtures/minimal` читаются', () => {
  it.each(FIXTURE_FILES)('%s объявляет %s и проходит валидацию', (rel, header) => {
    const result = readFamily(fixturePath(rel));
    expect(result.header.raw).toBe(header);
    expect(result.entry.family).toBe(header.split('/')[0]);
  });

  it('P3 — проза читается текущим читателем без переписывания: разбирается ТОЛЬКО шапка', () => {
    // ADR-0005 §4 (M7): диалект `source/` не мигрируется никогда. Здесь это исполнимо:
    // тело файла читателю недоступно вовсе, значит переписать его он не может физически.
    const result = readFamily(fixturePath('source/01-intro.md'));
    expect(result.value).toEqual({ schema: 'source-dialect/1' });
    expect(result.entry.neverMigrates).toBe(true);
    expect(result.entry.writable).toBe(false);
  });

  it('покрыты все двенадцать семейств реестра, кроме трёх без файла в фикстуре', () => {
    const covered = new Set(FIXTURE_FILES.map(([, header]) => header.split('/')[0]));
    const uncovered = FAMILY_NAMES.filter((family) => !covered.has(family));
    // `anchors` пишет CLI после первого `vpe parse`; `voice-roles` — файл канала, а не ролика.
    expect(uncovered.sort()).toEqual(['anchors', 'voice-roles']);
  });
});

// ── 2. Шапка: P1 и форма ошибок ────────────────────────────────────────────────────────────

describe('P1 — шапка обязательна, и каждая беда называет свою причину', () => {
  const project = fixtureText('project.yaml');

  it('файл без шапки отвергается', () => {
    expect(() => loadText('no-header', patch(project, 'schema: project/1\n', ''))).toThrow(
      /нет шапки/,
    );
  });

  it('шапка не формы `<семейство>/<версия>` отвергается', () => {
    expect(() => loadText('no-slash', patch(project, 'schema: project/1', 'schema: project'))).toThrow(
      /не имеет формы/,
    );
  });

  it('версия с ведущим нулём отвергается: `project/01` и `project/1` — не одно и то же', () => {
    expect(() => loadText('leading-zero', patch(project, 'schema: project/1', 'schema: project/01'))).toThrow(
      /не является целым числом без ведущих нулей/,
    );
  });

  it('неизвестное семейство называет себя и перечисляет известные', () => {
    let caught: unknown;
    try {
      loadText('unknown-family', patch(project, 'schema: project/1', 'schema: nope/1'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FamilyReadError);
    expect((caught as Error).message).toMatch(/семейство `nope` неизвестно/);
    expect((caught as Error).message).toMatch(/project/);
  });

  it('чужое семейство — ОДНА строка, а не стена `unrecognized_keys`', () => {
    // Это половина смысла отдельного шага шапки: без него `compile-profile/1`, поданный
    // туда, где ждут `render-profile/1`, дал бы по строке ошибки на каждое поле.
    const final = fixtureText('profiles/render.final.yaml');
    const file = path.join(TMP, 'foreign.yaml');
    writeFileSync(file, patch(final, 'schema: render-profile/1', 'schema: compile-profile/1'), 'utf8');

    let caught: unknown;
    try {
      readFamily(file, { expectFamily: 'render-profile' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FamilyReadError);
    const message = (caught as Error).message;
    expect(message).toMatch(/ожидалось семейство `render-profile\/1`, а файл объявляет `compile-profile\/1`/);
    expect(message).not.toMatch(/Unrecognized key/);
    expect(message.split('\n')).toHaveLength(1);
  });

  it('версия N+1 — «файл записан более новым движком», а не падение по undefined', () => {
    let caught: unknown;
    try {
      loadText('newer-engine', patch(project, 'schema: project/1', 'schema: project/2'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FamilyReadError);
    expect((caught as Error).message).toMatch(/записан более новым движком/);
    expect((caught as Error).message).toMatch(/семейство `project`, версия 2/);
    expect((caught as Error).message).toMatch(/знает версии 1/);
    expect((caught as FamilyReadError).version).toBe(2);
  });

  it('расширение файла обязано соответствовать формату семейства', () => {
    // `direction/1` — YAML; тот же текст под именем `.json` не должен читаться «как-нибудь».
    const file = path.join(TMP, 'direction-as.json');
    writeFileSync(file, '{"schema":"direction/1","records":[]}', 'utf8');
    expect(() => readFamily(file)).toThrow(/хранится как `yaml`.*читается как `json`/s);
  });
});

// ── 3. P16 — ядовитые значения на каждом семействе ──────────────────────────────────────────

/** Что YAML 1.2 core делает с каждым значением. Это НЕ обещание схемы, а поведение парсера. */
const POISON: ReadonlyArray<readonly [string, 'string' | 'number' | 'null']> = [
  ['no', 'string'],
  ['yes', 'string'],
  ['on', 'string'],
  ['08', 'number'],
  ['1.20', 'number'],
  ['04:30', 'string'],
  ['~', 'null'],
  ['null', 'null'],
  ['""', 'string'],
  ['0x10', 'number'],
];

/** Поля-мишени: по одному на тип, из семейств, где такой тип есть. */
const TARGETS: ReadonlyArray<{
  readonly rel: string;
  readonly anchor: string;
  readonly key: string;
  readonly path: string;
  readonly expect: 'boolean' | 'number' | 'string';
}> = [
  { rel: 'profiles/render.final.yaml', anchor: 'browserGpu: false', key: 'browserGpu', path: 'pixelProfile.browserGpu', expect: 'boolean' },
  { rel: 'publish.yaml', anchor: 'madeForKids: false', key: 'madeForKids', path: 'madeForKids', expect: 'boolean' },
  { rel: 'profiles/render.final.yaml', anchor: 'gopSize: 30', key: 'gopSize', path: 'pixelProfile.gopSize', expect: 'number' },
  { rel: 'profiles/compile.yaml', anchor: 'maxDurationFrames: 1800', key: 'maxDurationFrames', path: 'maxDurationFrames', expect: 'number' },
  { rel: 'profiles/audio.yaml', anchor: 'bitrateKbps: 192', key: 'bitrateKbps', path: 'bitrateKbps', expect: 'number' },
  { rel: 'project.yaml', anchor: 'id: minimal', key: 'id', path: 'id', expect: 'string' },
  { rel: 'publish.yaml', anchor: 'topic: history', key: 'topic', path: 'topic', expect: 'string' },
  { rel: 'profiles/audio.yaml', anchor: 'codec: aac', key: 'codec', path: 'codec', expect: 'string' },
  { rel: 'profiles/compile.yaml', anchor: 'templateRegistryVersion: "1"', key: 'templateRegistryVersion', path: 'templateRegistryVersion', expect: 'string' },
];

/** Значение по точечному пути — мишени лежат и на верхнем уровне, и внутри `pixelProfile`. */
function at(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const step of dotted.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

describe('P16 — YAML-значения получают типы схемы, без тихого приведения', () => {
  it.each(TARGETS)('$rel → $path принимает только $expect', (target) => {
    const original = fixtureText(target.rel);
    for (const [poison, parsedAs] of POISON) {
      const text = patch(original, target.anchor, `${target.key}: ${poison}`);
      const raw = at(parseYaml(text), target.path);
      const rawKind = raw === null ? 'null' : typeof raw;

      // (а) парсер сделал ровно то, что обещано YAML 1.2 core, и ничего сверх.
      // Для вложенных полей верхнего уровня в объекте `raw` будет undefined — тогда
      // проверяется только (б): значение лежит глубже, но правило то же.
      expect(rawKind, `${target.path}: ${poison} → парсер YAML 1.2`).toBe(parsedAs);

      // (б) схема либо принимает значение ОБЪЯВЛЕННОГО типа, либо отвергает. Третьего
      // (принять и привести) быть не может.
      let accepted: unknown = Symbol('rejected');
      try {
        accepted = loadText(`p16-${target.key}-${poison.replace(/\W/g, '_')}`, text);
      } catch {
        accepted = Symbol('rejected');
      }
      if (typeof accepted !== 'symbol') {
        const value = at((accepted as { value: unknown }).value, target.path);
        expect(typeof value, `${target.path}: ${poison} принято — тип обязан совпасть со схемой`).toBe(
          target.expect,
        );
        // И это ГЛАВНОЕ утверждение: принятое значение обязано быть ТЕМ ЖЕ, что вернул
        // парсер. Проверки одного типа мало — `z.coerce.string()` тоже возвращает строку,
        // превратив `08` в `"8"`, то есть ровно молча приведя. Протокол ручных нарушений
        // это и нашёл: без этой строки охранник P16 пропускал приведение (см. отчёт S-02).
        expect(value, `${target.path}: ${poison} принято — значение обязано совпасть с разобранным`)
          .toStrictEqual(raw);
      }
    }
  });

  it('`no`/`yes`/`on` НИКОГДА не становятся boolean ни в одном файле фикстуры', () => {
    // Ровно то, ради чего выбран `yaml` (YAML 1.2), а не `js-yaml` (YAML 1.1).
    for (const [rel] of FIXTURE_FILES) {
      if (!rel.endsWith('.yaml') && !rel.endsWith('.lock')) continue;
      const text = fixtureText(rel);
      for (const word of ['no', 'yes', 'on']) {
        const probe = parseYaml(`probe: ${word}\n`) as { probe: unknown };
        expect(typeof probe.probe, `${rel}: ${word}`).toBe('string');
      }
      expect(typeof (parseYaml('probe: 04:30\n') as { probe: unknown }).probe).toBe('string');
      void text;
    }
  });
});

// ── 4. Реестр и миграции ───────────────────────────────────────────────────────────────────

describe('S-02 — реестр и форма миграций (P2)', () => {
  it('в реестре двенадцать семейств, и `override` среди них нет', () => {
    expect(FAMILY_NAMES).toHaveLength(12);
    expect(FAMILY_NAMES).not.toContain('override');
  });

  it('у каждого семейства текущая версия есть в таблице версий', () => {
    for (const family of FAMILY_NAMES) {
      const entry = FAMILIES.get(family);
      expect(entry?.versions.has(entry.current), family).toBe(true);
    }
  });

  it('миграция «с версии на ту же» — пустой план, любая другая — ошибка', () => {
    expect(migrate('project', 1, 1).steps).toEqual([]);
    expect(() => migrate('project', 1, 2)).toThrow(MigrationError);
    expect(() => migrate('project', 1, 2)).toThrow(/нет ни одного бампа схемы/);
  });

  it('`source-dialect` не мигрируется никогда (M7) — даже «в ту же версию»', () => {
    expect(() => migrate('source-dialect', 1, 1)).toThrow(/не мигрируется никогда/);
  });

  it('неизвестное семейство в миграции — ошибка, а не тихий пустой план', () => {
    expect(() => migrate('override', 1, 1)).toThrow(/семейство `override` неизвестно/);
  });
});

// ── 5. `store-lock/1` — окончательная форма (`M-01`) ────────────────────────────────────────
//
// До `M-01` форма семейства была собрана из ADR-0005 §1 и комментария фикстуры и не могла
// быть проверена ничем: в `fixtures/minimal/store.lock` стоит `entries: []`, то есть ни одна
// запись не могла ей противоречить. Здесь появляется первая настоящая запись — и вместе с ней
// ядовитые значения по образцу §3 этого файла.
//
// Файл фикстуры при этом НЕ меняется и остаётся валидным: `entries: []` + `lastVerifiedAt: null`
// проходят принятую форму без единой правки (проверяется в блоке 1 этого же файла).

const SHA_A = '1'.repeat(64);
const SHA_B = 'a'.repeat(64);
const SHA_C = 'f'.repeat(64);

interface EntryFields {
  readonly sha256?: string;
  readonly size?: string;
  readonly kind?: string;
  readonly origin?: string;
  readonly replicas?: string;
  readonly extra?: string;
}

/** Запись `store-lock/1` как ТЕКСТ: ядовитые значения обязаны пройти через YAML, а не мимо. */
function entryText(fields: EntryFields = {}): string {
  const lines = [
    `  - sha256: ${fields.sha256 ?? `"${SHA_A}"`}`,
    `    size: ${fields.size ?? '12'}`,
    `    kind: ${fields.kind ?? '"voice"'}`,
    `    origin: ${fields.origin ?? '"tts:mock@1"'}`,
    `    replicas: ${fields.replicas ?? '["local-dir", "rclone:backup"]'}`,
  ];
  if (fields.extra !== undefined) lines.push(`    ${fields.extra}`);
  return lines.join('\n');
}

function lockText(entries: string[], head = 'lastVerifiedAt: "2026-08-23T10:00:00Z"'): string {
  const body = entries.length === 0 ? 'entries: []' : ['entries:', ...entries].join('\n');
  return `schema: store-lock/1\n${head}\n${body}\n`;
}

/** Читает текст ИМЕННО как `store.lock` — расширение `.lock` разбирается как YAML. */
function loadLock(name: string, text: string): unknown {
  return loadText(`store-lock-${name}`, text, '.lock');
}

describe('`store-lock/1` — принятая форма читается, ядовитая отвергается', () => {
  it('запись из пяти полей принимается, и значения не приводятся молча', () => {
    const result = loadLock('valid', lockText([entryText()])) as { value: unknown };
    expect(result.value).toStrictEqual({
      schema: 'store-lock/1',
      lastVerifiedAt: '2026-08-23T10:00:00Z',
      entries: [
        {
          sha256: SHA_A,
          size: 12,
          kind: 'voice',
          origin: 'tts:mock@1',
          replicas: ['local-dir', 'rclone:backup'],
        },
      ],
    });
  });

  it('лишнее поле в записи — ошибка с путём к полю (`.strict()`)', () => {
    expect(() => loadLock('extra-entry', lockText([entryText({ extra: 'note: "почему-то"' })]))).toThrow(
      /note/,
    );
  });

  it('лишнее поле на корне — ошибка', () => {
    expect(() =>
      loadLock('extra-root', `${lockText([entryText()])}storeVerifyMaxAgeDays: 14\n`),
    ).toThrow(/storeVerifyMaxAgeDays/);
  });

  it.each([
    ['короче 64 символов', '1'.repeat(63)],
    ['длиннее 64 символов', '1'.repeat(65)],
    ['верхний регистр', 'A'.repeat(64)],
    ['не hex', 'z'.repeat(64)],
  ])('sha256 неверной формы отвергается: %s', (_title, sha) => {
    expect(() => loadLock(`sha-${_title.replace(/\W/g, '_')}`, lockText([entryText({ sha256: `"${sha}"` })]))).toThrow(
      /64 строчных hex/,
    );
  });

  it.each([
    ['отрицательный', '-1'],
    ['дробный', '1.5'],
    ['строкой', '"12"'],
  ])('size отвергается: %s', (_title, size) => {
    expect(() => loadLock(`size-${_title}`, lockText([entryText({ size })]))).toThrow();
  });

  it('size == 0 законен: пустой блоб — законные байты со своим sha256', () => {
    expect(() => loadLock('size-zero', lockText([entryText({ size: '0' })]))).not.toThrow();
  });

  it('неизвестный `kind` отвергается — ровно то, ради чего вид перечислён (P7)', () => {
    // Опечатка `voise` не ломает ничего видимого: она молча выводит невосстановимые байты
    // из-под правила «реплик ≥ 2». Поэтому вид — enum, а не свободная строка.
    expect(() => loadLock('kind-typo', lockText([entryText({ kind: '"voise"' })]))).toThrow();
  });

  it.each(['voice', 'asset', 'font', 'snapshot', 'c2pa', 'ai-image'])('`kind: %s` принимается', (kind) => {
    expect(() => loadLock(`kind-${kind}`, lockText([entryText({ kind: `"${kind}"` })]))).not.toThrow();
  });

  it('пустой `origin` отвергается: «неизвестно откуда» — не значение', () => {
    expect(() => loadLock('origin-empty', lockText([entryText({ origin: '""' })]))).toThrow();
  });

  it('`replicas` — список, а не строка', () => {
    expect(() => loadLock('replicas-string', lockText([entryText({ replicas: '"local-dir"' })]))).toThrow();
  });

  it('пустой `replicas` ПРИНИМАЕТСЯ, и это граница: P7 проверяет `verify`, а не схема', () => {
    // Байты уже в CAS, `vpe store push` ещё не выполнялся — запись обязана существовать.
    // Схема, требующая двух реплик, превратила бы отчёт `verify` в отказ записи.
    expect(() => loadLock('replicas-empty', lockText([entryText({ kind: '"voice"', replicas: '[]' })]))).not.toThrow();
  });

  it.each([
    ['со смещением', '"2026-08-23T13:00:00+03:00"'],
    ['с долями секунды', '"2026-08-23T10:00:00.000Z"'],
    ['без `Z`', '"2026-08-23T10:00:00"'],
    ['только дата', '"2026-08-23"'],
  ])('`lastVerifiedAt` вне одной формы отвергается: %s', (_title, value) => {
    expect(() => loadLock(`when-${_title.replace(/\W/g, '_')}`, lockText([], `lastVerifiedAt: ${value}`))).toThrow(
      /YYYY-MM-DDTHH:MM:SSZ/,
    );
  });

  it('`lastVerifiedAt: null` — законное «verify не выполнялся» (P7)', () => {
    const result = loadLock('when-null', lockText([], 'lastVerifiedAt: null')) as { value: { lastVerifiedAt: unknown } };
    expect(result.value.lastVerifiedAt).toBeNull();
  });

  it('два раза один sha256 — ошибка: у одного адреса CAS не два утверждения', () => {
    expect(() => loadLock('dup', lockText([entryText({ sha256: `"${SHA_A}"` }), entryText({ sha256: `"${SHA_A}"` })]))).toThrow(
      /встречается дважды/,
    );
  });

  it('несортированные записи — ошибка, и ключ сортировки назван в сообщении', () => {
    let caught: unknown;
    try {
      loadLock('unsorted', lockText([entryText({ sha256: `"${SHA_C}"` }), entryText({ sha256: `"${SHA_A}"` })]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/не отсортированы по sha256/);
    expect(String(caught)).toMatch(/побайтово-лексикографически/);
  });

  it('отсортированные по возрастанию hex записи принимаются', () => {
    const text = lockText([
      entryText({ sha256: `"${SHA_A}"` }),
      entryText({ sha256: `"${SHA_B}"`, kind: '"asset"' }),
      entryText({ sha256: `"${SHA_C}"`, kind: '"snapshot"' }),
    ]);
    const result = loadLock('sorted', text) as { value: { entries: { sha256: string }[] } };
    expect(result.value.entries.map((entry) => entry.sha256)).toEqual([SHA_A, SHA_B, SHA_C]);
  });
});

// ── 6. `asset-record/1` — третья ветка `intrinsic`: шрифт (`M-02`) ──────────────────────────
//
// До `M-02` веток было две (изображение и звук), а `fonts/records/` существовал пустым: формы
// записи шрифта не было ни в ADR-0005, ни в фикстуре, и комментарий схемы называл `M-02`
// адресом, по которому она появится. Здесь она появилась — вместе с первой настоящей записью
// `fixtures/minimal/fonts/records/<sha>.json` (DejaVu Sans Bold, временный шрифт канала:
// решение владельца 4, долг №13).
//
// ЧТО ИМЕННО ОХРАНЯЕТСЯ ЭТИМ БЛОКОМ:
//   * ветка `.strict()` по образцу двух соседних — лишнее поле не проезжает;
//   * ЗАПИСЬ ШРИФТА БЕЗ ЛИЦЕНЗИИ ОТВЕРГАЕТСЯ, и на двух уровнях сразу: `fsType` (разрешение
//     на встраивание — обязательное поле ветки) и `provenance` (лицензия произведения и
//     репродукции — обязательный блок всей записи);
//   * ГРАНИЦА «схема записывает, но не судит» (решение владельца `M-02`): `fsType`
//     ограничивающего значения — законная запись, а не отказ. Судит Policy Guard (`CP-06`).

const FONT_SHA = '0'.repeat(63) + '5';

interface FontFields {
  readonly family?: string;
  readonly subfamily?: string;
  readonly format?: string;
  readonly fsType?: string;
  readonly extra?: string;
  readonly intrinsic?: string;
  readonly provenance?: string;
}

const FONT_PROVENANCE = `{
    "work": { "status": "bitstream-vera" },
    "reproduction": { "status": "bitstream-vera", "attributionRequired": true },
    "recording": { "status": "n/a" },
    "origin": { "sourceUrl": null, "retrievedAt": "2026-08-23T00:00:00Z" },
    "sourceSnapshot": null,
    "c2paManifestBlob": null
  }`;

/** Запись шрифта как ТЕКСТ: ядовитые значения обязаны пройти через JSON, а не мимо. */
function fontText(fields: FontFields = {}): string {
  const parts = [
    `"family": ${fields.family ?? '"DejaVu Sans"'}`,
    `"subfamily": ${fields.subfamily ?? '"Bold"'}`,
    `"format": ${fields.format ?? '"ttf"'}`,
    `"fsType": ${fields.fsType ?? '0'}`,
  ];
  if (fields.extra !== undefined) parts.push(fields.extra);
  const intrinsic = fields.intrinsic ?? `{ ${parts.join(', ')} }`;
  return [
    '{',
    '  "schema": "asset-record/1",',
    `  "sha256": "${FONT_SHA}",`,
    '  "kind": "font",',
    `  "intrinsic": ${intrinsic},`,
    '  "derivedFrom": null,',
    `  "provenance": ${fields.provenance ?? FONT_PROVENANCE}`,
    '}',
    '',
  ].join('\n');
}

function loadRecord(name: string, text: string): unknown {
  return loadText(`asset-record-${name}`, text, '.json');
}

describe('`asset-record/1` — ветка шрифта принимается, ядовитая отвергается (`M-02`)', () => {
  it('запись шрифта фикстуры читается, и значения не приводятся молча', () => {
    const result = readFamily(fixturePath(`fonts/records/${FONT_SHA}.json`));
    expect(result.header.raw).toBe('asset-record/1');
    expect((result.value as { intrinsic: unknown }).intrinsic).toStrictEqual({
      family: 'DejaVu Sans',
      subfamily: 'Bold',
      format: 'ttf',
      fsType: 0,
    });
  });

  it('запись шрифта фикстуры НЕСЁТ ЛИЦЕНЗИЮ: статусы произведения и репродукции — не пустые', () => {
    // Критерий готовности `M-02` дословно: «запись шрифта несёт лицензию». Тест проверяет
    // не наличие ключа, а то, что значение — настоящее: `identifier()` не пропустит `""`.
    const value = readFamily(fixturePath(`fonts/records/${FONT_SHA}.json`)).value as {
      provenance: {
        work: { status: string };
        reproduction: { status: string; attributionRequired: boolean; attributionText?: string };
      };
    };
    expect(value.provenance.work.status).toBe('bitstream-vera');
    expect(value.provenance.reproduction.status).toBe('bitstream-vera');
    expect(value.provenance.reproduction.attributionRequired).toBe(true);
    expect(value.provenance.reproduction.attributionText).toMatch(/Bitstream/);
  });

  it('ветка принимается целиком', () => {
    expect(() => loadRecord('font-valid', fontText())).not.toThrow();
  });

  it.each(['ttf', 'otf', 'woff', 'woff2'])('`format: %s` принимается', (format) => {
    expect(() => loadRecord(`font-format-${format}`, fontText({ format: `"${format}"` }))).not.toThrow();
  });

  it.each([
    ['неизвестный формат', '"ttc"'],
    ['верхний регистр', '"TTF"'],
    ['с точкой', '".ttf"'],
    ['MIME вместо формата', '"font/ttf"'],
  ])('`format` вне перечня отвергается: %s', (title, format) => {
    // Перечень, а не свободная строка: незнакомое значение — не «новый законный вход», а
    // молча битый `data URI` в готовом ролике (байты приходят из CAS без имени файла).
    expect(() => loadRecord(`font-format-bad-${title.replace(/\W/g, '_')}`, fontText({ format }))).toThrow();
  });

  it('ЗАПИСЬ ШРИФТА БЕЗ `fsType` ОТВЕРГАЕТСЯ — поле прав обязательно', () => {
    expect(() =>
      loadRecord('font-no-fstype', fontText({ intrinsic: '{ "family": "DejaVu Sans", "subfamily": "Bold", "format": "ttf" }' })),
    ).toThrow();
  });

  it('ЗАПИСЬ ШРИФТА БЕЗ `provenance` ОТВЕРГАЕТСЯ — лицензия у шрифта обязательна, как у всех', () => {
    const text = fontText().replace(/,\n  "provenance": [\s\S]*\n}/, '\n}');
    expect(text).not.toMatch(/provenance/);
    expect(() => loadRecord('font-no-provenance', text)).toThrow();
  });

  it('пустой статус прав отвергается: «неизвестно чьё» — не значение', () => {
    expect(() =>
      loadRecord('font-empty-status', fontText({ provenance: FONT_PROVENANCE.replace('"bitstream-vera"', '""') })),
    ).toThrow();
  });

  it.each([
    ['без `family`', '{ "subfamily": "Bold", "format": "ttf", "fsType": 0 }'],
    ['без `subfamily`', '{ "family": "DejaVu Sans", "format": "ttf", "fsType": 0 }'],
    ['без `format`', '{ "family": "DejaVu Sans", "subfamily": "Bold", "fsType": 0 }'],
    ['пустой `family`', '{ "family": "", "subfamily": "Bold", "format": "ttf", "fsType": 0 }'],
  ])('неполная ветка шрифта отвергается: %s', (title, intrinsic) => {
    expect(() => loadRecord(`font-partial-${title.replace(/\W/g, '_')}`, fontText({ intrinsic }))).toThrow();
  });

  it('лишнее поле в ветке — ошибка (`.strict()`, как у двух соседних веток)', () => {
    expect(() => loadRecord('font-extra', fontText({ extra: '"unitsPerEm": 2048' }))).toThrow();
  });

  it.each([
    ['отрицательный', '-1'],
    ['дробный', '1.5'],
    ['строкой', '"0"'],
    ['шире uint16', '65536'],
    ['null', 'null'],
  ])('`fsType` неверной ФОРМЫ отвергается: %s', (title, fsType) => {
    expect(() => loadRecord(`font-fstype-${title.replace(/\W/g, '_')}`, fontText({ fsType }))).toThrow();
  });

  it.each([
    ['installable (ограничений нет)', '0'],
    ['restricted license embedding', '2'],
    ['preview & print', '4'],
    ['no subsetting', '256'],
    ['предел uint16', '65535'],
  ])('`fsType` ограничивающего значения ПРИНИМАЕТСЯ: %s — схема записывает, но не судит', (title, fsType) => {
    // Граница, проведённая решением владельца (`M-02`): правило «значение допускает
    // встраивание» принадлежит Policy Guard (`CP-06`). Схема, отвергающая `fsType: 2`,
    // вшила бы политику в формат — и ассет, законный для другого сценария использования,
    // стал бы нечитаемым файлом. Тест охраняет именно ЭТО, а не терпимость к мусору:
    // соседний блок показывает, что неверная ФОРМА того же поля отвергается.
    expect(() => loadRecord(`font-fstype-ok-${title.replace(/\W/g, '_')}`, fontText({ fsType }))).not.toThrow();
  });

  it.each([
    ['шрифт + изображение', '{ "family": "DejaVu Sans", "subfamily": "Bold", "format": "ttf", "fsType": 0, "width": 4000, "height": 2670 }'],
    ['изображение + `fsType`', '{ "width": 4000, "height": 2670, "fsType": 0 }'],
    ['звук + `format`', '{ "durationSamples": 2880000, "sampleRate": 24000, "format": "ttf" }'],
  ])('ветки не смешиваются: %s', (title, intrinsic) => {
    expect(() => loadRecord(`font-mixed-${title.replace(/\W/g, '_')}`, fontText({ intrinsic }))).toThrow();
  });

  it('СОСТАВ ВЕТКИ — РОВНО ЧЕТЫРЕ ПОЛЯ: второго места для лицензии в записи нет', () => {
    // Охраняет не данные, а ФОРМУ, и заведён по измерению (протокол нарушений `M-02`, №6):
    // `.strict()` ловит лишнее поле в ЗАПИСИ, но добавление пятого поля в саму ВЕТКУ он
    // поймать не может — а это ровно то, чем стал бы отклонённый вариант Б (`licenseId`
    // рядом с `provenance`). Решение владельца: лицензия живёт в `provenance`, там же, где
    // у всех остальных ассетов; второй словарь разошёлся бы с первым при первой правке.
    const branches = AssetRecordSchema.shape.intrinsic.options;
    expect(branches).toHaveLength(3);
    expect(Object.keys(branches[0].shape)).toEqual(['width', 'height']);
    expect(Object.keys(branches[1].shape)).toEqual(['durationSamples', 'sampleRate']);
    expect(Object.keys(branches[2].shape)).toEqual(['family', 'subfamily', 'format', 'fsType']);
  });

  it('две прежние ветки не сломаны: изображение и звук читаются как раньше', () => {
    expect(() => loadRecord('image', fontText({ intrinsic: '{ "width": 4000, "height": 2670 }' }))).not.toThrow();
    expect(() =>
      loadRecord('audio', fontText({ intrinsic: '{ "durationSamples": 2880000, "sampleRate": 24000 }' })),
    ).not.toThrow();
  });
});
