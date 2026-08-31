// ADR-0010 §8 — ветвление по CAPABILITIES, а не по имени провайдера (`V-01`).
//
// Правило архитектуры: `providerId` законен в ключе кэша (ADR-0006 §2) и в provenance дубля,
// но НЕ в условии. Причина названа в ADR-0010 §7: интерфейс провайдера пишется затем, чтобы
// он не был «ElevenLabs с другими именами полей», а `tts:mock@1` существует как принудительная
// проверка этого; первое же `if (providerId === ...)` превращает обоих в частные случаи.
//
// Охранник двойной, и половины ловят разное:
//   (а) ESLint (`CAPABILITY_SYNTAX` в `eslint.config.js`) — ФОРМА сравнения. Селектор видит
//       синтаксис, поэтому не краснеет на строке ADR, процитированной в JSDoc, и краснеет на
//       `switch`, который греп от обычного слова не отличит;
//   (б) греп по коду — ЛИТЕРАЛ имени провайдера. Он ловит то, чего селектор не видит:
//       `providerOf('tts:mock@1')`, таблицу «имя → поведение», строку в конфиге.
//
// РЕЕСТР ФАЙЛОВ, КОТОРЫМ ЛИТЕРАЛ РАЗРЕШЁН, — те, что ОБЪЯВЛЯЮТ свой id, и только они.
// Пополнен задачей `V-06`: реализаций стало две, и каждая называет себя сама. У половины (а)
// исключений нет и не нужно: объявление id — это свойство объекта, а не условие.
//
// ЧЕГО В РЕЕСТРЕ НЕТ И ПОЧЕМУ ЭТО ГЛАВНОЕ В ПОПОЛНЕНИИ (`V-06`, долг №197). В нём нет
// `providers/registry.ts` — файла, который выбирает реализацию по `project.yaml →
// voice.providerId`. Выбор написан так, что литерал имени ему не нужен вовсе: карта строится
// ИЗ САМИХ РЕАЛИЗАЦИЙ, по их собственному `capabilities.providerId`, а поиск — `Map.get`, а не
// `if`. То есть «реестр реализаций» и «таблица имя → поведение», которую запрещает §8, — это
// разные вещи, и разница здесь наблюдаема: закрытие долга №197 не потребовало ни одного нового
// исключения из правила.
import { describe, expect, it } from 'vitest';

import { PACKAGES, codeLines, errorsFor, lintTemporary, readSource, sourceFiles } from '../boundaries/repo';

const RULE = 'no-restricted-syntax';
const EXPECT = 'ADR-0010 §8';

/** Файлы, которым разрешено писать имя провайдера литералом: каждый объявляет СВОЙ id. */
const REGISTRY = [
  'packages/voice/src/providers/mock.ts',
  // `V-06`: живой провайдер. Литерал у него ровно один — в собственных `capabilities`.
  'packages/voice/src/providers/elevenlabs.ts',
];

/** Сосед по каталогу: он обязан остаться ПОД правилом, иначе реестр не узкий. */
const NEIGHBOUR = 'packages/voice/src/providers/types.ts';

/** Литерал имени провайдера в любых кавычках — включая шаблонные строки сообщений. */
const PROVIDER_LITERAL = /tts:/;

function offenders(): string[] {
  const out: string[] = [];
  for (const pkg of PACKAGES) {
    for (const file of sourceFiles(pkg)) {
      if (REGISTRY.includes(file)) continue;
      for (const [index, line] of codeLines(readSource(file)).entries()) {
        if (PROVIDER_LITERAL.test(line)) out.push(`${file}:${String(index + 1)} — ${line.trim()}`);
      }
    }
  }
  return out;
}

