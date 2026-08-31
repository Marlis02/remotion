// **V9** — «Все фикстуры репозитория используют `tts:mock@1`»; охранник реестра: «в тестовом
// контуре нет сетевых вызовов и ключей API» (ADR-0010 §7, core.md §18.3 п. 14).
//
// ОХРАННИК ИЗ ДВУХ ПОЛОВИН, И ОБЕ НАЗВАНЫ ВСЛУХ:
//   (а) ВОЗМОЖНОСТЬ — `packages/voice/src/**` не содержит ни сетевого импорта, ни сетевой
//       глобали, ни чтения секретов. Реестр разрешённых файлов **ПУСТ**, и `V-06` (живой
//       ElevenLabs) его НЕ ПОПОЛНИЛА — см. отдельное утверждение ниже: сеть и ключ приезжают
//       живому провайдеру ВХОДАМИ (`HttpTransport`, `apiKey`), а настоящий `fetch` живёт в
//       границе процесса (`packages/cli/bin/http.ts`), рядом с часами и случайностью. Живой
//       прогон при этом делается ВНЕ `fixtures/` (roadmap §3, решение владельца 8);
//   (б) ФИКСТУРЫ — обход каталога `fixtures/`: у каждого `project.yaml` поле
//       `voice.providerId` равно `tts:mock@1`. Именно ОБХОД, а не список: вторая фикстура
//       (`fixtures/reference`, задача `F-02`) попадёт под правило в день появления, а не по
//       памяти того, кто будет её писать.
//
// ЧЕМ ЭТОТ ОХРАННИК НЕ ЯВЛЯЕТСЯ И ПОЧЕМУ ОН НЕ ДУБЛИРУЕТ M4. `tests/boundaries/
// m4-network-only-voice.test.ts` проверяет ПРОТИВОПОЛОЖНОЕ утверждение: сеть разрешена
// в `voice` и запрещена во всех остальных пакетах (ADR-0009 тест 7), и его контрольный
// случай специально показывает, что ESLint пропускает `fetch` внутри `voice`. V9 — правило
// другого уровня и другого срока: в **v1-контуре** сети нет и в `voice`, потому что
// провайдер в нём один и он герметичен. Поэтому здесь греп, а не ESLint: конфиг обязан
// продолжать разрешать сеть в `voice`, иначе `V-06` не напишется вовсе.
//
// ВЗАИМОДЕЙСТВИЕ С M4, названное явно: тот тест СОЗДАЁТ временный файл-нарушитель внутри
// `packages/voice/src/`. Изоляция держится на `fileParallelism: false` в `vitest.config.ts` —
// она уже несущая для M3/M4/M5 (комментарий в самом конфиге), и снятие её сломает не только
// этот охранник.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, codeLines, moduleSpecifiers, readSource, sourceFiles } from '../boundaries/repo';

/**
 * Файлы `packages/voice/src/**`, которым сеть и ключи разрешены. **ПУСТ.**
 *
 * `V-06` пришла по этому адресу и НЕ ВОСПОЛЬЗОВАЛАСЬ им — это сильнее ожидаемого, а не слабее.
 * Живой провайдер получает сеть функцией, а ключ значением, поэтому «в контуре нет сетевых
 * вызовов и ключей» держится не перечнем исключений, а тем, что звать нечем. Цена названа
 * честно: возможность сходить в сеть у живого провайдера есть — она приезжает параметром, и
 * охраняет её тот, кто параметр подаёт (`ELEVENLABS_LIVE=1` плюс `--allow-tts`).
 */
const ALLOWED: readonly string[] = [];

/** Живой провайдер `V-06`: он обязан быть в контуре и обязан оставаться герметичным по форме. */
const LIVE_PROVIDER = 'packages/voice/src/providers/elevenlabs.ts';

/** Провайдер, которым обязаны пользоваться все фикстуры (ADR-0010 §7). */
const MOCK_PROVIDER_ID = 'tts:mock@1';

const NETWORK_SPECIFIER =
  /^(node:)?(http|https|http2|net|tls|dgram)$|^(undici|ws|node-fetch|axios|got|superagent)(\/.*)?$/;

