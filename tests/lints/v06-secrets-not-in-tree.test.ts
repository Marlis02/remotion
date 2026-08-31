// **Н1** — СЕКРЕТЫ НЕ ПОПАДАЮТ В ДЕРЕВО НИ В КАКОМ ВИДЕ (CLAUDE.md §2, Charter §6, `V-06`).
//
// ПОЧЕМУ ЭТОТ ОХРАННИК НУЖЕН ОТДЕЛЬНО ОТ **V9**. V9 стережёт ОДИН каталог
// (`packages/voice/src/**`) и спрашивает «читает ли код ключи». Здесь вопрос другой и шире:
// «нет ли секрета в ДЕРЕВЕ» — в любом отслеживаемом файле, включая `examples/`, `docs/`,
// take-файлы и отчёты. Ровно там он и появился бы: сырой ответ провайдера, скопированный в
// отчёт, id голоса, вписанный в `project.yaml` вместо имени переменной, ключ в примере команды.
//
// ТРИ ПОЛОВИНЫ, И КАЖДАЯ ЛОВИТ СВОЁ:
//   (а) ФОРМА КЛЮЧА — литерал `sk_…`. `FACT` (preflight `V-06`): ключи ElevenLabs начинаются
//       с `sk_` и показываются один раз, при создании либо ротации;
//   (б) ЗНАЧЕНИЯ ВЛАДЕЛЬЦА — если ключ и id голоса есть в окружении прогона, ни одна их копия
//       не имеет права лежать в отслеживаемом файле. Это единственная половина, которая ловит
//       НАСТОЯЩИЙ секрет, а не его форму, и она не требует записать его в тест: сравнение идёт
//       со значением из окружения, а в код не попадает ни символа;
//   (в) СЫРОЙ ОТВЕТ — поле `audio_base64` со значением. Ответ провайдера в дереве — это и
//       мегабайты, и утечка: рядом с аудио в том же JSON лежит всё остальное.
// Плюс ФОРМА ССЫЛКИ НА ГОЛОС: `voice.voiceId` любого `project.yaml` дерева обязан быть ИМЕНЕМ
// переменной окружения (`^[A-Z][A-Z0-9_]*$`, решение владельца `S-02`), а не значением. Так
// «20-символьный id ElevenLabs» ловится ПО СМЫСЛУ, а не по длине строки: id голоса не проходит
// форму имени переменной, а случайный хэш той же длины — не ложное срабатывание.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT } from '../boundaries/repo';

/** Ключ провайдера: `sk_` и дальше не меньше шестнадцати символов алфавита ключей. */
const API_KEY_LITERAL = /\bsk_[A-Za-z0-9_-]{16,}/;

/** Поле сырого ответа со значением. `"audio_base64":"…"` — именно с двоеточием и кавычкой. */
const RAW_AUDIO = /["']audio_base64["']\s*:\s*["'][A-Za-z0-9+/]{16,}/;

/** Имя переменной окружения (решение владельца `S-02`, валидатор `families/project.ts`). */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Этот файл описывает формы секретов и потому исключён из собственного скана. */
const SELF = 'tests/lints/v06-secrets-not-in-tree.test.ts';

/**
 * Файлы, которые МОГУТ уехать в коммит: отслеживаемые ПЛЮС новые, не покрытые `.gitignore`.
 *
 * Именно `--others --exclude-standard`, а не один индекс: секрет попадает в дерево НОВЫМ
 * файлом (сырой ответ, черновик отчёта, кусок лога), и охранник, ждущий `git add`, увидел бы
 * его на шаг позже, чем нужно. `.env` при этом не читается ни разу — он в `.gitignore`, и
 * `--exclude-standard` его отсеивает (CLAUDE.md §2: файл не открывать вовсе).
 */
function trackedFiles(root: string = ROOT): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((file) => file.length > 0);
}

/** Текст файла; бинарные и нечитаемые — пустой строкой (искать в них нечего). */
function readText(root: string, relPath: string): string {
  try {
    const buffer = fs.readFileSync(path.join(root, relPath));
    // NUL — признак бинарного файла: base64 и `sk_` в нём не текст, а совпадение байтов.
    if (buffer.includes(0)) return '';
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

interface Finding {
  readonly file: string;
  readonly what: string;
}

/** Секреты владельца из ОКРУЖЕНИЯ. В код не попадает ни одно значение — только сравнение. */
function ownerSecrets(): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const name of ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) {
    const value = process.env[name];
    // Короткие значения не ищем: подстрока в три символа нашлась бы в каждом втором файле.
    if (value !== undefined && value.length >= 12) out.push({ name, value });
  }
  return out;
}

