// Юниты пяти реализаций (`H-06`) — **БЕЗ БРАУЗЕРА**. Живой гейт — соседние файлы
// `templates-gate.test.ts` и `templates-gate-final.test.ts`.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО. Реализация уезжает в композицию СТРОКОЙ, и
// `tsc` внутрь строки не смотрит: всё, что там написано, для компилятора — текст. Значит
// охранники, которые для обычного кода даёт тип, здесь приходится ставить руками:
//   1. текст парсится как выражение-функция арности 2 — иначе композиция упадёт на загрузке;
//   2. каждый easing-литерал принадлежит закрытому реестру **D5** И объявлен манифестом
//      своего спека (нарушение Н1 протокола обязано краснеть ЗДЕСЬ: линт
//      `tests/lints/d5-easing-render-path.test.ts` стережёт только `Math.pow`/`sin`/`exp`);
//   3. ни один `mountSource` не ПРИСВАИВАЕТ `style.transform` — вторая половина охраны
//      порядка трансформаций (долг №173; первая половина — самопроверка внутри `kenburns@1`);
//   4. состав реестра реализаций совпадает с `TEMPLATE_LIBRARY` спеков поимённо (Н4:
//      реализация без спека и спек без реализации — две разные ошибки, обе видны только
//      сверкой в обе стороны);
//   5. **форма DOM, на которую опираются реализации** (поправка владельца П1-а) — двусторонний
//      охранник: правка `runtime.js`, переименовавшая `.layer` или убравшая `#captions`,
//      краснеет здесь, а не в браузере через десять минут прогона.
//
// ФИКСТУРА ЗДЕСЬ — `fixtures/minimal/direction/01-intro.yaml`, и она читается ЧЕРЕЗ
// `templates-spec`, а не своим разбором: `params` пяти шаблонов обязаны проходить схему СПЕКА,
// иначе реализация написана под форму, которой в проекте нет.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDirection } from '@vpe/core-model';
import { EASING_REGISTRY, TEMPLATE_LIBRARY, createRegistry, isEasingId } from '@vpe/templates-spec';
import { describe, expect, it } from 'vitest';

import { rendererTemplates, resolveTemplate, type RendererTemplate } from '../src/templates/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const RUNTIME_JS = readFileSync(
  path.join(ROOT, 'packages/renderer-hyperframes/src/composition/runtime.js'),
  'utf8',
);

const DIRECTION = path.join(ROOT, 'fixtures/minimal/direction/01-intro.yaml');

const specs = createRegistry(TEMPLATE_LIBRARY);
const impls: readonly RendererTemplate[] = rendererTemplates.templates;
const callOf = (t: RendererTemplate): string => `${t.templateId}@${String(t.templateVersion)}`;

/**
 * Разбирает текст `mountSource` как ВЫРАЖЕНИЕ-функцию — ровно так, как это делает браузер,
 * когда материализация подставляет его в литерал объекта `__VPE_TEMPLATES`.
 *
 * `new Function('return (' + src + ')')` — не «почти как в браузере», а тот же самый разбор:
 * реестр композиции собирается конкатенацией без сборщика (ADR-0009), и синтаксическая ошибка
 * внутри текста роняет ВСЮ страницу, а не один шаблон. Функция при этом не ВЫЗЫВАЕТСЯ: у неё
 * нет ни `document`, ни `ctx`, и вызов здесь проверял бы наличие DOM, а не форму текста.
 */
function parseMount(source: string): (...args: unknown[]) => unknown {
  const made: unknown = new Function(`return (${source});`)();
  if (typeof made !== 'function') throw new Error('текст не является выражением-функцией');
  return made as (...args: unknown[]) => unknown;
}

