// **ДВА `draftHalf`-ПРОФИЛЯ ОБЯЗАНЫ РАЗЛИЧАТЬСЯ РОВНО ДВУМЯ СТРОКАМИ** — поправка владельца
// П3 к решению «п1» (`H-06`, 2026-08-29). БЕЗ БРАУЗЕРА.
//
// ЗАЧЕМ ЭТОТ ОХРАННИК СУЩЕСТВУЕТ. Профиль гейта
// (`packages/renderer-hyperframes/gate-profiles/draftHalf.yaml`) заведён потому, что
// фикстурный `render.draft.yaml` несёт `imageFormat: jpeg`, а адаптер его отказывает
// (**№154** на профиле `draft`). Но два файла с одним `profileId` — это ровно та форма, из
// которой рождается тихое расхождение: гейт снимут на одних числах энкодера, ролик соберут на
// других, и запись гейта будет описывать ПАРУ, КОТОРОЙ НЕ СУЩЕСТВУЕТ. Отсюда правило: всё,
// кроме двух названных строк, обязано совпадать.
//
// ПОЧЕМУ СВЕРКА ТЕКСТОВАЯ, А НЕ СЕМАНТИЧЕСКАЯ. Разбирать YAML здесь нечем: у пакета ровно две
// стрелки (`core-model`, `templates-spec`), `@vpe/schema` в его зависимостях НЕТ, и заводить
// её ради теста значило бы развернуть границу ADR-0009 и тронуть лок. Но текстовая сверка тут
// не «дешёвая замена» — она СИЛЬНЕЕ: она ловит и то, что семантический разбор простил бы,
// например перестановку полей или сменившийся отступ вложенного блока `encoder`.
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ. Шапки у файлов разные по построению — фикстурный объясняет draft
// как механизм AC3, этот объясняет, почему он вообще заведён. Сверять их значило бы требовать
// одинаковых объяснений у файлов с разными обязанностями.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const FIXTURE_DRAFT = path.join(ROOT, 'fixtures/minimal/profiles/render.draft.yaml');
const GATE_DRAFT = path.join(ROOT, 'packages/renderer-hyperframes/gate-profiles/draftHalf.yaml');

/**
 * Значащие строки файла: без комментариев (и хвостовых, и целых) и без пустых.
 *
 * Отступ СОХРАНЯЕТСЯ — он несёт вложенность (`encoder.threads` против `threads` верхнего
 * уровня), и стирать его значило бы сверять другой файл.
 */
function significantLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return (hash < 0 ? line : line.slice(0, hash)).replace(/\s+$/u, '');
    })
    .filter((line) => line.trim() !== '');
}

describe('**П3** — профиль гейта отличается от фикстурного `draft` ровно двумя строками', () => {
  const fixture = significantLines(FIXTURE_DRAFT);
  const gate = significantLines(GATE_DRAFT);

  it('оба файла — `render-profile/1` с одним `profileId: draftHalf`', () => {
    // Без этого сверка ниже могла бы оказаться сравнением двух разных семейств.
    expect(fixture[0]).toBe('schema: render-profile/1');
    expect(gate[0]).toBe('schema: render-profile/1');
    expect(fixture[1]).toBe('profileId: draftHalf');
    expect(gate[1]).toBe('profileId: draftHalf');
  });

  it('ЕДИНСТВЕННОЕ отличие фикстуры от гейта — `imageFormat` и снятый `jpegQuality`', () => {
    const onlyInFixture = fixture.filter((line) => !gate.includes(line));
    const onlyInGate = gate.filter((line) => !fixture.includes(line));

    expect(onlyInFixture.map((s) => s.trim())).toEqual(['imageFormat: jpeg', 'jpegQuality: 80']);
    expect(onlyInGate.map((s) => s.trim())).toEqual(['imageFormat: png']);
  });

  it('порядок и число прочих строк совпадают: перестановка полей — тоже расхождение', () => {
    const strip = (lines: readonly string[]): string[] =>
      lines.filter((l) => !/^\s*(imageFormat|jpegQuality):/u.test(l));
    expect(strip(gate)).toEqual(strip(fixture));
  });

  it('числа энкодера, от которых зависит `sha256` записи, названы поимённо', () => {
    // Не тавтология к сверке выше: она проверяет РАВЕНСТВО двух файлов, а это — что нужные
    // поля в них вообще есть. Пустой профиль прошёл бы первую проверку и провалил бы гейт.
    for (const needed of ['codec: h264', 'crf: 28', 'gopSize: 30', 'bitexact: true', 'threads: 4']) {
      expect(gate.map((s) => s.trim()), needed).toContain(needed);
    }
    // `scale` — то, что делает `draftHalf` половинным; при расхождении гейт мерил бы другую
    // геометрию, а не другую передачу кадров.
    expect(gate.map((s) => s.trim())).toContain('scale: 0.5');
  });

  it('фикстурный `draft` ОСТАЁТСЯ живым jpeg-профилем (долг №163 не обнулён)', () => {
    // Условие владельца к решению №154 в `H-03`: покрытие матрицы K1 по `jpegQuality` держится
    // ровно этим файлом. Если кто-то «починит» его на png — покрытие исчезнет молча.
    expect(fixture.map((s) => s.trim())).toContain('imageFormat: jpeg');
    expect(fixture.map((s) => s.trim())).toContain('jpegQuality: 80');
  });
});
