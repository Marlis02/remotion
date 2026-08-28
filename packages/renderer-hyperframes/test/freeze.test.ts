// Runtime-guard заморозки глобалей — вторая половина **D4** (ADR-0007 §4, долг №2).
// БЕЗ БРАУЗЕРА И БЕЗ jsdom.
//
// ПОЧЕМУ `node:vm`, А НЕ jsdom. Guard подменяет ИНТРИНСИКИ (`Math`, `Date`, `Intl`) — то есть
// делает ровно то, что нельзя делать в процессе, где живут тесты: заморозив `Date.now` глобально,
// он утащил бы за собой сам vitest. `vm.createContext` даёт СВОИ интринсики: подмена внутри
// него на хозяина не распространяется, и проверять можно настоящий файл, а не его пересказ.
// jsdom здесь не нужен вовсе — guard`у не нужен DOM, ему нужны глобали.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  compositionHashOf,
  materializeComposition,
  type MaterializedComposition,
} from '../src/materialize.js';
import { makeFixture, withPatch } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_SOURCE = readFileSync(path.join(HERE, '../src/composition/freeze.js'), 'utf8');

/** Контекст с собственными интринсиками и подставным `performance` (в `vm` его нет). */
function frozenContext(): vm.Context {
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis; var performance = { now: function () { return 0; } };', ctx);
  vm.runInContext(FREEZE_SOURCE, ctx);
  return ctx;
}

/**
 * Исполняет выражение ВО ВЗВЕДЁННОМ окне и возвращает текст броска (или `null`).
 *
 * Взвод обязателен: guard бросает только там, где исполняется код, произведённый
 * компилятором. Вне окна те же выражения обязаны РАБОТАТЬ — это отдельный блок ниже.
 */
function refusalOf(ctx: vm.Context, expression: string, at = 'клип c:1'): string | null {
  try {
    vm.runInContext(
      `window.__VPE_FREEZE.run(${JSON.stringify(at)}, function () { ${expression}; });`,
      ctx,
    );
    return null;
  } catch (err) {
    return String((err as Error).message);
  }
}

describe('каждый API списка D4 БРОСАЕТ, называя себя', () => {
  const ctx = frozenContext();

  // Пары «выражение → имя, которое обязано прозвучать». Выражения записаны так, как их
  // напишет автор шаблона, а не так, как удобно тесту.
  const CASES: readonly (readonly [string, string])[] = [
    ['Math.random()', 'Math.random'],
    ['Date.now()', 'Date.now'],
    ['new Date()', 'Date()'],
    ['Date()', 'Date()'],
    ['performance.now()', 'performance.now'],
    ['(5).toLocaleString()', 'Number.prototype.toLocaleString'],
    ["'a'.localeCompare('b')", 'String.prototype.localeCompare'],
    ['[1, 2].toLocaleString()', 'Array.prototype.toLocaleString'],
    ['Object.create(Date.prototype).toLocaleString()', 'Date.prototype.toLocaleString'],
    ['Object.create(Date.prototype).toLocaleDateString()', 'Date.prototype.toLocaleDateString'],
    ['Object.create(Date.prototype).toLocaleTimeString()', 'Date.prototype.toLocaleTimeString'],
    ['Intl', 'Intl'],
  ];

  for (const [expression, api] of CASES) {
    it(`\`${expression}\` ⇒ отказ с именем \`${api}\``, () => {
      const message = refusalOf(ctx, expression);
      expect(message, `\`${expression}\` не бросил — заморозка не сработала`).not.toBeNull();
      expect(message).toContain(api);
      expect(message).toContain('D4');
    });
  }

  it('`Intl` бросает на ЧТЕНИИ, а не только на вызове конструктора', () => {
    // Перечислять конструкторы поимённо значило бы завести список, устаревающий с новой
    // редакцией ECMA-402. Бросок на чтении покрывает и то, чего ещё нет.
    expect(refusalOf(ctx, 'typeof Intl')).toContain('Intl');
    expect(refusalOf(ctx, 'new Intl.NumberFormat("ru")')).toContain('Intl');
  });
});