describe('`H-06` — реестр реализаций совпадает с библиотекой спеков', () => {
  it('пять реализаций, версия реестра не менялась', () => {
    expect(impls).toHaveLength(5);
    // Версия — та же величина, что у спеков (**K6**). Наполнение реестра её не меняет:
    // сменилась бы она — сменились бы ключи кэша ВСЕХ сегментов ради появления кода,
    // которого до `H-06` просто не звали.
    expect(rendererTemplates.version).toBe('1');
  });

  it('**Н4** сверка в ОБЕ стороны: реализация без спека и спек без реализации', () => {
    const implNames = impls.map(callOf).sort();
    const specNames = [...specs.names].sort();
    expect(implNames).toEqual(specNames);
  });

  it('каждая реализация находится по имени вызова через `resolveTemplate`', () => {
    for (const impl of impls) {
      expect(resolveTemplate(rendererTemplates, callOf(impl), 'тест').mountSource).toBe(
        impl.mountSource,
      );
    }
  });

  it('шаблон без реализации — отказ `V3` ДО браузера (правило не ослабло)', () => {
    expect(() => resolveTemplate(rendererTemplates, 'shaderBg@1', 'тест')).toThrow(/V3|реализации/u);
  });
});

describe('`H-06` — `mountSource` каждого шаблона есть валидное выражение-функция', () => {
  for (const impl of impls) {
    it(`\`${callOf(impl)}\`: парсится и принимает ровно \`(host, ctx)\``, () => {
      const fn = parseMount(impl.mountSource);
      expect(fn.length).toBe(2);
    });
  }

  it('ОХРАННИК СРАБАТЫВАЕТ: сломанный текст не парсится', () => {
    // Иначе предыдущий блок доказывал бы только «`new Function` ничего не сказал».
    expect(() => parseMount('function (host, ctx) { var x = ;}')).toThrow();
    expect(() => parseMount('{ "не": "функция" }')).toThrow('не является выражением-функцией');
  });
});

describe('**Н1** — easing только из закрытого реестра **D5** и только объявленный манифестом', () => {
  /** Все строковые литералы текста — в одинарных и двойных кавычках. */
  const literalsOf = (source: string): string[] =>
    [...source.matchAll(/'([^'\\]*)'|"([^"\\]*)"/gu)].map((m) => m[1] ?? m[2] ?? '');

  for (const impl of impls) {
    it(`\`${callOf(impl)}\`: ни одной кривой вне реестра, все объявлены спеком`, () => {
      const declared = specs.resolve(callOf(impl)).manifest.easingIds;
      const used = literalsOf(impl.mountSource).filter((s) => isEasingId(s));
      for (const easing of used) {
        expect(declared, `${callOf(impl)}: кривая \`${easing}\` не объявлена манифестом`).toContain(
          easing,
        );
      }
    });
  }

  it('ОХРАННИК СРАБАТЫВАЕТ: кривая вне реестра ловится, соседний текст — нет', () => {
    // Проба — то, что напишет автор шаблона, а не то, что удобно тесту.
    expect(literalsOf(`var e = 'inOutCubic';`).filter(isEasingId)).toEqual([]);
    expect(literalsOf(`var e = 'power2.inOut';`).filter(isEasingId)).toEqual(['power2.inOut']);
    // Реестр закрыт шестью именами — тест обязан знать это число, а не «сколько получится».
    expect(EASING_REGISTRY).toHaveLength(6);
  });
});

describe('**№173** — порядок трансформаций собирает gsap, а не рука', () => {
  it('ни один `mountSource` не ПРИСВАИВАЕТ `style.transform`', () => {
    // Первая половина охраны (самопроверка внутри `kenburns@1`) ловит СМЕНИВШИЙСЯ gsap.
    // Эта — руку, собравшую `transform` строкой в обратном порядке: такая правка мимо
    // объектной формы прошла бы самопроверку, потому что gsap её не касался.
    const offenders = impls
      .filter((t) => /\.style\.transform\s*=/u.test(t.mountSource))
      .map(callOf);
    expect(
      offenders,
      'Сдвиг и масштаб передаются ОБЪЕКТНОЙ формой gsap (`{x, y, scale}`): порядок сборки — ' +
        'данные реестра (`TRANSFORM_ORDER`, ADR-0007 §3), а не то, что напишет автор. ' +
        '`FACT` (SP-3c §6.2 п. 3): при обратном порядке сдвиг масштабируется — до 5.4 px на ' +
        'последнем кадре Ken Burns.',
    ).toEqual([]);
  });

  it('`kenburns@1` ссылается на ОБА имени `TRANSFORM_ORDER` и отказывает по ним', () => {
    const source = resolveTemplate(rendererTemplates, 'kenburns@1', 'тест').mountSource;
    // Двойные кавычки — потому что имена интерполируются `canonicalJson` (`JSON.stringify`
    // запрещён линтом `S-01` в `src/**`), а он даёт JSON-литерал.
    expect(source).toContain('indexOf("translate")');
    expect(source).toContain('indexOf("scale")');
    // Отказ, а не подстройка: константа участвует в тексте ошибки.
    expect(source).toContain('translate → scale');
  });

  it('ОХРАННИК СРАБАТЫВАЕТ: ручная сборка `transform` — находка', () => {
    const probe = `function (host, ctx) { host.style.transform = 'scale(2) translate(1px)'; }`;
    expect(/\.style\.transform\s*=/u.test(probe)).toBe(true);
    // Чтение — не присвоение: самопроверка `kenburns@1` не должна ловить сама себя.
    expect(/\.style\.transform\s*=/u.test('var b = host.style.transform;')).toBe(false);
  });
});

