// **K6**, ВТОРАЯ ПОЛОВИНА: измеренное окружение живёт ТОЛЬКО в `engineFingerprint`.
//
// Первая половина правила — «в схемах профилей нет полей версий/хэшей/checksum» — стоит
// с `R-02` (`packages/schema/test/render-profile.test.ts`, обход ключей zod + allowlist из
// одного имени). Вторая половина требовала самого отпечатка и потому ждала `H-03`:
// доказать «живёт ТОЛЬКО здесь» можно, лишь показав, что «здесь» ничего не берёт ОТТУДА.
//
// ЧТО ИМЕННО СТЕРЕЖЁТСЯ, И ПОЧЕМУ ИМЕННО ЭТИМ СПОСОБОМ. Правило M9 — «профиль = намерение
// человека, `engineFingerprint` = измерение машины». Механически это значит ровно одно:
// **сборщик пробы не имеет доступа к профилям**. Проверяется двумя разными способами, потому
// что каждый по отдельности обходится:
//   1. ГРЕП по `fingerprint.ts` — ни одного `.yaml`, ни одного чтения профиля, ни одного
//      импорта из `@vpe/schema` (семейства профилей живут там).
//   2. ТИП входа — `EngineProbeInput` не несёт ни одного поля профиля. Греп по именам полей
//      профилей в сигнатуре: `pixelProfile`, `compileProfile`, `executionProfile`,
//      `audioProfile` и поимённо `encoder` (решение владельца `H-03`, вопрос 4: строка
//      энкодера в отпечаток НЕ входит — она функция полей, уже перечисленных в
//      `media/src/cache/views/segment.json`, и второй учёт запрещён ADR-0006 §3).
//
// ГРЕП СЛАБЕЕ ТИПОВ, И ЭТО СКАЗАНО ВСЛУХ: он не знает области видимости и поймает имя в
// строке. Поэтому комментарии из проверки исключены (`codeLines`) — иначе правило наказывало
// бы за объяснение самого правила, а объяснение здесь длиннее кода.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines } from '../boundaries/repo';

const FINGERPRINT = 'packages/renderer-hyperframes/src/fingerprint.ts';

