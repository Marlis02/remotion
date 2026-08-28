// **R2** и **R3** механизмом, а не обещанием. БЕЗ БРАУЗЕРА.
//
// ЧТО ЭТИ ТЕСТЫ ЗАКРЫВАЮТ И ЧТО НЕТ — сказано здесь, чтобы клетки реестра инвариантов можно
// было заполнить дословно, а не «примерно».
//
// **R2** («рендерер пишет только в `outputPath` и `tmpDir`») закрывается тем, что каталоги
// ВОКРУГ обоих сделаны read-only (`chmod 0555`) и адаптер при этом проходит. Механизм —
// решение владельца (§4 п. 4): `chmod` работает без root и ловит запись мимо СВОИМ ЖЕ
// пользователем. Чего он НЕ ловит: запись от root и запись в каталоги, до которых тест не
// дотянулся. Полный ro-namespace (bind-ro) — задача `H-05`, и до неё клетка R2 обязана нести
// эту оговорку.
//
// **R3** («адаптер не открывает файлов вне `assets`/`fonts` запроса») закрывается перехватом
// `node:fs` внутри процесса адаптера: подменяются функции чтения, и список открытого
// сверяется с белым списком. Чего он НЕ ловит: открытия из ДРУГОГО процесса — самого
// рендерера. Их закрывает другой механизм, и он не наш: HyperFrames раздаёт композицию
// локальным `file_server` с корнем в каталоге композиции (`FACT` SP-3c §4), то есть браузер
// физически не видит ничего вне него. Проверка этого — `render.test.ts` (браузер) и `H-05`
// (netns), здесь — только код адаптера.
//
// БЕЛЫЙ СПИСОК СОДЕРЖИТ `node_modules` РЕНДЕРЕРА, И ЭТО НЕ ПОБЛАЖКА. R3 говорит про файлы
// ВНЕ `assets`/`fonts` ЗАПРОСА, то есть про входы сегмента. Собственный код адаптера
// (`gsap.min.js`, `runtime.js`) входом сегмента не является — иначе адаптер не имел бы права
// прочитать даже себя. Граница проходит именно здесь, и тест ниже её проверяет: файл из
// `node_modules` разрешён, файл из «стора» мимо запроса — нет.

import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { validateRequest } from '../src/validate.js';
import { makeFixture, PNG_1X1, withPatch } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';
/**
 * **R12** (`H-04`): у `renderSegment` нет умолчания «рендерить без гейта» — решение о
 * проходе принимается ЯВНО и с причиной. Здесь причина одна на файл: тест R2/R3 с подставленным запускателем: настоящего рендерера нет, пару проверять нечем.
 */
const GATE_SKIP = { mode: 'skip', why: 'тест R2/R3 с подставленным запускателем: настоящего рендерера нет, пару проверять нечем' } as const;


/** Часы теста: монотонный счётчик, а не `Date.now` — тест не измеряет время, он его подаёт. */
const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/** Материализует и возвращает запрос с ВЕРНЫМ `bundle.hash`. */
async function requestWithHash(fixture: ReturnType<typeof makeFixture>) {
  const probe = await renderSegment(fixture.request, {
    clock: fakeClock(),
    gate: GATE_SKIP,
    registry: TEST_REGISTRY,
    spawnRenderer: () => Promise.resolve(0),
    keepTmp: true,
  });
  if (probe.ok) throw new Error('первый прогон обязан отказать по `bundle.hash`');
  const m = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message);
  const hash = m?.[1];
  if (hash === undefined) throw new Error(`не нашёл хэш в: ${probe.error.message}`);
  return validateRequest(
    withPatch(fixture.request, { bundle: { ...fixture.request.bundle, hash } }),
  );
}

/** Фейковый «рендерер»: пишет PNG сам, ровно столько, сколько заказано. */
const fakeRenderer =
  (frames: number) =>
  (args: readonly string[]): Promise<number> => {
    const outIndex = args.indexOf('-o');
    const dir = args[outIndex + 1];
    if (dir === undefined) throw new Error('в аргументах нет `-o`');
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= frames; i++) {
      writeFileSync(path.join(dir, `frame_${String(i).padStart(6, '0')}.png`), PNG_1X1);
    }
    return Promise.resolve(0);
  };