describe('`H-06` — `params` фикстуры проходят схему СПЕКА (реализация написана под них)', () => {
  const records = parseDirection({
    filePath: 'fixtures/minimal/direction/01-intro.yaml',
    text: readFileSync(DIRECTION, 'utf8'),
  }).records.filter((r) => r.track !== 'voice');

  it('фикстура зовёт ровно пять шаблонов — тех, у которых есть реализация', () => {
    expect([...new Set(records.map((r) => r.template))].sort()).toEqual(impls.map(callOf).sort());
  });

  for (const record of records) {
    it(`\`${record.template}\`: \`params\` записи разбираются схемой`, () => {
      expect(() => specs.resolve(record.template).paramsSchema.parse(record.params)).not.toThrow();
    });
  }
});

describe('**П1-а** — форма DOM, на которую опираются реализации (двусторонний охранник)', () => {
  // ПОЧЕМУ ГРЕП, А НЕ DOM. jsdom в этом пакете нет и заводить его ради пяти утверждений
  // значило бы проверять пересказ браузера вместо самого `runtime.js`. Здесь стережётся
  // ровно КОНТРАКТ: имена классов, идентификаторов и атрибутов, которые реализации читают.
  // Правка `runtime.js`, сменившая любое из них, краснеет здесь — до браузера.

  it('слой клипа — `div` с классом `layer`, и слои добавляются В ПОРЯДКЕ `IR.clips`', () => {
    // `kenburns@1` берёт цель как `previousElementSibling` и проверяет `className === "layer"`.
    expect(RUNTIME_JS).toContain("host.className = 'layer'");
    expect(RUNTIME_JS).toContain('root.appendChild(host)');
    // Порядок массива — уже ранг по `(z, sourceOrdinal, clipId)`, посчитанный `CP-04`.
    expect(RUNTIME_JS).toContain('for (var i = 0; i < IR.clips.length; i++)');
  });

  it('слой субтитров — `#captions`, и стилей runtime ему не ставит', () => {
    // `captionEmphasis@1` находит его через `document.getElementById('captions')`.
    expect(RUNTIME_JS).toContain("caps.id = 'captions'");
    expect(RUNTIME_JS).toContain("caps.className = 'layer'");
    expect(RUNTIME_JS).toContain("caps.style.zIndex = '1000'");
    // Ни одного стиля оформления: они принадлежат шаблону (то самое место `runtime.js`,
    // где это сказано словами). Появится здесь `fontSize` — оформление станет двойным.
    expect(RUNTIME_JS).not.toContain('caps.style.fontSize');
    expect(RUNTIME_JS).not.toContain('caps.style.fontFamily');
  });

  it('группа субтитров несёт класс и окно В СЕКУНДАХ — их читает `captionEmphasis@1`', () => {
    expect(RUNTIME_JS).toContain("el.className = 'caption-group'");
    expect(RUNTIME_JS).toContain("el.setAttribute('data-start'");
    expect(RUNTIME_JS).toContain("el.setAttribute('data-duration'");
  });

  it('реализации читают ровно эти имена — и ни одного лишнего окна из `clip.frames`', () => {
    const kenburns = resolveTemplate(rendererTemplates, 'kenburns@1', 'тест').mountSource;
    const captions = resolveTemplate(rendererTemplates, 'captionEmphasis@1', 'тест').mountSource;
    expect(kenburns).toContain('previousElementSibling');
    expect(kenburns).toContain("target.className !== 'layer'");
    // `captionEmphasis@1` больше не трогает узлы руками: он целится СЕЛЕКТОРАМИ, потому что
    // слоя на монтировании ещё нет (решение владельца R2). Значит зависимость от формы DOM
    // осталась той же, но выражена в CSS — и стеречь надо именно селекторы.
    expect(captions).toContain("'#captions {'");
    expect(captions).toContain("'#captions .caption-group {'");

    // **ДОЛГ №168 НЕ РАСШИРЯЕТСЯ**: окно КЛИПА берётся только из `ctx.frames`, и ни одна
    // реализация не читает `clip.frames` напрямую. `L-01` обязан править одно место, а не пять.
    for (const impl of impls) {
      expect(impl.mountSource, callOf(impl)).not.toContain('clip.frames');
      expect(impl.mountSource, callOf(impl)).not.toContain('frameStart');
      expect(impl.mountSource, callOf(impl)).not.toContain('frameEnd');
    }
  });
});