/** Сетевые глобали: импортом они не видны (ADR-0009 тест 7). */
const NETWORK_GLOBAL = /(^|[^.\w$])(fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/;

/** Ключи API: чтение окружения и имена секретов. CLAUDE.md §2 — значения только из `process.env`. */
const SECRET_READ = /process\s*\.\s*env|['"`][A-Z][A-Z0-9_]*(?:API_KEY|_KEY|TOKEN|SECRET)['"`]/;

interface Finding {
  readonly file: string;
  readonly what: string;
}

function scan(): Finding[] {
  const out: Finding[] = [];
  for (const file of sourceFiles('voice')) {
    if (ALLOWED.includes(file)) continue;
    const source = readSource(file);
    for (const spec of moduleSpecifiers(source)) {
      if (NETWORK_SPECIFIER.test(spec)) out.push({ file, what: `импорт "${spec}"` });
    }
    const code = codeLines(source).join('\n');
    if (NETWORK_GLOBAL.test(code)) out.push({ file, what: 'сетевая глобаль' });
    if (SECRET_READ.test(code)) out.push({ file, what: 'чтение ключа/окружения' });
  }
  return out;
}

/**
 * `fixtures/<name>/project.yaml` — путями от корня сканирования. Обход, а не список.
 *
 * КОРЕНЬ — ПАРАМЕТР, и это не обобщение впрок: `fixtures/` не изменяется в этой сессии ни
 * символом, поэтому «охранник краснеет на нарушении» проверяется на КОПИИ во временном
 * каталоге. Тот же приём и по той же причине — у охранника **V13** (`C-03`,
 * `tests/fixtures/content-language.ts`).
 */
export function fixtureProjects(root: string = ROOT): string[] {
  const base = path.join(root, 'fixtures');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name === 'project.yaml') out.push(path.relative(root, abs));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out;
}

/** `voice.providerId` из `project.yaml`. Полного YAML-парсера нет намеренно — см. `C-03`. */
export function voiceProviderIdOf(relPath: string, root: string = ROOT): string | null {
  const m = /^\s+providerId:\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, relPath), 'utf8'));
  return m?.[1] ?? null;
}

/** Фикстуры, у которых провайдер не `tts:mock@1`. Пусто — правило выполнено. */
function fixtureOffenders(root: string = ROOT): string[] {
  const out: string[] = [];
  for (const project of fixtureProjects(root)) {
    const id = voiceProviderIdOf(project, root);
    if (id !== MOCK_PROVIDER_ID) out.push(`${project} → ${id ?? '(поле не найдено)'}`);
  }
  return out;
}