const chmodded: string[] = [];
afterEach(() => {
  // Возвращаем права, иначе `mkdtemp`-каталоги останутся неудаляемыми для следующих прогонов.
  while (chmodded.length > 0) {
    const dir = chmodded.pop();
    if (dir !== undefined) chmodSync(dir, 0o755);
  }
});

describe('R2 — адаптер пишет ТОЛЬКО в `tmpDir` и `outputPath`', () => {
  it('каталог ВОКРУГ read-only (0555) — адаптер проходит', async () => {
    const fixture = makeFixture({ frames: 3 });
    const request = await requestWithHash(fixture);

    // `root` — общий предок `tmp/`, `out/` и `store/`. Делаем его read-only: любая попытка
    // создать в нём новый файл упрётся в EACCES, а запись ВНУТРЬ `tmp/` и `out/` останется
    // законной — права на них мы не трогаем.
    chmodSync(fixture.ws.root, 0o555);
    chmodded.push(fixture.ws.root);

    const response = await renderSegment(request, {
      clock: fakeClock(),
      gate: GATE_SKIP,
      registry: TEST_REGISTRY,
      spawnRenderer: fakeRenderer(3),
    });
    expect(response.ok, JSON.stringify(response)).toBe(true);
    if (!response.ok) return;
    expect(response.frames.frameCount).toBe(3);
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: запись мимо, в тот же read-only каталог, падает EACCES', () => {
    // Без этого теста предыдущий доказывал бы только «ничего не сломалось»: он был бы зелёным
    // и в мире, где `chmod 0555` ни на что не влияет (например, под root).
    const fixture = makeFixture({ frames: 1 });
    chmodSync(fixture.ws.root, 0o555);
    chmodded.push(fixture.ws.root);

    expect(() => writeFileSync(path.join(fixture.ws.root, 'мимо.txt'), 'x')).toThrowError(
      /EACCES|EPERM/u,
    );
  });

  it('после прогона каталог композиции УДАЛЁН, а кадры остались', async () => {
    const fixture = makeFixture({ frames: 2 });
    const request = await requestWithHash(fixture);
    const response = await renderSegment(request, {
      clock: fakeClock(),
      gate: GATE_SKIP,
      registry: TEST_REGISTRY,
      spawnRenderer: fakeRenderer(2),
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    // Композиция живёт ровно столько, сколько сегмент (ADR-0008).
    expect(readdirSync(request.tmpDir)).not.toContain('composition');
    // Кадры остаются: их потребляет `media`, и удалить их здесь значило бы отдать путь к тому,
    // чего уже нет.
    expect(readdirSync(response.frames.dir).length).toBe(2);
  });

  it('`keepTmp` оставляет каталог композиции — отладочный выход есть и он явный', async () => {
    const fixture = makeFixture({ frames: 1 });
    const request = await requestWithHash(fixture);
    const response = await renderSegment(request, {
      clock: fakeClock(),
      gate: GATE_SKIP,
      registry: TEST_REGISTRY,
      spawnRenderer: fakeRenderer(1),
      keepTmp: true,
    });
    expect(response.ok).toBe(true);
    expect(readdirSync(request.tmpDir)).toContain('composition');
  });

  it('вне `tmpDir` и `outputPath` адаптер не создал НИ ОДНОГО файла', async () => {
    const fixture = makeFixture({ frames: 2 });
    const request = await requestWithHash(fixture);
    const before = readdirSync(fixture.ws.root).sort();
    const storeBefore = readdirSync(fixture.ws.storeDir).sort();

    await renderSegment(request, {
      clock: fakeClock(),
      gate: GATE_SKIP,
      registry: TEST_REGISTRY,
      spawnRenderer: fakeRenderer(2),
    });

    expect(readdirSync(fixture.ws.root).sort()).toEqual(before);
    // «Стор» — единственное место, откуда адаптер читал; записи там не появилось.
    expect(readdirSync(fixture.ws.storeDir).sort()).toEqual(storeBefore);
  });
});

describe('R3 — адаптер открывает ТОЛЬКО файлы запроса и собственный код', () => {
  /**
   * Перехват чтения в процессе адаптера.
   *
   * Патчатся `readFileSync`/`copyFileSync`/`openSync` и промис-двойники: это ВСЕ пути, которыми
   * `validate.ts` и `materialize.ts` вообще касаются диска. Список — не «всё, что открылось в
   * процессе»: `vitest` и Node читают своё, и смешивать их с адаптером значило бы стеречь шум.
   */
  const withFsSpy = async <T>(fn: () => Promise<T>): Promise<{ result: T; opened: string[] }> => {
    const opened: string[] = [];
    const origRead = fs.readFileSync;
    const origCopy = fs.copyFileSync;
    const origOpen = fs.openSync;
    const origReadP = fsPromises.readFile;

    fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof p === 'string') opened.push(p);
      return (origRead as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readFileSync;
    fs.copyFileSync = ((src: fs.PathLike, ...rest: unknown[]) => {
      opened.push(String(src));
      return (origCopy as (...a: unknown[]) => unknown)(src, ...rest);
    }) as typeof fs.copyFileSync;
    fs.openSync = ((p: fs.PathLike, ...rest: unknown[]) => {
      opened.push(String(p));
      return (origOpen as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync;
    fsPromises.readFile = ((p: unknown, ...rest: unknown[]) => {
      opened.push(String(p));
      return (origReadP as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fsPromises.readFile;

    try {
      const result = await fn();
      return { result, opened };
    } finally {
      fs.readFileSync = origRead;
      fs.copyFileSync = origCopy;
      fs.openSync = origOpen;
      fsPromises.readFile = origReadP;
    }
  };

  it('множество открытых путей ⊆ {файлы запроса, tmpDir, node_modules рендерера}', async () => {
    const fixture = makeFixture({ frames: 2, withFont: true });
    const request = await requestWithHash(fixture);

    const { opened } = await withFsSpy(async () =>
      renderSegment(request, {
        clock: fakeClock(),
        gate: GATE_SKIP,
        registry: TEST_REGISTRY,
        spawnRenderer: fakeRenderer(2),
      }),
    );

    const allowed = [
      ...request.assets.map((a) => a.path),
      ...request.fonts.map((f) => f.path),
    ];
    const outside = opened.filter((p) => {
      if (allowed.includes(p)) return false;
      if (p.startsWith(request.tmpDir)) return false;
      if (p.startsWith(request.outputPath)) return false;
      // Собственный код адаптера — вне правила по определению (см. шапку файла).
      if (p.includes('/node_modules/')) return false;
      if (p.includes('/packages/renderer-hyperframes/src/')) return false;
      if (p.includes('/proc/')) return false;
      return true;
    });
    expect(outside, `открыто вне разрешённого: ${outside.join(', ')}`).toEqual([]);
    // Тест не должен быть зелёным потому, что перехват ничего не поймал.
    expect(opened.length).toBeGreaterThan(0);
    expect(opened).toContain(request.assets[0]?.path);
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: чужой файл, подсунутый в IR, — отказ ДО открытия', async () => {
    const fixture = makeFixture({ frames: 2 });
    const request = await requestWithHash(fixture);

    // Кладём настоящий блоб в «стор» и называем его ТОЛЬКО в IR — как это выглядело бы, если
    // бы адаптер искал ассеты по CAS сам.
    const alienBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const alienSha = (await import('node:crypto'))
      .createHash('sha256')
      .update(alienBytes)
      .digest('hex');
    const alienPath = path.join(fixture.ws.storeDir, alienSha);
    writeFileSync(alienPath, alienBytes);

    const broken = withPatch(request, {
      ir: { ...request.ir, assets: [{ sha256: alienSha, role: 'image' }] },
    });

    const { opened } = await withFsSpy(async () => {
      try {
        validateRequest(broken);
        throw new Error('ожидался отказ R3');
      } catch (err) {
        return err;
      }
    });

    // Главное утверждение: файл чужого ассета НЕ ОТКРЫВАЛСЯ. Отказ случился на сверке
    // `ir.assets ⊆ request.assets`, то есть на ЗНАЧЕНИЯХ, до всякого диска.
    expect(opened).not.toContain(alienPath);
  });
});