describe('`captionEmphasis@1` — механизм эмфазы под охраной, раз пиксели его не ловят', () => {
  // Пиксельного охранника у эмфазы быть не может: `FACT` (`H-06`) на единственном
  // font-record проекта (`DejaVuSans-Bold.ttf`) `bold` и `normal` дают побайтово равные
  // кадры — синтетическое утолщение Chrome поверх жирных глифов не накладывает. Значит
  // механизм обязан стеречься здесь, иначе он мог бы умереть молча — ровно как умер
  // `{attr: …}`, которого нет в завендоренном ядре gsap.
  const source = resolveTemplate(rendererTemplates, 'captionEmphasis@1', 'тест').mountSource;

  it('правило полосы читает переменную, а не фиксированное начертание', () => {
    expect(source).toContain('font-weight: var(');
    expect(source).toContain('--vpe-caption-weight');
  });

  it('переменная ставится ТАЙМЛАЙНОМ на корне документа, на обеих границах окна', () => {
    expect(source).toContain('ctx.timeline.set(document.documentElement, emph, ctx.toSeconds(ctx.frames.start))');
    expect(source).toContain('ctx.timeline.set(document.documentElement, base, ctx.toSeconds(ctx.frames.end))');
  });

  it('значения — КЛЮЧЕВЫЕ СЛОВА: числу gsap дописал бы единицу и правило стало бы невалидным', () => {
    expect(source).toContain('"bold"');
    expect(source).toContain('"normal"');
    expect(source).not.toMatch(/--vpe-caption-weight"\]\s*=\s*"\d/u);
  });

  it('ни `attr`, ни твина по СЕЛЕКТОРУ: обоих механизмов в КОДЕ нет', () => {
    // `attr` — плагина нет в ядре gsap 3.15.0; селектор gsap резолвит на СОЗДАНИИ твина,
    // когда слоя `#captions` ещё не существует. Оба дали бы тихий no-op.
    //
    // Греп идёт по КОДУ: сам шаблон объясняет оба отказа словами в комментариях, и краснеть
    // на собственном объяснении охранник не вправе — то же правило, что у линтов D4/D5.
    const code = source
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');
    expect(code).not.toContain('attr:');
    expect(code).not.toContain("ctx.timeline.set('#captions'");
  });

  it('инъекция идемпотентна: второй клип эмфазы правил не удваивает (поправка П4)', () => {
    expect(source).toContain("document.getElementById(\"vpe-caption-band\") === null");
  });
});

describe('`bed@1` — реализация-ОТКАЗ (решение владельца, развилка «б», вариант б3)', () => {
  it('вызов `mount` бросает и называет причину: аудио-домен, а не пустая сцена', () => {
    const fn = parseMount(resolveTemplate(rendererTemplates, 'bed@1', 'тест').mountSource);
    expect(() => fn(null, null)).toThrow(/АУДИО-домена/u);
    expect(() => fn(null, null)).toThrow(/AudioPlan/u);
  });

  it('он всё-таки ЗАРЕГИСТРИРОВАН: отсутствие отличалось бы от отказа только молчанием', () => {
    expect(impls.map(callOf)).toContain('bed@1');
    expect(specs.resolve('bed@1').manifest.msPerFrameBudget).toBe(0);
  });
});
