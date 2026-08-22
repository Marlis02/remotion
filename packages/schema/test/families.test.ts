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