export function scanTree(root: string = ROOT): Finding[] {
  const out: Finding[] = [];
  const secrets = ownerSecrets();
  for (const file of trackedFiles(root)) {
    if (file === SELF) continue;
    const text = readText(root, file);
    if (text.length === 0) continue;
    if (API_KEY_LITERAL.test(text)) out.push({ file, what: 'литерал ключа `sk_…`' });
    if (RAW_AUDIO.test(text)) out.push({ file, what: 'сырой ответ провайдера (`audio_base64`)' });
    for (const secret of secrets) {
      if (text.includes(secret.value)) out.push({ file, what: `ЗНАЧЕНИЕ \`${secret.name}\`` });
    }
    if (path.basename(file) === 'project.yaml') {
      const match = /^\s+voiceId:\s*"([^"]*)"/m.exec(text);
      const value = match?.[1];
      if (value !== undefined && !ENV_NAME.test(value)) {
        out.push({ file, what: `\`voice.voiceId\` = «${value}» — не имя переменной окружения` });
      }
    }
  }
  return out;
}

describe('**Н1** — ни ключа, ни id голоса, ни сырого ответа в отслеживаемых файлах', () => {
  it('охранник видит дерево, а не пустоту', () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('packages/voice/src/providers/elevenlabs.ts');
  });

  it('дерево чисто', () => {
    const found = scanTree();
    expect(
      found.map((f) => `${f.file} — ${f.what}`),
      'CLAUDE.md §2: секреты берутся только из окружения и в репозиторий не попадают ни в ' +
        'каком виде — ни ключ, ни id голоса, ни сырые ответы с `audio_base64`. Найдено: ' +
        found.map((f) => `${f.file} — ${f.what}`).join('; '),
    ).toEqual([]);
  });

  it('форма ссылки на голос: `voiceId` каждого проекта — ИМЯ переменной, а не значение', () => {
    const projects = trackedFiles().filter((file) => path.basename(file) === 'project.yaml');
    expect(projects.length, 'проектов в дереве обязано быть хотя бы два').toBeGreaterThan(1);
    for (const project of projects) {
      const match = /^\s+voiceId:\s*"([^"]*)"/m.exec(readText(ROOT, project));
      expect(match?.[1], `${project}: поле не найдено`).toBeDefined();
      expect(ENV_NAME.test(match?.[1] ?? ''), `${project}: ожидалось имя переменной`).toBe(true);
    }
  });

  it('КРАСНЕЕТ на подделке — проверено на копии, дерево не тронуто', () => {
    const sandbox = fs.mkdtempSync(path.join(ROOT, '..', 'vpe-secrets-'));
    try {
      // Копия — это git-репозиторий с тремя файлами-нарушителями: скан ходит по `git ls-files`,
      // и без индекса он не увидел бы ничего, оставаясь зелёным по недоразумению.
      fs.writeFileSync(path.join(sandbox, 'leak.md'), 'ключ: sk_0123456789abcdef0123456789\n', 'utf8');
      fs.writeFileSync(
        path.join(sandbox, 'take.json'),
        '{"audio_base64":"AAAABBBBCCCCDDDDEEEE","alignment":null}\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(sandbox, 'project.yaml'),
        'voice:\n  voiceId: "abcdef0123456789xyzw"\n',
        'utf8',
      );
      execFileSync('git', ['init', '-q'], { cwd: sandbox });
      execFileSync('git', ['add', '-A'], { cwd: sandbox });

      const found = scanTree(sandbox);
      const what = found.map((f) => `${f.file} — ${f.what}`).join('; ');
      expect(what).toContain('sk_');
      expect(what).toContain('audio_base64');
      expect(what).toContain('не имя переменной окружения');
      // И тот же сканер на НЕТРОНУТОМ дереве по-прежнему молчит.
      expect(scanTree()).toEqual([]);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
