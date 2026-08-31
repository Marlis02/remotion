// ЗАГРУЗЧИК `.env` — ГРАНИЦА ПРОЦЕССА, а не удобство (`V-06`).
//
// ПОЧЕМУ ОН ЗДЕСЬ, А НЕ В `src/`. Читать файл с секретами имеет право только тот, кто и так
// читает окружение процесса, — то есть точка входа. Внутри `packages/*/src/**` секретов нет
// ни строкой (CLAUDE.md §2, охранник **V9** `tests/lints/v9-no-network-in-voice.test.ts`), и
// `.env` там не появляется тем же приёмом, каким там не появляются часы: чтение живёт в
// `bin/`, а внутрь приезжает ЗНАЧЕНИЕМ (`CliDeps.env`).
//
// ПОЧЕМУ СВОЙ РАЗБОР, А НЕ `dotenv`. Новых зависимостей задача не берёт; формат, который нам
// нужен, — `KEY=value` построчно, и он разбирается пятнадцатью строками. Всё, чего в списке
// ниже нет, `.env` для нас не содержит: ни подстановки `${VAR}`, ни многострочных значений,
// ни `export`.
//
// ПРИОРИТЕТ — У ОКРУЖЕНИЯ, А НЕ У ФАЙЛА, и это не вкус: `ELEVENLABS_LIVE=1 vpe build …`
// обязано означать ровно то, что написано в командной строке, иначе забытая строка в файле
// заплатила бы деньги вопреки явному запрету прогона. Файл — умолчание, командная строка —
// решение.
//
// ЗНАЧЕНИЯ ЭТОТ ФАЙЛ НЕ ПЕЧАТАЕТ НИКОГДА. Он не логирует, не возвращает исходный текст и не
// кладёт разобранное никуда, кроме возвращаемого окружения; отсутствующий файл — не ошибка.

import { readFileSync } from 'node:fs';

/**
 * Имена, которые файл `.env` НЕ ДАЁТ, даже если они в нём написаны (решение владельца
 * 2026-08-31, вопрос 2 плана `V-06`).
 *
 * ЭТО НЕ ПЕРЕЧЕНЬ СЕКРЕТОВ, А ПЕРЕЧЕНЬ РАЗРЕШЕНИЙ. `ELEVENLABS_LIVE=1` означает «потрать
 * деньги», и такое разрешение обязано быть НАПИСАНО РУКОЙ в командной строке: строка,
 * забытая в файле, включала бы живые вызовы на каждом прогоне тестов и на каждой сборке.
 * Секреты файл давать может — они ничего не тратят сами по себе.
 */
export const IGNORED_FROM_FILE: readonly string[] = ['ELEVENLABS_LIVE'];

/** Строка вида `KEY=value`; ведущий `export` допускается, потому что его пишут по привычке. */
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** Кавычки снимаются ровно парные: `KEY="a b"` → `a b`, `KEY='a b'` → `a b`. */
function unquote(raw: string): string {
  const first = raw.slice(0, 1);
  const last = raw.slice(-1);
  if (raw.length >= 2 && (first === '"' || first === "'") && first === last) return raw.slice(1, -1);
  return raw;
}

/**
 * Имена переменных, объявленные файлом. ТОЛЬКО ИМЕНА — значений эта функция не отдаёт вовсе.
 *
 * Существует ради preflight'а и отчёта: «ключ виден процессу — ДА/НЕТ» обязано быть
 * проверяемо, а печать значения запрещена (CLAUDE.md §2).
 */
export function envFileNames(text: string): readonly string[] {
  const names: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = LINE.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/** Разбор текста `.env`. Комментарии и пустые строки пропускаются молча. */
export function parseEnvFile(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = LINE.exec(line);
    const key = match?.[1];
    if (key === undefined) continue;
    out[key] = unquote(match?.[2] ?? '');
  }
  return out;
}

/**
 * Окружение процесса, дополненное файлом `.env`, если он есть.
 *
 * Уже заданные переменные НЕ перезаписываются (см. шапку). Файла нет или он не читается —
 * возвращается `base` как есть: `.env` не обязателен, а его отсутствие не отказ.
 */
export function envWithFile(file: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return base;
  }
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (IGNORED_FROM_FILE.includes(key)) continue;
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}
