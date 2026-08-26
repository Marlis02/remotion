// Чтение с диска — ОТДЕЛЬНО ОТ `compose` (поправка владельца П4, 2026-08-26).
//
// ПОЧЕМУ ОТДЕЛЬНО. `compose` — то, чем доказывается «перестановка файлов в каталоге не меняет
// Timeline». Функция, которая сама обходит каталог, доказывала бы это про свой собственный
// обход, а не про укладку: подмени обход — и охранник зазеленел бы на любой укладке. Поэтому
// диск живёт здесь, а `compose` получает значения; охранник границы — греп «в `compose.ts` нет
// `node:fs`» (протокол нарушений `CP-01`).
//
// `readdir` СОРТИРУЕТСЯ ЯВНО (ADR-0007 §4: «`fs.readdir` всегда сортируется явным байтовым
// компаратором»). Прецедент реализации — `recordFilesIn` (`media/src/assets/load.ts`, `M-02`):
// сортировка не для красоты, а потому что порядок файловой системы попадал бы в порядок
// проблем в тексте ошибки, то есть в отчёт сборки.
//
// ОТСУТСТВУЮЩИЙ TAKE ЗДЕСЬ НЕ ОШИБКА, И ЭТО НАМЕРЕННО: список недостающих `chunkKey` печатает
// `compose` — он один знает план целиком. Читатель, падающий на первом отсутствующем файле,
// заставлял бы генерировать дубли по одному.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { DirectionSource } from '@vpe/core-model';
import { TAKES_DIR, parseTakeFile, takeFilePath, type SpeechPlan, type Take } from '@vpe/voice';

/**
 * Файлы режиссуры каталога `direction/` — прочитанные, в каноническом порядке имён.
 *
 * Расширение `.yaml` — раскладка ADR-0005 §1. Отсутствующий каталог — ошибка чтения, а не
 * «ноль записей»: путь пришёл входом, и молчаливый пустой ответ превратил бы опечатку в проект
 * без режиссуры, который соберётся и опубликуется (тот же довод, что у `M-02`).
 */
export function readDirectionSources(directionDir: string): DirectionSource[] {
  const names = [...readdirSync(directionDir)].filter((name) => name.endsWith('.yaml')).sort();
  return names.map((name) => ({
    filePath: `direction/${name}`,
    text: readFileSync(path.join(directionDir, name), 'utf8'),
  }));
}

/**
 * Дубли плана, прочитанные СТРОГИМ читателем (`parseTakeFile`, `V-05`/`CP-01`).
 *
 * `readdir` здесь не нужен вовсе: имя take-файла — это `chunkKey` (ADR-0005 §1), то есть
 * множество читаемых файлов задано планом, а не содержимым каталога. Лишний файл в
 * `voice/takes/` компиляцию не касается — он либо дубль прошлой ревизии текста, либо
 * материал межсборочного кэша (`M-05`).
 *
 * @param projectRoot корень дерева проекта: `voice/takes/` лежит внутри него.
 */
export function readTakes(projectRoot: string, plan: SpeechPlan): Map<string, Take> {
  const out = new Map<string, Take>();
  for (const chunk of plan.chunks) {
    const relative = takeFilePath(chunk.chunkKey);
    let text: string;
    try {
      text = readFileSync(path.join(projectRoot, relative), 'utf8');
    } catch {
      // Недостающие дубли перечисляет `compose` — он один видит план целиком.
      continue;
    }
    out.set(chunk.chunkKey, parseTakeFile(text, relative));
  }
  return out;
}

/** Каталог дублей внутри дерева проекта — имя из `@vpe/voice`, второй копии пути нет. */
export { TAKES_DIR };