describe('(а) ESLint — сравнение по имени провайдера роняет линт', () => {
  it('`p.providerId === "tts:mock@1"` в `voice` — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__caps_probe_member__.ts',
        source: 'export const a = (p: { providerId: string }): boolean => p.providerId === "tts:mock@1";\n',
      },
    ]);
    const errors = errorsFor(messages, RULE);
    expect(
      errors.length,
      'Охранник ADR-0010 §8 молчит на прямом нарушении. Вероятные причины: селектор ' +
        'выпал из `syntax()` в eslint.config.js, либо регулярка оператора оборвалась на ' +
        '`]` (esquery разбирает атрибут до первой закрывающей скобки).',
    ).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain(EXPECT);
  });

  it('голый идентификатор `providerId` с любой стороны сравнения — ошибка', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__caps_probe_ident__.ts',
        source: 'export const b = (providerId: string): boolean => "tts:mock@1" !== providerId;\n',
      },
    ]);
    expect(errorsFor(messages, RULE).length, 'сторона сравнения не должна спасать').toBeGreaterThan(0);
  });

  it('`switch` по имени провайдера — ошибка (грепом эта форма не ловится)', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__caps_probe_switch__.ts',
        source:
          'export function c(p: { providerId: string }): number {\n' +
          '  switch (p.providerId) {\n' +
          '    case "tts:mock@1": return 1;\n' +
          '    default: return 0;\n' +
          '  }\n' +
          '}\n',
      },
    ]);
    expect(errorsFor(messages, RULE).length).toBeGreaterThan(0);
  });

  it('правило действует ВО ВСЕХ пакетах, а не только в `voice`', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/compile/src/__caps_probe_scope__.ts',
        source: 'export const d = (p: { providerId: string }): boolean => p.providerId === "tts:elevenlabs@1";\n',
      },
    ]);
    expect(
      errorsFor(messages, RULE).length,
      'Ветвление по имени провайдера в компиляторе — тот же дефект, что и в `voice`.',
    ).toBeGreaterThan(0);
  });

  it('ветвление ПО ВОЗМОЖНОСТИ законно — правило запрещает не условия вообще', async () => {
    const messages = await lintTemporary([
      {
        relPath: 'packages/voice/src/__caps_control__.ts',
        source:
          'export const needsAligner = (c: { timestampUnit: string }): boolean => c.timestampUnit === "none";\n' +
          'export const caps = { providerId: "tts:mock@1", timestampUnit: "character" };\n',
      },
    ]);
    expect(
      errorsFor(messages, RULE),
      'Объявление собственного id и сравнение capability — законные формы; охранник, ' +
        'краснеющий на них, запретил бы саму реализацию правила.',
    ).toEqual([]);
  });
});

describe('(б) греп — литерал имени провайдера только в реестре', () => {
  it('выбор реализации по имени проекта НЕ потребовал исключения (долг №197, `V-06`)', () => {
    // Утверждение сильное и потому проверяется в лоб: файл, который разрешает
    // `providerId` в реализацию, живёт ПОД правилом, а не рядом с ним.
    const chooser = 'packages/voice/src/providers/registry.ts';
    expect(sourceFiles('voice')).toContain(chooser);
    expect(REGISTRY).not.toContain(chooser);
    expect(codeLines(readSource(chooser)).some((line) => PROVIDER_LITERAL.test(line))).toBe(false);
  });

  it('охранник стережёт непустое множество файлов, и реестр в него входит', () => {
    const files = PACKAGES.flatMap((pkg) => sourceFiles(pkg));
    expect(files.length).toBeGreaterThan(0);
    for (const file of REGISTRY) expect(files).toContain(file);
    expect(files).toContain(NEIGHBOUR);
  });

  it('ни один файл вне реестра не пишет имя провайдера литералом', () => {
    expect(
      offenders(),
      'ADR-0010 §8: имя провайдера в коде вне файла, который его объявляет, — это либо ' +
        'ветвление по имени, либо таблица «имя → поведение». Спрашивайте у capabilities. ' +
        'Реестр пополняется задачей `V-06`. Найдено: ' + offenders().join('; '),
    ).toEqual([]);
  });

  it('реестр НЕ мёртвый: файл-исключение обязан содержать литерал', () => {
    // Иначе предыдущая проверка начнёт охранять пустоту, оставаясь зелёной.
    for (const file of REGISTRY) {
      const hit = codeLines(readSource(file)).some((line) => PROVIDER_LITERAL.test(line));
      expect(hit, `${file}: литерал имени провайдера пропал — реестр охраняет пустоту`).toBe(true);
    }
  });

  it('реестр УЗКИЙ: сосед по каталогу остаётся под правилом', () => {
    const hit = codeLines(readSource(NEIGHBOUR)).some((line) => PROVIDER_LITERAL.test(line));
    expect(hit).toBe(false);
  });
});
