// Материализация каталога композиции. БЕЗ БРАУЗЕРА.
//
// Что здесь проверяется и почему именно это: каталог содержит РОВНО объявленное, имена
// ASCII-safe по sha256, `compositionHash` детерминирован и чувствителен к каждому байту,
// а `bundle.hash` СВЕРЯЕТСЯ. Последнее — тот охранник, который отличает «мы построили
// каталог» от «мы построили ТОТ каталог, ключ которого адресует кэш».

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RenderAdapterError } from '../src/errors.js';
import { compositionHashOf, materializeComposition } from '../src/materialize.js';
import { rendererTemplates } from '../src/templates/index.js';
import { makeFixture, PNG_1X1, withPatch } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';

/** Все файлы каталога относительными путями, отсортированные. */
const treeOf = (root: string, sub = ''): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, sub)).sort()) {
    const rel = sub === '' ? name : `${sub}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...treeOf(root, rel));
    else out.push(rel);
  }
  return out.sort();
};

/** Материализует дважды: первый раз — узнать хэш, второй — с верным `bundle.hash`. */
const materializeTwice = (fixture: ReturnType<typeof makeFixture>) => {
  let hash = '';
  try {
    materializeComposition(fixture.request, { registry: TEST_REGISTRY });
  } catch (err) {
    const e = err as RenderAdapterError;
    const m = /имеет `([0-9a-f]{64})`/u.exec(e.message);
    hash = m?.[1] ?? '';
  }
  const request = withPatch(fixture.request, {
    bundle: { ...fixture.request.bundle, hash },
  });
  return { hash, result: materializeComposition(request, { registry: TEST_REGISTRY }), request };
};

describe('каталог композиции содержит РОВНО объявленное', () => {
  it('раскладка: index.html, ir.json, manifest.json, vendor, assets, fonts (runtime ВСТРОЕН)', () => {
    const fixture = makeFixture({ withFont: true });
    const { result } = materializeTwice(fixture);

    const expected = [
      `assets/${String(fixture.assetSha)}.png`,
      `fonts/${String(fixture.fontSha)}.ttf`,
      'index.html',
      'ir.json',
      'manifest.json',
      'vendor/gsap.min.js',
    ].sort();
    expect(treeOf(result.dir)).toEqual(expected);
  });

  it('имена ассетов — ASCII-safe по sha256, а не по имени исходного файла', () => {
    const fixture = makeFixture();
    const { result } = materializeTwice(fixture);
    // Исходный файл называется `photo.blob` — в каталоге его имени нет ни в одном виде.
    expect(treeOf(result.dir).join('\n')).not.toContain('photo');
    expect(treeOf(result.dir)).toContain(`assets/${String(fixture.assetSha)}.png`);
  });

  it('расширение выведено ИЗ БАЙТОВ: png — `.png`, sfnt — `.ttf`', () => {
    const fixture = makeFixture({ withFont: true });
    const { result } = materializeTwice(fixture);
    const names = treeOf(result.dir);
    expect(names.some((n) => n.startsWith('assets/') && n.endsWith('.png'))).toBe(true);
    expect(names.some((n) => n.startsWith('fonts/') && n.endsWith('.ttf'))).toBe(true);
  });

  it('ЛИШНИЙ файл рядом в `tmpDir` в каталог НЕ попадает', () => {
    const fixture = makeFixture();
    // Кладём «чужой блоб» рядом — так выглядела бы попытка взять ассет из `.store` мимо запроса.
    const alienDir = path.join(fixture.ws.tmpDir, '.store');
    mkdirSync(alienDir, { recursive: true });
    writeFileSync(path.join(alienDir, 'alien.png'), PNG_1X1);

    const { result } = materializeTwice(fixture);
    expect(treeOf(result.dir).join('\n')).not.toContain('alien');
    // И перечень, по которому считается хэш, о нём тоже не знает.
    expect(result.listing.map((l) => l.path).join('\n')).not.toContain('alien');
  });

  it('ассет без объявления в запросе в каталог не попадает: файлов ровно столько, сколько в `assets`', () => {
    const fixture = makeFixture({ withAsset: false });
    const { result } = materializeTwice(fixture);
    expect(treeOf(result.dir).filter((n) => n.startsWith('assets/'))).toEqual([]);
  });

  it('остаток прошлого сегмента затирается: каталог строится с нуля', () => {
    const fixture = makeFixture();
    const dir = fixture.request.bundle.path;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'stale.txt'), 'остаток прошлого прогона');

    const { result } = materializeTwice(fixture);
    expect(treeOf(result.dir)).not.toContain('stale.txt');
  });
});

describe('`compositionHash` — sha256 канонического перечня', () => {
  it('детерминирован: две материализации одного запроса дают ОДИН хэш', () => {
    const fixture = makeFixture({ withFont: true });
    const first = materializeTwice(fixture);
    const second = materializeComposition(first.request, { registry: TEST_REGISTRY });
    expect(second.compositionHash).toBe(first.result.compositionHash);
  });

  it('меняется от ЛЮБОГО байта: правка одного пикселя ассета меняет хэш', () => {
    const before = materializeTwice(makeFixture()).result.compositionHash;

    const fixture = makeFixture();
    const asset = fixture.request.assets[0];
    if (asset === undefined) throw new Error('фикстура обязана нести ассет');
    // Другой PNG — другие байты, другой sha, другое имя файла, другой перечень.
    const other = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    writeFileSync(asset.path, other);
    // Запрос не трогаем: он по-прежнему называет СТАРЫЙ sha, а по пути лежат НОВЫЕ байты —
    // ровно та подмена, которую ловит `assertRequestFiles`. Здесь проверяется другое: что
    // хэш каталога считается по ЛЁГШИМ байтам, а не по объявленным.
    const after = materializeTwice(fixture);
    expect(after.hash).not.toBe(before);
  });

  it('меняется от геометрии: другой `scale` — другой `index.html` — другой хэш', () => {
    const a = materializeTwice(makeFixture());
    const fixture = makeFixture();
    const scaled = withPatch(fixture.request, {
      pixelProfile: { ...fixture.request.pixelProfile, scale: 0.5 },
    });
    const b = materializeTwice({ ...fixture, request: scaled });
    expect(b.hash).not.toBe(a.hash);
  });

  it('НЕ зависит от порядка обхода: перечень сортируется по пути', () => {
    const listing = [
      { path: 'b.txt', sha256: 'b'.repeat(64), bytes: 1 },
      { path: 'a.txt', sha256: 'a'.repeat(64), bytes: 1 },
    ];
    const reversed = [...listing].reverse();
    expect(compositionHashOf(listing)).toBe(compositionHashOf(reversed));
  });

  it('разделитель NUL разводит `(a/b, sha)` и `(a, b/sha)` — склейка невозможна', () => {
    const left = compositionHashOf([{ path: 'a/b', sha256: 'c'.repeat(64), bytes: 1 }]);
    const right = compositionHashOf([{ path: 'a', sha256: `b${'c'.repeat(63)}`, bytes: 1 }]);
    expect(left).not.toBe(right);
  });
});

describe('`bundle.hash` СВЕРЯЕТСЯ, а не принимается на веру', () => {
  it('неверный `bundle.hash` — отказ с ОБЕИМИ величинами в тексте', () => {
    const fixture = makeFixture();
    try {
      materializeComposition(fixture.request, { registry: TEST_REGISTRY });
      throw new Error('ожидался отказ по `bundle.hash`');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderAdapterError);
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R2');
      expect(e.message).toContain('0'.repeat(64));
      expect(e.message).toMatch(/имеет `[0-9a-f]{64}`/u);
    }
  });

  it('верный `bundle.hash` проходит', () => {
    const fixture = makeFixture();
    const { result, hash } = materializeTwice(fixture);
    expect(result.compositionHash).toBe(hash);
  });

  // ── `verifyHash: false` — вход `L-01`, и он НЕ ослабляет R2 ──────────────────
  // Флаг добавлен по явному разрешению владельца: `bundle.hash` есть величина ВХОДА, и
  // ПЕРВЫЙ её вычислитель обязан существовать честно — до этого сборке пришлось бы вынимать
  // хэш регуляркой из текста отказа, как это делают фикстуры. Ниже проверено ровно то, что
  // разрешение оговаривало: сверка остаётся УМОЛЧАНИЕМ, а обойти её можно только назвав это
  // вслух в вызове.
  it('`verifyHash: false` считает хэш и НЕ сверяет — это первый вычислитель, а не обход', () => {
    const fixture = makeFixture();
    const result = materializeComposition(fixture.request, {
      registry: TEST_REGISTRY,
      verifyHash: false,
    });
    // Хэш посчитан по ФАКТИЧЕСКОМУ каталогу, а не эхом поля запроса (там 64 нуля).
    expect(result.compositionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.compositionHash).not.toBe(fixture.request.bundle.hash);
    // И он тот же самый, который назвал бы отказ R2, — иначе «первый вычислитель» считал бы
    // не ту величину, что сверяется потом.
    const { hash } = materializeTwice(makeFixture());
    expect(result.compositionHash).toBe(hash);
  });

  it('умолчание — СВЕРЯТЬ: тот же запрос без флага по-прежнему падает `R2`', () => {
    const fixture = makeFixture();
    materializeComposition(fixture.request, { registry: TEST_REGISTRY, verifyHash: false });
    // Второй вызов БЕЗ флага, на том же самом запросе с неверным полем, обязан отказать:
    // послабление живёт в вызове, а не в состоянии каталога.
    expect(() => materializeComposition(fixture.request, { registry: TEST_REGISTRY })).toThrow(
      RenderAdapterError,
    );
  });

  it('`verifyHash: true` явно — то же, что умолчание', () => {
    const fixture = makeFixture();
    expect(() =>
      materializeComposition(fixture.request, { registry: TEST_REGISTRY, verifyHash: true }),
    ).toThrow(RenderAdapterError);
  });
});

describe('шаблон без реализации — отказ ДО того, как на диск лёг байт', () => {
  // ~~`продакшн-реестр ПУСТ`~~ *(изменено: `H-06`, 2026-08-29 — реализации написаны.)*
  // Утверждение осталось тем же по СМЫСЛУ: синтетический `solid@1` в продакшн-реестр не
  // утёк. Проверка «реестр пуст» заменена на «реестр совпадает с библиотекой спеков» —
  // состав сверяется поимённо в `templates.test.ts`, здесь стережётся только непопадание
  // тестового шаблона.
  // *(дополнено: `E-07`, 2026-08-31 — шестым встал `grade@1`.)*
  it('продакшн-реестр НАПОЛНЕН шестью, и `solid@1` в нём нет', () => {
    expect(rendererTemplates.templates).toHaveLength(6);
    expect(rendererTemplates.templates.map((t) => t.templateId)).not.toContain('solid');
  });

  it('вызов неизвестного шаблона — `V3`, и каталог НЕ создан', () => {
    const fixture = makeFixture({ template: 'kenburns@1' });
    try {
      materializeComposition(fixture.request, { registry: TEST_REGISTRY });
      throw new Error('ожидался отказ V3');
    } catch (err) {
      expect((err as RenderAdapterError).rule).toBe('V3');
    }
    // Ни каталога, ни единого файла: отказ случился до `mkdirSync`.
    expect(() => statSync(fixture.request.bundle.path)).toThrow();
  });

  it('имя вызова, не разбирающееся грамматикой `TS-01`, — тоже `V3`', () => {
    const fixture = makeFixture({ template: 'Solid@1' });
    try {
      materializeComposition(fixture.request, { registry: TEST_REGISTRY });
      throw new Error('ожидался отказ V3');
    } catch (err) {
      expect((err as RenderAdapterError).rule).toBe('V3');
    }
  });
});

describe('содержимое каталога — данные, а не догадки', () => {
  it('`ir.json` — канонический JSON того же IR, что в запросе', () => {
    const fixture = makeFixture();
    const { result, request } = materializeTwice(fixture);
    const text = readFileSync(path.join(result.dir, 'ir.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(request.ir);
  });

  it('`manifest.json` раскрывает `scale` в геометрию: 1080×1920 × 0.25 = 270×480', () => {
    const fixture = makeFixture();
    const { result } = materializeTwice(fixture);
    const manifest = JSON.parse(
      readFileSync(path.join(result.dir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest['width']).toBe(270);
    expect(manifest['height']).toBe(480);
    expect(manifest['baseWidth']).toBe(1080);
    expect(manifest['baseHeight']).toBe(1920);
  });

  it('`index.html` адресует ассеты ОТНОСИТЕЛЬНЫМИ URL и подключает GSAP', () => {
    const fixture = makeFixture({ withFont: true });
    const { result } = materializeTwice(fixture);
    const html = readFileSync(path.join(result.dir, 'index.html'), 'utf8');
    expect(html).toContain('./vendor/gsap.min.js');
    // runtime ВСТРОЕН, а не подключён файлом: компилятор рендерера читает разметку статически
    // и `<script src>` не разворачивает (ИЗМЕРЕНО, см. шапку `materialize.ts`).
    expect(html).not.toContain('./runtime.js');
    expect(html).toContain('window.__timelines[MANIFEST.compositionId]');
    expect(html).toContain('data-composition-id="seg-a1"');
    expect(html).toContain('data-duration="1"');
    expect(html).toContain(`./fonts/${String(fixture.fontSha)}.ttf`);
    // Ни одного абсолютного пути машины: каталог обязан быть переносимым.
    expect(html).not.toContain(fixture.ws.root);
  });

  it('IR встроен в HTML с экранированием `<` — текст субтитров не закроет тег', () => {
    const fixture = makeFixture();
    const evil = withPatch(fixture.request, {
      ir: {
        ...fixture.request.ir,
        captions: [
          {
            frames: { frameStart: 0, frameEnd: 5 },
            text: '</script><script>window.__pwned = 1;</script>',
            tokens: [],
          },
        ],
      },
    });
    const { result } = materializeTwice({ ...fixture, request: evil });
    const html = readFileSync(path.join(result.dir, 'index.html'), 'utf8');
    expect(html).not.toContain('</script><script>window.__pwned');
    expect(html).toContain('\\u003c/script');
  });
});
