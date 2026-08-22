// `S-02` — канонический писатель и `checkCanonical`.
//
// Охраняется **P17** (`named → guarded`): значения-идентификаторы в YAML пишутся в кавычках,
// и список полей-идентификаторов берётся ИЗ СХЕМЫ (пометка `.meta({ vpeIdentifier })`),
// а не угадывается по содержимому.
//
// РЕШЕНИЕ ВЛАДЕЛЬЦА (`S-02`, 2026-08-22), без которого этот файл читается неверно:
// **фикстуры к канону НЕ приводятся.** Писатель комментарии не сохраняет, а в
// `fixtures/minimal` их около сотни, и это не украшения — ссылки на ADR, `FACT` с номерами
// спайков, зафиксированные `UNKNOWN`. Поэтому здесь проверяется не «фикстуры каноничны»,
// а «расхождение фикстур с каноном состоит ТОЛЬКО из объяснимых категорий, и каждая
// опознаётся механически». `checkCanonical` при этом честно краснеет — это видимый долг,
// а не тихое расхождение. Вопрос «канон обязан уметь комментарии» адресован владельцу
// и решается в `L-03` вместе с `vpe fmt`.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  FamilyWriteError,
  canonicalTextOf,
  checkCanonical,
  readFamily,
  renderFamily,
  type DifferenceKind,
} from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