describe('**V9** (а) — в `packages/voice/src/**` нет ни сети, ни ключей', () => {
  it('охранник стережёт непустое множество файлов', () => {
    const files = sourceFiles('voice');
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('packages/voice/src/providers/mock.ts');
  });

  it('реестр разрешённых файлов ПУСТ — и это утверждение, а не умолчание', () => {
    expect(
      ALLOWED,
      'Реестр заведён с адресом пополнения `V-06`; `V-06` его не пополнила: сеть приезжает ' +
        'живому провайдеру входом (`HttpTransport`), а `fetch` живёт в `packages/cli/bin/http.ts`. ' +
        'Непустой реестр означает, что сетевой путь появился ВНУТРИ пакета — и тогда правило ' +
        'держится перечнем исключений, а не формой.',
    ).toEqual([]);
  });

  it('живой провайдер `V-06` есть в контуре и герметичен ПО ФОРМЕ, а не по обещанию', () => {
    const files = sourceFiles('voice');
    expect(files, 'провайдер `V-06` обязан лежать в пакете, а не вне его').toContain(LIVE_PROVIDER);
    const code = codeLines(readSource(LIVE_PROVIDER)).join('\n');
    // Ни сетевой глобали, ни чтения окружения: и то, и другое — входы.
    expect(NETWORK_GLOBAL.test(code), 'живой провайдер не зовёт сеть сам').toBe(false);
    expect(SECRET_READ.test(code), 'живой провайдер не читает окружения и не пишет имён ключей').toBe(false);
    // И он честно объявляет, что сеть ему НУЖНА: иначе сборка не спросила бы про флаг.
    expect(code).toContain('requiresNetwork: true');
  });

  it('ни один файл не импортирует сеть, не зовёт её глобалью и не читает ключей', () => {
    const found = scan();
    expect(
      found.map((f) => `${f.file} — ${f.what}`),
      'V9 (ADR-0010 §7): весь тестовый контур гоняется без ключа API, без денег и без сети. ' +
        'Найдено: ' + found.map((f) => `${f.file} — ${f.what}`).join('; '),
    ).toEqual([]);
  });

  it('охранник НЕ пуст: каждая его форма ловит своё на зонде', () => {
    // Без этой проверки предыдущая осталась бы зелёной и при сломанных регулярках.
    expect(NETWORK_SPECIFIER.test('node:https')).toBe(true);
    expect(NETWORK_SPECIFIER.test('undici')).toBe(true);
    expect(NETWORK_SPECIFIER.test('@vpe/media')).toBe(false);
    expect(NETWORK_GLOBAL.test('const r = await fetch(url);')).toBe(true);
    expect(NETWORK_GLOBAL.test('const r = new WebSocket(url);')).toBe(true);
    // `.fetch(` — метод объекта, а не глобаль: правило не должно краснеть на чужом API.
    expect(NETWORK_GLOBAL.test('const r = client.fetch(url);')).toBe(false);
    expect(SECRET_READ.test('const k = process.env.ELEVENLABS_API_KEY;')).toBe(true);
    expect(SECRET_READ.test("const name = 'ELEVENLABS_API_KEY';")).toBe(true);
    expect(SECRET_READ.test("const id = 'VPE_MOCK_VOICE_ID';")).toBe(false);
  });

  it('провайдер v1 объявляет себя герметичным — правило и capability согласованы', () => {
    // Греп по коду, а не импорт пакета: тесты границ читают файлы (правило `tests/boundaries`).
    const source = codeLines(readSource('packages/voice/src/providers/mock.ts')).join('\n');
    expect(source).toContain('requiresNetwork: false');
  });
});

describe('**V9** (б) — все фикстуры репозитория используют `tts:mock@1`', () => {
  it('обход каталога находит хотя бы одну фикстуру', () => {
    const projects = fixtureProjects();
    expect(
      projects.length,
      'Правило звучит «ВСЕ фикстуры репозитория»; охранник, не нашедший ни одной, ' +
        'проверяет пустоту и зелен по недоразумению.',
    ).toBeGreaterThan(0);
  });

  it('у каждой найденной фикстуры `voice.providerId` — mock', () => {
    const offenders = fixtureOffenders();
    expect(
      offenders,
      'V9 (ADR-0010 §7): фикстуры гоняются только на `tts:mock@1` — без ключа, без денег и ' +
        'без сети. Живой дубль в фикстуре нарушил бы V9 первым же файлом (roadmap §3, ' +
        'решение владельца 8). Найдено: ' + offenders.join('; '),
    ).toEqual([]);
  });

  it('извлечение поля работает: охранник читает НАСТОЯЩЕЕ значение', () => {
    const projects = fixtureProjects();
    const first = projects[0] ?? '';
    expect(voiceProviderIdOf(first)).toBe(MOCK_PROVIDER_ID);
  });

  it('охранник КРАСНЕЕТ на живом провайдере — проверено на копии, `fixtures/` не тронут', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vpe-v9-'));
    try {
      const project = fixtureProjects()[0] ?? '';
      const target = path.join(sandbox, project);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        readSource(project).replace(`providerId: "${MOCK_PROVIDER_ID}"`, 'providerId: "tts:elevenlabs@1"'),
        'utf8',
      );
      const found = fixtureOffenders(sandbox);
      expect(found, 'подменённый провайдер обязан быть найден').toHaveLength(1);
      expect(found[0]).toContain('tts:elevenlabs@1');
      // И тот же сканер на НЕТРОНУТОМ дереве по-прежнему молчит.
      expect(fixtureOffenders()).toEqual([]);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
