// **СКЕЛЕТ ДЕМО-ПРОЕКТА — КОПИЯ КАНАЛЬНЫХ ФАЙЛОВ, И РАЗЪЕЗД КОПИЙ ЛОВИТСЯ ЗДЕСЬ**
// (`TPL-01c`, 2026-09-10).
//
// ЗАЧЕМ ЭТОТ ОХРАННИК СУЩЕСТВУЕТ. `packages/cli/demo-project/` держит профили, по которым
// собираются все семь демо. Это ВТОРАЯ копия чисел, у которых есть первая: профиль
// компиляции, звука, `final` и `ac4` живут в `fixtures/minimal/profiles/`, а `draftHalf` —
// в `renderer-hyperframes/gate-profiles/`. Две копии одних чисел — ровно та форма, из которой
// рождается тихое расхождение: демо показывало бы поведение ДРУГОГО канала, а владелец
// смотрел бы на него как на свой. Отсюда правило: значащие строки обязаны совпадать.
//
// ПОЧЕМУ КОПИЯ ВООБЩЕ НУЖНА, А НЕ ССЫЛКА НА ФИКСТУРУ. `vpe template demo` — прод-команда, и
// зависеть от `fixtures/**` она не имеет права: фикстура есть предмет тестов и Charter AC4,
// а не часть движка. Приём — тот же, что у `gate-profiles/draftHalf.yaml` (`H-06`): данные
// команды лежат в каталоге её пакета, а сверка с оригиналом стоит тестом.
//
// ПОЧЕМУ СВЕРКА ТЕКСТОВАЯ, А НЕ СЕМАНТИЧЕСКАЯ — довод дословно тот же, что в
// `renderer-hyperframes/test/gate-profile.test.ts`: она СИЛЬНЕЕ, потому что ловит и то, что
// семантический разбор простил бы (перестановку полей, сменившийся отступ вложенного блока).
// Комментарии вырезаются: шапки у файлов разные по построению.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { demoProjectSkeletonDir } from '../src/template-demo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SKELETON = demoProjectSkeletonDir();

/** Значащие строки файла: без комментариев (и хвостовых, и целых) и без пустых. */
function significantLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return (hash < 0 ? line : line.slice(0, hash)).replace(/\s+$/u, '');
    })
    .filter((line) => line.trim() !== '');
}

/** Пары «файл скелета → его оригинал». Каждая строка — обещание, которое проверяется ниже. */
const COPIES: readonly { readonly skeleton: string; readonly origin: string; readonly why: string }[] = [
  {
    skeleton: 'profiles/compile.yaml',
    origin: 'fixtures/minimal/profiles/compile.yaml',
    why: 'геометрия времени и субтитры канала',
  },
  {
    skeleton: 'profiles/audio.yaml',
    origin: 'fixtures/minimal/profiles/audio.yaml',
    why: 'громкость, ресемплер и приёмка дубля канала',
  },
  {
    skeleton: 'profiles/render.final.yaml',
    origin: 'fixtures/minimal/profiles/render.final.yaml',
    why: 'полный профиль `final`, на котором снят гейт',
  },
  {
    skeleton: 'profiles/render.ac4.yaml',
    origin: 'fixtures/minimal/profiles/render.ac4.yaml',
    why: 'профиль AC4 — схема `project/1` требует все пять ключей',
  },
  {
    skeleton: 'profiles/render.draft.yaml',
    origin: 'packages/renderer-hyperframes/gate-profiles/draftHalf.yaml',
    why:
      'профиль ГЕЙТА, а не фикстурный `draft`: фикстурный несёт `imageFormat: jpeg`, ' +
      'который адаптер отказывает (долг №154), и демо на нём не собралось бы ни разу',
  },
  {
    skeleton: 'voice/roles.yaml',
    origin: 'fixtures/minimal/voice/roles.yaml',
    why: 'роли голоса на `tts:mock@1` — демо не ходит в сеть и не стоит денег',
  },
];

describe('скелет демо-проекта живёт в каталоге пакета и найден', () => {
  it('каталог существует и лежит рядом с `package.json` пакета', () => {
    expect(existsSync(SKELETON), SKELETON).toBe(true);
    expect(path.basename(SKELETON)).toBe('demo-project');
    expect(existsSync(path.join(SKELETON, 'project.yaml'))).toBe(true);
  });

  it('скелет НЕПОЛОН намеренно: прозы, режиссуры, каталога ассетов и `store.lock` в нём нет', () => {
    // Прямая проверка обещания шапки `project.yaml`: это заготовка, а не проект. Файл,
    // случайно положенный сюда, сделал бы демо зависимым от него молча — и одинаково для
    // всех семи.
    for (const missing of ['source', 'direction', 'assets', 'fonts', 'store.lock']) {
      expect(existsSync(path.join(SKELETON, missing)), missing).toBe(false);
    }
  });
});

describe.each(COPIES.map((copy) => [copy.skeleton, copy] as const))(
  '`%s` — копия канального файла, строка в строку',
  (_name, copy) => {
    it(`совпадает с \`${copy.origin}\` (${copy.why})`, () => {
      const skeleton = significantLines(path.join(SKELETON, copy.skeleton));
      const origin = significantLines(path.join(ROOT, copy.origin));
      expect(skeleton).toEqual(origin);
      // Не тавтология к равенству: пустой файл прошёл бы его и не был бы профилем.
      expect(skeleton.length).toBeGreaterThan(3);
      expect(skeleton[0]?.startsWith('schema: ')).toBe(true);
    });
  },
);

describe('`project.yaml` скелета называет ровно те файлы, что лежат рядом', () => {
  const lines = significantLines(path.join(SKELETON, 'project.yaml'));

  it('геометрия — канальная вертикаль 1080×1920 при 30 fps и 24000 Гц', () => {
    // Числа выписаны здесь, а не сверяются с фикстурой: `project.yaml` демо — СВОЙ файл (у
    // него другой `id`, другой `store.path` и пустые `remotes`), и копией он не является.
    // Значит проверять надо то, ради чего он существует, — что демо собирается в геометрии
    // канала, а не в какой-нибудь своей.
    for (const needed of [
      'fps: { num: 30, den: 1 }',
      'width: 1080',
      'height: 1920',
      'projectSampleRate: 24000',
      'providerId: "tts:mock@1"',
    ]) {
      expect(lines.map((line) => line.trim()), needed).toContain(needed);
    }
  });

  it('каждый профиль из раскладки лежит на диске', () => {
    const referenced = lines
      .map((line) => /:\s*(profiles\/[^\s"]+)$/u.exec(line.trim())?.[1])
      .filter((value): value is string => value !== undefined);
    expect(referenced.length).toBe(5);
    for (const relative of referenced) {
      expect(existsSync(path.join(SKELETON, relative)), relative).toBe(true);
    }
  });

  it('CAS демо не указывает в `~/.vpe/store`', () => {
    // Забытый `--store-dir` не имеет права увести запись в настоящий стор: там лежит
    // единственная копия оплаченного аудио (M8, ADR-0005 §8a).
    const store = lines.find((line) => line.trim().startsWith('path:'));
    expect(store?.trim()).toBe('path: "./.demo-store"');
  });
});