/** Формы, которых в сборщике пробы быть не может. */
const FORBIDDEN: readonly { readonly re: RegExp; readonly what: string }[] = [
  { re: /['"`][^'"`]*\.ya?ml['"`]/u, what: 'литерал пути к yaml' },
  { re: /\byaml\b/u, what: 'разбор yaml' },
  { re: /from\s+['"]@vpe\/schema['"]/u, what: 'импорт семейств профилей' },
  { re: /\bpixelProfile\b/u, what: 'поле профиля `pixelProfile`' },
  { re: /\bcompileProfile\b/u, what: 'поле профиля `compileProfile`' },
  { re: /\bexecutionProfile\b/u, what: 'поле профиля `executionProfile`' },
  { re: /\baudioProfile\b/u, what: 'поле профиля `audioProfile`' },
  { re: /\bsegmentEncodeArgs\b/u, what: 'строка энкодера (функция профиля)' },
  { re: /\bRenderProfile\b/u, what: 'тип профиля рендера' },
];

/** Имена, которые обязаны быть — иначе греп стережёт не тот файл. */
const REQUIRED = ['collectEngineProbe', 'computeEngineFingerprint', 'assertEngineMatches'];

describe('K6 (вторая половина) — отпечаток не читает профилей', () => {
  const abs = path.join(ROOT, FINGERPRINT);
  const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const code = codeLines(source);

  it('файл отпечатка НАЙДЕН и это он: охранник не стережёт пустое место', () => {
    expect(source, `${FINGERPRINT} не существует`).not.toBe('');
    for (const name of REQUIRED) expect(source).toContain(name);
    expect(code.length).toBeGreaterThan(50);
  });

  it('ни одной запрещённой формы в КОДЕ сборщика пробы', () => {
    const offenders: string[] = [];
    code.forEach((line, i) => {
      for (const { re, what } of FORBIDDEN) {
        if (re.test(line)) offenders.push(`${FINGERPRINT}:${String(i + 1)} → ${what}`);
      }
    });
    expect(
      offenders,
      'M9 (ADR-0006 §3): отпечаток есть ИЗМЕРЕНИЕ машины, а не намерение человека. Ни одно ' +
        'его поле не имеет права прийти из профиля — иначе одна величина учитывается дважды ' +
        `(она уже в cacheKeyView) и K6 перестаёт быть проверяемым. Найдено: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('ОХРАННИК СРАБАТЫВАЕТ: те же регулярки краснеют на подставном нарушении', () => {
    const planted = [
      "const p = readFileSync('profiles/render.final.yaml', 'utf8');",
      "import type { RenderProfile } from '@vpe/schema';",
      'fields.encoder = segmentEncodeArgs({ pixelProfile }).join(" ");',
      'const w = input.executionProfile.workers;',
      'const c = input.compileProfile.fps;',
      'const a = input.audioProfile.targetLufs;',
    ];
    for (const line of planted) {
      expect(
        FORBIDDEN.some(({ re }) => re.test(line)),
        `подставное нарушение не поймано: ${line}`,
      ).toBe(true);
    }
  });

  it('комментарии НЕ считаются нарушением: греп идёт по коду', () => {
    // Шапка `fingerprint.ts` объясняет, почему строка энкодера в отпечаток не входит, и
    // называет `segmentEncodeArgs` с `pixelProfile` поимённо. Если бы комментарии считались,
    // правило краснело бы ровно на своём собственном обосновании.
    expect(source).toContain('segmentEncodeArgs');
    expect(source).toContain('pixelProfile');
    expect(code.join('\n')).not.toContain('segmentEncodeArgs');
    expect(code.join('\n')).not.toContain('pixelProfile');
  });

  it('вход сборщика — ПУТИ И ОКРУЖЕНИЕ: перечень полей `EngineProbeInput` закрыт', () => {
    // Утверждение по СОСТАВУ, а не по отсутствию: новое поле входа обязано быть увидено
    // человеком. Профиль, приехавший одиннадцатым полем, иначе проехал бы молча.
    const block = /export interface EngineProbeInput \{([\s\S]*?)\n\}/u.exec(source)?.[1] ?? '';
    expect(block).not.toBe('');
    const fields = codeLines(block)
      .map((l) => /^\s*readonly\s+([A-Za-z0-9_]+)\??:/u.exec(l)?.[1])
      .filter((n): n is string => n !== undefined)
      .sort();
    expect(fields).toEqual([
      'browserPath',
      'cliPath',
      'ffmpegPath',
      'ffprobePath',
      'packageDir',
      'parentEnv',
      'resolveOnPath',
      'timeoutMs',
    ]);
  });
});

describe('K6 — измеренные величины НЕ дублируются в профилях фикстуры', () => {
  it('ни один профиль фикстуры не несёт поля, которое меряет отпечаток', () => {
    // Дополнение к именному тесту `R-02` (он ходит по ключам zod): здесь — по ЗНАЧЕНИЯМ
    // конкретных файлов, то есть ловится и поле, добавленное в yaml мимо схемы.
    const dir = path.join(ROOT, 'fixtures/minimal/profiles');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
    expect(files.length).toBeGreaterThan(0);
    const measured = [
      /^\s*chrome[A-Za-z]*\s*:/u,
      /^\s*ffmpeg[A-Za-z]*\s*:/u,
      /^\s*hostClass\s*:/u,
      /^\s*engineFingerprint\s*:/u,
      /^\s*gsapVersion\s*:/u,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('#')) return;
        if (measured.some((re) => re.test(line))) offenders.push(`${file}:${String(i + 1)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