describe('это ОТКАЗ, а не тихая подмена константой', () => {
  it('`Math.random` не возвращает число — ни 0.5, ни любое другое', () => {
    // Подмена на константу дала бы детерминированную картинку, в которой ЕСТЬ случайность,
    // просто всегда одна и та же: шаблон продолжил бы «работать», а компилятор так и не узнал
    // бы, что его попросили выдумать случайность.
    const ctx = frozenContext();
    const result = vm.runInContext(
      'var out; try { window.__VPE_FREEZE.run("клип", function () { out = { value: Math.random() }; }); }' +
        ' catch (e) { out = { threw: true }; } out;',
      ctx,
    ) as { value?: number; threw?: boolean };
    expect(result.threw).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('`Date.now` не возвращает ноль и не возвращает ничего', () => {
    const ctx = frozenContext();
    const result = vm.runInContext(
      'var out; try { window.__VPE_FREEZE.run("клип", function () { out = { value: Date.now() }; }); }' +
        ' catch (e) { out = { threw: true }; } out;',
      ctx,
    ) as { value?: number; threw?: boolean };
    expect(result.threw).toBe(true);
    expect(result.value).toBeUndefined();
  });
});

describe('окно охраны: взвод, снятие, адрес', () => {
  it('адрес взвода назван в отказе', () => {
    const ctx = frozenContext();
    const message = refusalOf(ctx, 'Math.random()', 'kenburns@1 (клип c:aaaa0001)');
    expect(message).toContain('kenburns@1 (клип c:aaaa0001)');
    expect(message).toContain('Math.random');
  });

  it('ВНЕ взвода те же API РАБОТАЮТ — иначе рендерер не запустится', () => {
    // Это не послабление, а измерение (`H-05`): инжектируемый рантайм HyperFrames читает часы
    // на своей инициализации, и безусловный бросок валит рендер целиком
    // (`window.__hf not ready after 45000ms`).
    const ctx = frozenContext();
    expect(typeof vm.runInContext('Date.now()', ctx)).toBe('number');
    expect(typeof vm.runInContext('Math.random()', ctx)).toBe('number');
    expect(vm.runInContext('new Date(0).getTime()', ctx)).toBe(0);
    expect(vm.runInContext('typeof Intl', ctx)).toBe('object');
  });

  it('снятие происходит и при БРОСКЕ шаблона: `finally`, а не после вызова', () => {
    // Иначе первый же отказ шаблона оставил бы guard взведённым на весь рендер, и настоящая
    // причина утонула бы во втором падении — уже рантайма рендерера.
    const ctx = frozenContext();
    expect(() =>
      vm.runInContext(
        'window.__VPE_FREEZE.run("клип", function () { throw new Error("шаблон упал"); });',
        ctx,
      ),
    ).toThrow('шаблон упал');
    expect(vm.runInContext('window.__VPE_FREEZE.armed()', ctx)).toBe(false);
    expect(typeof vm.runInContext('Date.now()', ctx)).toBe('number');
  });

  it('вложенный взвод — ОШИБКА, а не тихое расширение окна', () => {
    // `disarm` внутреннего окна потушил бы внешнее, и остаток кода шаблона поехал бы без
    // охраны — при зелёном тесте.
    const ctx = frozenContext();
    expect(() =>
      vm.runInContext(
        'window.__VPE_FREEZE.run("a", function () { window.__VPE_FREEZE.run("b", function () {}); });',
        ctx,
      ),
    ).toThrow('вложен');
  });

  it('отказ говорит, ОТКУДА брать значение законно (seed и номер кадра)', () => {
    // Сообщение об ошибке, которое запрещает и не предлагает замены, заставляет автора
    // искать обход. Здесь названы оба законных источника.
    const message = refusalOf(frozenContext(), 'Math.random()');
    expect(message).toContain('seed');
    expect(message).toContain('n/fps');
  });
});

describe('что заморозка НЕ ломает', () => {
  const ctx = frozenContext();

  it('`JSON.parse` разрешён явно: композиция читает `ir.json`', () => {
    expect(vm.runInContext('JSON.parse(\'{"a":1}\').a', ctx)).toBe(1);
  });

  it('`Date.parse`/`Date.UTC` живы: они чистые функции своего аргумента', () => {
    // Часов они не читают, и запрещать их значило бы запрещать арифметику дат вообще.
    expect(vm.runInContext('Date.UTC(2020, 0, 1)', ctx)).toBe(1577836800000);
    expect(vm.runInContext("Date.parse('2020-01-01T00:00:00Z')", ctx)).toBe(1577836800000);
  });

  it('`instanceof` по `Date` продолжает работать: запрет про часы, а не про типы', () => {
    expect(vm.runInContext('Object.create(Date.prototype) instanceof Date', ctx)).toBe(true);
  });

  it('`Date.parse` не сломан и ВО ВЗВОДЕ: он чистая функция аргумента', () => {
    const c2 = frozenContext();
    expect(
      vm.runInContext(
        'window.__VPE_FREEZE.run("клип", function () { return Date.parse("2020-01-01T00:00:00Z"); });',
        c2,
      ),
    ).toBe(1577836800000);
  });

  it('перечень заморожённого — ЗНАЧЕНИЕ, а не лог: «не смогло» отличимо от «сделано»', () => {
    // Без него молчаливо несработавшая заморозка выглядела бы как зелёный рендер.
    const frozen = vm.runInContext('window.__VPE_FROZEN.slice().sort()', ctx) as string[];
    expect(frozen).toEqual(
      [
        'Array.prototype.toLocaleString',
        'Date',
        'Date.now',
        'Date.prototype.toLocaleDateString',
        'Date.prototype.toLocaleString',
        'Date.prototype.toLocaleTimeString',
        'Intl',
        'Math.random',
        'Number.prototype.toLocaleString',
        'String.prototype.localeCompare',
        'performance.now',
      ].sort(),
    );
  });
});

describe('guard встроен в композицию и ВХОДИТ в `bundle.hash`', () => {
  /**
   * Материализует фикстуру ДВАЖДЫ и отдаёт `index.html` с перечнем каталога.
   *
   * Два прохода — не расточительство: `bundle.hash` есть величина ВХОДА, и узнать её можно
   * только построив каталог. Тот же приём у `render.test.ts` и, в настоящей сборке, у `L-01`.
   */
  function materialized(): { html: string; listing: MaterializedComposition['listing'] } {
    const fixture = makeFixture({ frames: 2 });
    let hash: string | undefined;
    try {
      materializeComposition(fixture.request, { registry: TEST_REGISTRY });
      throw new Error('ожидался отказ по `bundle.hash`: фикстура несёт `UNSET_HASH`');
    } catch (err) {
      hash = /имеет `([0-9a-f]{64})`/u.exec(String((err as Error).message))?.[1];
    }
    if (hash === undefined) throw new Error('хэш каталога не удалось прочитать из отказа');
    const request = withPatch(fixture.request, {
      bundle: { ...fixture.request.bundle, hash },
    });
    const out = materializeComposition(request, { registry: TEST_REGISTRY });
    const html = readFileSync(path.join(request.bundle.path, 'index.html'), 'utf8');
    return { html, listing: out.listing };
  }

  it('порядок в `index.html`: GSAP → guard → реестр шаблонов → runtime', () => {
    // Порядок ИЗМЕРЕН (`H-05`): GSAP захватывает часы на загрузке, поэтому guard не может
    // стоять раньше него; и он обязан стоять раньше РЕЕСТРА — модульный код шаблона
    // исполняется при построении объекта `__VPE_TEMPLATES`, и шаблон, укравший случайность
    // в замыкание на загрузке, — ровно та дыра, ради которой guard написан.
    const { html } = materialized();
    // Маркеры — ИСПОЛНЯЕМЫЕ строки, а не имена: имена встречаются и в комментариях самого
    // guard`а, и тест на них мерил бы позицию объяснения, а не позицию кода.
    const gsap = html.indexOf('vendor/gsap.min.js');
    const guard = html.indexOf('W.__VPE_FROZEN = guarded;');
    const registry = html.indexOf('window.__VPE_TEMPLATES = window.__VPE_FREEZE.run(');
    const runtime = html.indexOf('window.__VPE_IR = JSON.parse');
    expect(gsap).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(gsap);
    expect(registry).toBeGreaterThan(guard);
    expect(runtime).toBeGreaterThan(guard);
  });

  it('текст guard`а встроен ЦЕЛИКОМ, а не подключён тегом `src`', () => {
    // ИЗМЕРЕНО (`H-01`): отдельный `<script src>` компилятор рендерера не разворачивает.
    const { html } = materialized();
    expect(html).toContain('W.__VPE_FREEZE = {');
    expect(html).toContain('D4 (ADR-0007 §4)');
    expect(html).not.toContain('src="./freeze.js"');
  });

  it('байты guard`а — слагаемое `compositionHash`: снятие меняет ключ', () => {
    // Утверждение не про то, что «`index.html` в перечне» (это тавтология), а про то, что
    // ИМЕННО текст guard`а меняет хэш: перечень пересчитывается с `index.html` БЕЗ guard`а.
    const { html, listing } = materialized();
    expect(listing.length).toBeGreaterThan(0);
    const withGuard = compositionHashOf(listing);

    const stripped = html.slice(0, html.indexOf('<!--')) + html.slice(html.indexOf('<style>'));
    expect(stripped).not.toContain('__VPE_FROZEN');
    const patched = listing.map((entry) =>
      entry.path === 'index.html' ? { ...entry, sha256: sha256Of(stripped) } : entry,
    );
    expect(compositionHashOf(patched)).not.toBe(withGuard);
  });
});

/** sha256 текста — тот же способ, каким считает перечень материализация. */
function sha256Of(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(Buffer.from(text)).digest('hex');
}
