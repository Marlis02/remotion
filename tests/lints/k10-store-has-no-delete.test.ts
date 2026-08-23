// **K10** (половина) — в `media/src/store/**` нет удаления файлов, кроме уборки своего tmp.
//
// ЧЕСТНО О ГРАНИЦАХ ЭТОГО ОХРАННИКА. Правило реестра звучит «`.store` никогда не подлежит
// LRU-GC», а охранником назван «тест: GC не трогает `kind: voice|snapshot`». Такого теста
// быть не может: GC в кодовой базе нет, и `vpe store gc` не будет написан никогда
// (ADR-0005 §8 — «дубли TTS невоспроизводимы»). Проверять нечего, и натягивать нечего.
//
// Что здесь проверяется взамен — ВОЗМОЖНОСТЬ, а не намерение: пока ни один файл модуля
// стора не зовёт удаление, `.store` не может быть подчищен ни по ошибке, ни «на всякий
// случай». Этот греп краснеет в тот день, когда кто-нибудь напишет `rmSync(blobPath(...))`,
// — то есть на настоящем нарушении K10, а не на его формулировке. Вторая половина (у
// `Store` нет метода удаления) живёт в `packages/media/test/store-layout.test.ts` и близка к
// тавтологии; так она там и названа. Строка K10 в реестре остаётся `named`.
//
// ОБЛАСТЬ — ИМЕННО СТОР. `media/src/cache/**` (задача `M-05`) под это правило НЕ подпадает:
// кэш инвалидируется и чистится по определению (ADR-0006), K10 — про `.store`.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

const STORE = 'packages/media/src/store/';

/** Единственный файл, владеющий временем жизни tmp, — там уборка законна и обязана быть. */
const EXEMPT = 'packages/media/src/store/atomic.ts';

/** Всё, чем в Node можно удалить файл или обрезать его до нуля. */
const DELETION = /\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync|ftruncate)\b/;

function storeFiles(): string[] {
  return sourceFiles('media').filter((file) => file.startsWith(STORE));
}

/** Строки кода (без комментариев и без строк импорта) с упоминанием удаления. */
function deletionLines(relPath: string): { number: number; text: string }[] {
  const out: { number: number; text: string }[] = [];
  for (const [index, line] of codeLines(readSource(relPath)).entries()) {
    if (/^\s*import\b/.test(line)) continue;
    if (DELETION.test(line)) out.push({ number: index + 1, text: line.trim() });
  }
  return out;
}

describe('**K10** — модуль стора не умеет удалять', () => {
  it('охранник стережёт непустое множество файлов', () => {
    expect(storeFiles().length).toBeGreaterThan(0);
    expect(storeFiles()).toContain(EXEMPT);
  });

  it('ни один файл `store/**`, кроме владельца tmp, не зовёт удаление', () => {
    const offenders: string[] = [];
    for (const file of storeFiles()) {
      if (file === EXEMPT) continue;
      for (const line of deletionLines(file)) offenders.push(`${file}:${String(line.number)} — ${line.text}`);
    }
    expect(
      offenders,
      'K10 (ADR-0005 §8): `.store` не подлежит GC никогда — дубли TTS невоспроизводимы ' +
        '(`FACT` r1 §2.3). Удаление в модуле стора появиться не может. Найдено: ' + offenders.join('; '),
    ).toEqual([]);
  });

  it('в файле-исключении удаление адресует ТОЛЬКО tmp, и это видно в той же строке', () => {
    const lines = deletionLines(EXEMPT);
    expect(lines.length, 'исключение стало мёртвым: уборка tmp исчезла').toBeGreaterThan(0);
    for (const line of lines) {
      expect(
        line.text,
        `${EXEMPT}:${String(line.number)} удаляет НЕ tmp: ${line.text}`,
      ).toMatch(/tempPath/);
    }
  });

  it('имя tmp строится отдельной функцией и не может совпасть с адресом блоба', () => {
    // Если бы tmp назывался как блоб, «уборка tmp» и «удаление блоба» стали бы одним и тем же
    // вызовом, и предыдущая проверка охраняла бы пустоту.
    const source = codeLines(readSource(EXEMPT)).join('\n');
    expect(source).toMatch(/tempNameFor/);
    expect(source).toMatch(/\.tmp-/);
  });
});
