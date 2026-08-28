// **`vpe template list`** — просмотр каталога: «шаблон · версия · гейт · бюджет мс/кадр ·
// класс детерминизма · easing» (roadmap §4 `E-00`, «Выход», п. 4).
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ПОДКОМАНДА, А НЕ ПЕЧАТЬ ГЕЙТОМ (решение владельца `E-00`, развилка 4).
// Таблица отвечает на вопрос «что вообще есть в библиотеке и что из этого снято», и задают его
// чаще, чем снимают гейт. Гейт стоит минуты браузера — `FACT` (SP-3e §3) 12 минут стенки на
// семь клеток, — и привязать к нему дешёвый просмотр значило бы сделать чтение каталога
// платным.
//
// КЛАСС ДЕТЕРМИНИЗМА — ПРОИЗВОДНОЕ, А НЕ ПОЛЕ (решение владельца `TS-01`, вопрос 3):
// `determinismClassOf` считает его из записей, `UNGATED` означает «проверки не выполнялись», а
// не «чисто».
//
// ЧЕГО ТАБЛИЦА НЕ ЗНАЕТ И ЧЕСТНО ПИШЕТ. Устарела ли запись — вопрос про ПАРУ (профиль,
// отпечаток окружения, композиция), и отвечает на него `gateStaleness` у того, кто окружение
// измерил: команда гейта и `vpe build` (`L-01`). Список окружения не щупает: проба отпечатка
// (`H-03`) требует ffmpeg и дерева зависимостей, то есть просмотр каталога перестал бы
// работать там, где он всего нужнее — на чужой машине без установленного движка.

import {
  determinismClassOf,
  formatTemplateName,
  parseTemplateName,
  type LoadedTemplate,
} from '@vpe/templates-spec';

/** Одна строка таблицы. Считается из спека и записей, ничего не измеряя. */
export interface TemplateRow {
  readonly template: string;
  readonly version: number;
  /** Классы гейта по профилям: `final:PASS draftHalf:—`. */
  readonly gates: string;
  readonly msPerFrameBudget: number;
  readonly determinism: string;
  readonly easing: string;
  /** Файл записей либо `—`: спек без файла законен (ноль записей). */
  readonly file: string;
}

/** Строки таблицы каталога. */
export function templateRows(loaded: readonly LoadedTemplate[]): readonly TemplateRow[] {
  return loaded.map((item) => {
    const { manifest } = item.spec;
    const gates =
      manifest.gates.length === 0
        ? '—'
        : manifest.gates.map((gate) => `${gate.profileId}:${gate.class}`).join(' ');
    return {
      template: formatTemplateName(parseTemplateName(item.name)),
      version: item.spec.templateVersion,
      gates,
      msPerFrameBudget: manifest.msPerFrameBudget,
      determinism: determinismClassOf(manifest),
      easing: manifest.easingIds.length === 0 ? '—' : manifest.easingIds.join(','),
      file: item.file ?? '—',
    };
  });
}

const HEAD = ['шаблон', 'версия', 'гейт', 'бюджет мс/кадр', 'класс детерминизма', 'easing'] as const;

/** Печать таблицы. Ширины считаются по содержимому: колонка не обрезает имя шаблона. */
export function formatTemplateTable(rows: readonly TemplateRow[]): string {
  const body = rows.map((row) => [
    row.template,
    String(row.version),
    row.gates,
    String(row.msPerFrameBudget),
    row.determinism,
    row.easing,
  ]);
  const widths = HEAD.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => (cells[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0, ' ')).join(' | ');

  const out = [line(HEAD), widths.map((width) => '-'.repeat(width)).join('-+-')];
  for (const cells of body) out.push(line(cells));
  if (rows.length === 0) out.push('(библиотека пуста)');
  out.push(
    `записей гейта: ${String(rows.filter((row) => row.gates !== '—').length)} из ` +
      `${String(rows.length)} шаблонов; \`UNGATED\` — «проверки НЕ выполнялись», а не «чисто»`,
  );
  out.push(
    'устаревание записи здесь НЕ проверяется: это вопрос про пару (профиль, отпечаток, ' +
      'композиция), и отвечает на него тот, кто окружение измерил — `vpe template gate`',
  );
  return out.join('\n');
}