const TMP = path.join(tmpdir(), 'vpe-s02-canonical');
mkdirSync(TMP, { recursive: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** Все файлы фикстуры, которые писатель умеет создавать (проза — не умеет и не должен). */
const WRITABLE: readonly string[] = [
  'project.yaml',
  'publish.yaml',
  'store.lock',
  'profiles/compile.yaml',
  'profiles/audio.yaml',
  'profiles/render.final.yaml',
  'profiles/render.draft.yaml',
  'profiles/render.ac4.yaml',
  'assets/aliases.yaml',
  'direction/01-intro.yaml',
  ...readdirSync(path.join(FIXTURE, 'assets/records'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `assets/records/${name}`),
];

const at = (rel: string): string => path.join(FIXTURE, rel);

/** Пишет текст во временный файл и возвращает путь — для проверок на изменённых копиях. */
function temp(name: string, text: string, extension = '.yaml'): string {
  const file = path.join(TMP, `${name}${extension}`);
  writeFileSync(file, text, 'utf8');
  return file;
}

// ── 1. Идемпотентность писателя ────────────────────────────────────────────────────────────

describe('S-02 — каноническая форма устойчива', () => {
  it.each(WRITABLE)('%s: write(read(x)) идемпотентен', (rel) => {
    const once = canonicalTextOf(at(rel));
    const file = temp(`idem-${rel.replace(/\W/g, '_')}`, once, path.extname(rel) || '.yaml');
    const twice = canonicalTextOf(file);
    expect(twice).toBe(once);
  });

  it.each(WRITABLE)('%s: каноническая форма сама канонична и читается тем же читателем', (rel) => {
    const file = temp(`canon-${rel.replace(/\W/g, '_')}`, canonicalTextOf(at(rel)), path.extname(rel) || '.yaml');
    const report = checkCanonical(file);
    expect(report.differences, JSON.stringify(report.differences)).toEqual([]);
    expect(report.canonical).toBe(true);
    // И значение переживает круг «прочитать → записать → прочитать» без потерь.
    expect(readFamily(file).value).toEqual(readFamily(at(rel)).value);
  });

  it('писатель отказывается трогать прозу: `source-dialect/1` не записывается', () => {
    // Иначе он вернул бы файл из одной строки — то есть уничтожил бы сценарий (M7).
    expect(() => renderFamily('source-dialect', { schema: 'source-dialect/1' })).toThrow(FamilyWriteError);
    expect(() => renderFamily('source-dialect', { schema: 'source-dialect/1' })).toThrow(/не записывается/);
  });

  it('писатель не создаёт файлов, которые читатель отвергнет', () => {
    expect(() => renderFamily('project', { schema: 'project/1' })).toThrow();
  });
});

// ── 2. Дифф фикстур против канона: только объяснимые категории ─────────────────────────────

describe('S-02 — чем фикстуры отличаются от канона (решение: не приводить)', () => {
  /** Категории, которые владелец согласился считать объяснимыми. */
  const EXPLAINED: readonly DifferenceKind[] = ['comment', 'identifier-quoting', 'key-order', 'other'];

  it.each(WRITABLE)('%s: расхождения только объяснимых категорий', (rel) => {
    const report = checkCanonical(at(rel));
    const kinds = [...new Set(report.differences.map((d) => d.kind))];
    expect(kinds.filter((kind) => !EXPLAINED.includes(kind))).toEqual([]);
  });

  it('ни одного расхождения по хвостовым пробелам — их и в фикстурах нет', () => {
    for (const rel of WRITABLE) {
      const report = checkCanonical(at(rel));
      expect(report.differences.filter((d) => d.kind === 'trailing-whitespace'), rel).toEqual([]);
    }
  });

  it('порядок ключей расходится ТОЛЬКО в открытых картах, а не в объявленных схемой', () => {
    // Существенное утверждение: в объявленных объектах фикстуры УЖЕ идут в порядке схемы.
    // Расходятся только `aliases/1` (ключи придумывает автор) и `direction/1 → params`
    // (их нормирует манифест шаблона, `TS-01`), где порядок объявления просто не существует
    // и канон берёт байтовый.
    const offenders = WRITABLE.flatMap((rel) =>
      checkCanonical(at(rel))
        .differences.filter((d) => d.kind === 'key-order')
        .map((d) => `${rel}: ${d.message}`),
    );
    for (const line of offenders) {
      expect(line, line).toMatch(/aliases\.yaml|params/);
    }
    expect(offenders.length, 'дифф должен быть непустым — иначе тест зелёный по недоразумению')
      .toBeGreaterThan(0);
  });

  it('комментарии — главная категория, и они есть почти в каждом файле', () => {
    const withComments = WRITABLE.filter((rel) =>
      checkCanonical(at(rel)).differences.some((d) => d.kind === 'comment'),
    );
    // Проза (`source/*.md`) сюда не входит: она не записывается вовсе.
    expect(withComments.length).toBeGreaterThanOrEqual(9);
  });

  it('`checkCanonical` называет, какие проверки выполнялись — зелёный нельзя прочитать шире', () => {
    const prose = checkCanonical(at('source/01-intro.md'));
    expect(prose.canonical).toBe(true);
    // Ровно одна проверка из четырёх: остальное — проза, и канона у неё нет.
    expect(prose.checks).toEqual(['trailing-whitespace']);

    const yaml = checkCanonical(at('project.yaml'));
    expect(yaml.checks).toEqual(['trailing-whitespace', 'comment', 'identifier-quoting', 'key-order', 'other']);
  });
});

// ── 3. P17 — идентификаторы в кавычках ─────────────────────────────────────────────────────

describe('P17 — значения-идентификаторы пишутся в кавычках', () => {
  it('writeFamily ставит кавычки там, где схема пометила поле идентификатором', () => {
    const canonical = canonicalTextOf(at('project.yaml'));
    expect(canonical).toContain('id: "minimal"');
    expect(canonical).toContain('channelId: "demo-channel"');
    expect(canonical).toContain('compile: "profiles/compile.yaml"');
    // Не идентификаторы — без кавычек: число остаётся числом, boolean остаётся boolean.
    expect(canonical).toContain('width: 1080');
    expect(canonical).toContain('seedRoot: 305419896');
  });

  it('checkCanonical сообщает про идентификатор без кавычек — с путём и номером строки', () => {
    const report = checkCanonical(at('project.yaml'));
    const quoting = report.differences.filter((d) => d.kind === 'identifier-quoting');
    expect(quoting.map((d) => d.message)).toContain('`id` — идентификатор, а записан без кавычек (P17)');
    expect(quoting.every((d) => typeof d.line === 'number' && d.line > 0)).toBe(true);
  });

  it('список полей-идентификаторов берётся из схемы, а не угадывается по содержимому', () => {
    // `sha256` в `aliases/1` — идентификатор ПО СХЕМЕ, и потому в кавычках. `size` в записи
    // `store-lock/1` — число, и кавычек не получает, хотя рядом лежат такие же цифры.
    const aliases = canonicalTextOf(at('assets/aliases.yaml'));
    expect(aliases).toMatch(/harbour: "0{63}1"/);

    // Контроль наоборот: строка, НЕ помеченная идентификатором, кавычек не получает —
    // если только их не требует сам YAML (защита P16 со стороны писателя).
    const publish = canonicalTextOf(at('publish.yaml'));
    expect(publish).toContain('topic: "history"'); // помечено ⇒ в кавычках
    expect(publish).toContain('title: What the Harbour Was Waiting For'); // не помечено
  });

  it('писатель сам не создаёт ядовитых значений: `no`, `08`, `04:30`, пустая строка — в кавычках', () => {
    // P16 со стороны писателя. Иначе он записал бы строку, которую собственный читатель
    // потом вернул бы boolean'ом или числом.
    const value = {
      schema: 'publish/1',
      title: 'no',
      descriptionTemplate: '',
      topic: '08',
      voiceRole: '04:30',
      madeForKids: false,
      disclosure: { syntheticVoice: true, aiImagery: false, aiMusic: false },
      sources: [],
    };
    const text = renderFamily('publish', value);
    expect(text).toContain('title: "no"');
    expect(text).toContain('descriptionTemplate: ""');
    expect(text).toContain('topic: "08"');
    expect(text).toContain('voiceRole: "04:30"');
    // И круг замыкается: то, что он записал, читается обратно теми же типами.
    const file = temp('poison-roundtrip', text);
    expect(readFamily(file).value).toEqual(value);
  });
});

// ── 4. `direction/1`: ветка `track: voice` ─────────────────────────────────────────────────

describe('S-02 — `direction/1`: запись роли голоса отличается от записи шаблона', () => {
  const base = {
    recordId: 'a3f19c2b',
    at: { kind: 'anchor', anchor: 'sc:turn' },
  };
  const wrap = (record: unknown): unknown => ({ schema: 'direction/1', records: [record] });
  const load = (name: string, record: unknown): unknown => {
    const file = temp(name, `${renderFamilyOrThrow(record)}`);
    return readFamily(file).value;
  };
  const renderFamilyOrThrow = (record: unknown): string => renderFamily('direction', wrap(record));

  it('запись `track: voice` с `voiceRole` законна', () => {
    const record = { ...base, track: 'voice', voiceRole: 'narrator' };
    expect(load('voice-ok', record)).toEqual(wrap(record));
  });

  it('запись `track: voice` с `template` — ошибка', () => {
    // ADR-0010 §3a-bis: `voiceRole` ВМЕСТО `template`/`params`, а не вместе с ними.
    expect(() =>
      renderFamilyOrThrow({ ...base, track: 'voice', voiceRole: 'narrator', template: 'kenburns@1' }),
    ).toThrow();
  });

  it('обычная запись без `template` — ошибка', () => {
    expect(() => renderFamilyOrThrow({ ...base, track: 'visual', z: 10, params: {} })).toThrow();
  });

  it('ссылка на `w:` отвергается схемой — правило ADR-0004 §2 (инвариант A1)', () => {
    expect(() =>
      renderFamilyOrThrow({
        recordId: 'a3f19c2b',
        at: { kind: 'anchor', anchor: 'w:7f2q' },
        track: 'visual',
        z: 10,
        template: 'kenburns@1',
        params: {},
      }),
    ).toThrow();
  });
});

// ── 5. `voice-roles/1`: `voice_id` — имя переменной, а не значение ─────────────────────────

describe('S-02 — `voice-roles/1`: секрет не попадает в файл', () => {
  const roles = (voiceId: string): unknown => ({
    schema: 'voice-roles/1',
    roles: [
      {
        roleId: 'narrator',
        modelId: 'eleven_multilingual_v2',
        voice_id: voiceId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
    ],
  });

  it('имя переменной окружения принимается', () => {
    const text = renderFamily('voice-roles', roles('ELEVENLABS_VOICE_ID'));
    const file = temp('voice-roles-ok', text);
    expect(readFamily(file).value).toEqual(roles('ELEVENLABS_VOICE_ID'));
    expect(text).toContain('voice_id: "ELEVENLABS_VOICE_ID"');
  });

  it('настоящий `voice_id` провайдера отвергается — CLAUDE.md §2', () => {
    // Форма реального идентификатора ElevenLabs (строчный алфавитно-цифровой) под правило
    // не подходит, и это ровно та ошибка, ради которой правило написано: человек вставил
    // значение из дашборда, и оно уехало бы в git.
    expect(() => renderFamily('voice-roles', roles('21m00Tcm4TlvDq8ikWAM'))).toThrow();
    expect(() => renderFamily('voice-roles', roles('my_voice'))).toThrow();
  });

  it('`modelId` необязателен — роль наследует его из `project.yaml.voice`', () => {
    const value = {
      schema: 'voice-roles/1',
      roles: [{ roleId: 'quote', voice_id: 'ELEVENLABS_VOICE_ID', voice_settings: {} }],
    };
    const file = temp('voice-roles-no-model', renderFamily('voice-roles', value));
    expect(readFamily(file).value).toEqual(value);
  });

  it('`voice_settings` передаются как есть и не нормируются', () => {
    const value = {
      schema: 'voice-roles/1',
      roles: [
        {
          roleId: 'insert',
          voice_id: 'ELEVENLABS_VOICE_ID',
          // Поля, которых движок не знает: это `providerOpts` провайдера (ADR-0010 §8).
          voice_settings: { stability: 0.3, use_speaker_boost: true, style: 'lively' },
        },
      ],
    };
    const file = temp('voice-roles-opts', renderFamily('voice-roles', value));
    expect(readFamily(file).value).toEqual(value);
  });
});

// ── 6. `anchors/1`: JSONL ──────────────────────────────────────────────────────────────────

describe('S-02 — `anchors/1`: строка = запись, шапка первой строкой', () => {
  const entry = {
    id: 'w:7f2qab12cd34ef56',
    chapterId: 'main',
    sceneId: 'intro',
    ordinal: 0,
    surface: 'The',
    prev: null,
    next: 'morning',
    status: 'live',
    mintedAtRev: 1,
    origin: 'token',
  };

  it('пишется и читается кругом', () => {
    const text = renderFamily('anchors', [entry]);
    expect(text.split('\n')[0]).toBe('{"schema":"anchors/1"}');
    expect(text.split('\n')).toHaveLength(3); // шапка, запись, завершающий перевод строки
    const file = temp('anchors', text, '.jsonl');
    expect(readFamily(file).value).toEqual([entry]);
  });

  it('битая строка называет свой номер', () => {
    const file = temp('anchors-broken', '{"schema":"anchors/1"}\n{oops\n', '.jsonl');
    expect(() => readFamily(file)).toThrow(/строка 2 не разбирается как JSON/);
  });

  it('`w:` здесь ЗАКОНЕН — ledger и есть то пространство, ссылки на которое запрещены другим', () => {
    expect(() => renderFamily('anchors', [entry])).not.toThrow();
  });
});
