// Юниты ~~пяти~~ **шести** реализаций (`H-06`, шестая — `E-07`) — **БЕЗ БРАУЗЕРА**. Живой
// гейт — соседние файлы `templates-gate.test.ts` и `templates-gate-final.test.ts`.
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
  it('семь реализаций, версия реестра не менялась', () => {
    // ~~Пять~~ ~~шесть~~ СЕМЬ: `grade@1` (`E-07`), `parallax25@1` (`E-02`). Число стоит
    // ЛИТЕРАЛОМ, а не `TEMPLATE_LIBRARY.length`, — иначе сверка «столько, сколько
    // получилось» была бы зелёной при любом наполнении.
    expect(impls).toHaveLength(7);
    // Версия — та же величина, что у спеков (**K6**). Наполнение реестра её не меняет:
    // сменилась бы она — сменились бы ключи кэша ВСЕХ сегментов ради появления кода,
    // которого до `H-06` просто не звали. То же рассуждение действует и на шестой шаблон
    // (`E-07`), и на седьмой (`E-02`): ни один существующий сегмент ни `grade@1`, ни
    // `parallax25@1` не зовёт.
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

  /**
   * **ЧТО СЧИТАЕТСЯ «ПОХОЖИМ НА ИМЯ КРИВОЙ» — И ПОЧЕМУ ФИЛЬТР ИМЕННО ТАКОЙ** (долг №184).
   *
   * ~~Прежде здесь стоял `isEasingId`.~~ *(изменено: `FIX-01`, 2026-08-29.)* Это была ДЫРА, и
   * она измерена (`H-06`, протокол нарушений Н1в): фильтр по ЧЛЕНСТВУ В РЕЕСТРЕ отбрасывает
   * имя ВНЕ реестра вместе с прочим текстом — то есть проверял обратный случай («имя ИЗ
   * реестра, не объявленное манифестом») и молчал на том, ради чего написан. `ease:
   * 'elastic.out'` в тексте `flash@1` проходил `tsc` (текст функции есть строка, `satisfies
   * EasingId` его не видит), проходил этот юнит, проходил линт D5 (он ищет `Math.pow/sin/exp`)
   * и **проходил гейт V13**: три прогона дали один `sha256`, класс PASS — на кадрах, которых
   * объявленная кривая не рисует.
   *
   * ФОРМА ВЫБРАНА ИЗМЕРЕНИЕМ, А НЕ НА ВКУС: `<слово>.<слово>` с необязательными скобками
   * (иначе мимо прошёл бы `back.out(2.5)` при законном `back.out(1.7)` в реестре) плюс точное
   * `none` — линейная кривая пишется без точки. `FACT` (`FIX-01`): по РАЗРЕШЁННЫМ текстам всех
   * пяти реализаций плюс синтетического `solid@1` — **102 строковых литерала, 1 срабатывание**
   * (`power3.out`, объявлен), то есть ложных сегодня НОЛЬ.
   *
   * ЧТО ФОРМА НЕ ЛОВИТ, И ЭТО НАЗВАНО, А НЕ СПРЯТАНО: односложные имена без точки (`'linear'`)
   * неотличимы от значения CSS, и ловить их значило бы краснеть на половине текста шаблона.
   * Долг заведён.
   *
   * ПОЧЕМУ ЮНИТ, А НЕ ГРЕП В `tests/lints/`: здесь виден РАЗРЕШЁННЫЙ `mountSource` — тот
   * текст, который уезжает в браузер, вместе с интерполяциями (`TRANSFORM_ORDER` и соседи).
   * Греп по исходнику их не видит и вдобавок тащит четыре ложных из `freeze.js`
   * (`Array.prototype` и соседи) — измерено там же.
   */
  const looksLikeEasing = (s: string): boolean =>
    /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*(\([^)]*\))?$|^none$/u.test(s);

  for (const impl of impls) {
    it(`\`${callOf(impl)}\`: ни одной кривой вне реестра, все объявлены спеком`, () => {
      const declared = specs.resolve(callOf(impl)).manifest.easingIds;
      const used = literalsOf(impl.mountSource).filter(looksLikeEasing);
      for (const easing of used) {
        // ПЕРВЫЙ вопрос — членство в реестре **D5**. Он и был не задан.
        expect(
          isEasingId(easing),
          `${callOf(impl)}: литерал \`${easing}\` похож на имя кривой, но реестра D5 в нём ` +
            'нет. Текст `mountSource` — строка, и `satisfies EasingId` её не проверяет: кривая ' +
            'вне реестра доезжает до кадров и получает запись гейта (измерено `H-06`, Н1в)',
        ).toBe(true);
        // ВТОРОЙ — объявленность манифестом; прежний вопрос, он остаётся.
        expect(declared, `${callOf(impl)}: кривая \`${easing}\` не объявлена манифестом`).toContain(
          easing,
        );
      }
    });
  }

  it('ОХРАННИК СРАБАТЫВАЕТ: **вставка Н1в краснеет**, соседний текст — нет', () => {
    // Дословно то, чем ломали шаблон в протоколе `H-06` (Н1в) и чем ломают в `FIX-01` (Н3).
    const н1в = literalsOf(`{opacity: 0, duration: span, ease: 'elastic.out'}`).filter(looksLikeEasing);
    expect(н1в).toEqual(['elastic.out']);
    expect(н1в.every(isEasingId), 'кривая вне реестра обязана НЕ пройти членство').toBe(false);
    // Законная кривая со скобками — проходит обе проверки; без скобок в форме её бы потеряли.
    expect(literalsOf(`ease: 'back.out(1.7)'`).filter(looksLikeEasing)).toEqual(['back.out(1.7)']);
    expect(isEasingId('back.out(1.7)')).toBe(true);
    // Соседний текст шаблонов — НЕ кривые: измерено на реальных литералах реализаций.
    for (const notCurve of ['cover', '#ffffff', '50%', 'bold', 'normal', 'transform', 'asset']) {
      expect(looksLikeEasing(notCurve), `\`${notCurve}\` принят за кривую`).toBe(false);
    }
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

  // **РАЗНИЦА МЕЖДУ РЕЕСТРОМ И ФИКСТУРОЙ НАЗВАНА СПИСКОМ** (решение владельца `E-07`).
  // ~~Прежде здесь стояло равенство множеств.~~ Оно держалось само собой, пока все шаблоны
  // библиотеки приезжали из фикстуры; `grade@1` — первый шаблон среза `mvp` (roadmap §3),
  // которого `fixtures/minimal` не зовёт, а править фикстуру задание `E-07` запрещает.
  // Ослабить охранника до одностороннего («фикстура ⊆ реестр») было бы дешевле и хуже:
  // седьмой молча добавленный шаблон прошёл бы. Поэтому проверяются ОБА направления, а
  // разница — ровно перечисленная ниже. *(дополнено: `E-02`, 2026-08-31 — имён стало ДВА;
  // `parallax25@1` фикстура не зовёт и звать не может, её режиссура правке не подлежит.)*
  const NOT_IN_FIXTURE = ['grade@1', 'parallax25@1'];

  it('фикстура ⊆ реестр, а разница — ровно `grade@1` и `parallax25@1`, ничего сверх', () => {
    const used = [...new Set(records.map((r) => r.template))].sort();
    const known = impls.map(callOf).sort();
    // Направление 1: каждый вызов фикстуры имеет реализацию.
    expect(known).toEqual(expect.arrayContaining(used));
    // Направление 2: всё, что есть в реестре сверх фикстуры, НАЗВАНО поимённо.
    expect(known.filter((name) => !used.includes(name))).toEqual(NOT_IN_FIXTURE);
    // И счёт сходится: пять вызовов фикстуры + ДВА названных имени = семь реализаций.
    expect(used).toHaveLength(5);
    expect(known).toHaveLength(used.length + NOT_IN_FIXTURE.length);
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

  it('слой субтитров — `#captions`, и оформление ему ставит ПРАВИЛО, а не узлу стиль', () => {
    // `captionEmphasis@1` находит его через селектор `#captions` (своей инъекцией).
    expect(RUNTIME_JS).toContain("caps.id = 'captions'");
    expect(RUNTIME_JS).toContain("caps.className = 'layer'");
    expect(RUNTIME_JS).toContain("caps.style.zIndex = '1000'");
    // ~~Ни одного стиля оформления: они принадлежат шаблону.~~ *(изменено: `H-07`,
    // 2026-08-31, решение владельца — раскладка полосы есть свойство ТРЕКА.)* Форма осталась
    // прежней и стережётся дальше: оформление едет ПРАВИЛОМ CSS, а не простановкой стилей
    // узлам. Два способа оформлять одну полосу — два места, где живёт её вид.
    expect(RUNTIME_JS).not.toContain('caps.style.fontSize');
    expect(RUNTIME_JS).not.toContain('caps.style.fontFamily');
    expect(RUNTIME_JS).toContain("bandStyle.id = 'vpe-caption-track'");
    expect(RUNTIME_JS).toContain('document.head.appendChild(bandStyle)');
  });

  it('группа субтитров несёт класс и окно В СЕКУНДАХ — их читает РЕНДЕРЕР', () => {
    expect(RUNTIME_JS).toContain("el.className = 'caption-group'");
    expect(RUNTIME_JS).toContain("el.setAttribute('data-start'");
    expect(RUNTIME_JS).toContain("el.setAttribute('data-duration'");
  });

  it('**H-07** — раскладка полосы живёт в `runtime.js`, и это ПРАВИЛА, а не два места', () => {
    // Что обязано быть в правиле трека: позиция, ширина, кегль, межстрочный, цвет, тень и
    // НЕПРОЗРАЧНАЯ плашка (решение владельца `H-07`, вариант «б»: условие применимости
    // **R13** остаётся в силе, мягкость края даётся скруглением и растушёвкой тенью).
    for (const rule of [
      "'#captions .caption-group {'",
      "'#captions .caption-plate {'",
      "'#captions .caption-word {'",
      "'  position: absolute;'",
      "'  text-align: center;'",
    ]) {
      expect(RUNTIME_JS).toContain(rule);
    }
    expect(RUNTIME_JS).toContain('BAND.fontSizePx');
    expect(RUNTIME_JS).toContain('BAND.plateColor');
    // Плашка НЕПРОЗРАЧНА: ни `rgba(`, ни `opacity` в её цвете. Прозрачность пустила бы под
    // текст движущееся фото, и прибор **R13** (`H-02`) мерил бы фон вместо смены строки.
    expect(RUNTIME_JS).toMatch(/plateColor: '#[0-9a-f]{6}'/u);
    // И ни одного числа раскладки не осталось у шаблона: иначе их стало бы два комплекта.
    const captions = resolveTemplate(rendererTemplates, 'captionEmphasis@1', 'тест').mountSource;
    for (const gone of ['bottom:', 'font-size:', 'line-height:', 'background:', 'text-align:']) {
      expect(captions, `у шаблона осталась раскладка: ${gone}`).not.toContain(gone);
    }
  });

  it('**H-07** — слово-`span` НЕ несёт `data-start`: вендор спрятал бы его, а не выделил', () => {
    // ИЗМЕРЕНО по коду вендора (`hyperframes@0.8.5`): клипы он собирает из `[data-start]` и
    // ставит такому элементу `style.visibility = 'hidden'` вне окна. Слово с собственным
    // окном ИСЧЕЗАЛО БЫ из строки. Поэтому время слова едет таймлайном, а `data-frame-*`
    // остаются справочными. Утверждение явное — поправка владельца `H-07`.
    expect(RUNTIME_JS).toContain("word.className = token.highlight ? 'caption-word caption-token' : 'caption-word'");
    expect(RUNTIME_JS).toContain("word.setAttribute('data-frame-start'");
    expect(RUNTIME_JS).not.toContain("word.setAttribute('data-start'");
    expect(RUNTIME_JS).not.toContain("word.setAttribute('data-duration'");
    // Пословная разметка вообще существует — иначе красить в строке нечего.
    expect(RUNTIME_JS).toContain('word.textContent = token.text');
    // И вход ПРОВЕРЯЕТСЯ, а не предполагается: `text` группы есть `tokens.join(' ')`.
    expect(RUNTIME_JS).toContain("words.join(' ') !== group.text");
  });

  it('**H-07** — окно слова открывает наследование, а не красит: значение — `inherit`', () => {
    // Сцепка двух окон: трек говорит КОГДА и КОМУ, шаблон — ЧЕМ. Общего у них только пара
    // имён переменных; чисел эмфазы в треке нет, чисел раскладки в шаблоне нет.
    expect(RUNTIME_JS).toContain("on[WEIGHT_VAR] = 'inherit'");
    expect(RUNTIME_JS).toContain("on[COLOR_VAR] = 'inherit'");
    expect(RUNTIME_JS).toContain('tl.set(word, on, toSeconds(token.highlight.frameStart))');
    expect(RUNTIME_JS).toContain('tl.set(word, off, toSeconds(token.highlight.frameEnd))');
    expect(RUNTIME_JS).toContain("var WEIGHT_VAR = '--vpe-caption-weight'");
    expect(RUNTIME_JS).toContain("var COLOR_VAR = '--vpe-caption-color'");
  });

  it('реализации читают ровно эти имена — и ни одного лишнего окна из `clip.frames`', () => {
    const kenburns = resolveTemplate(rendererTemplates, 'kenburns@1', 'тест').mountSource;
    const captions = resolveTemplate(rendererTemplates, 'captionEmphasis@1', 'тест').mountSource;
    expect(kenburns).toContain('previousElementSibling');
    expect(kenburns).toContain("target.className !== 'layer'");
    // `captionEmphasis@1` больше не трогает узлы руками: он целится СЕЛЕКТОРАМИ, потому что
    // слоя на монтировании ещё нет (решение владельца R2). Значит зависимость от формы DOM
    // осталась той же, но выражена в CSS — и стеречь надо именно селекторы.
    // ~~`captionEmphasis@1` целится в полосу целиком.~~ *(изменено: `H-07` — раскладка
    // уехала в трек, у шаблона остался ОДИН селектор: семейство шрифта.)*
    expect(captions).toContain("'#captions {'");
    expect(captions).not.toContain("'#captions .caption-group {'");

    // ~~**ДОЛГ №168 НЕ РАСШИРЯЕТСЯ**~~ *(изменено: `L-01`, 2026-08-30 — долг ЗАКРЫТ стороной
    // модели.)* Читалось это так: «окно клипа берётся только из `ctx.frames`, ни одна
    // реализация не читает `clip.frames` напрямую, и `L-01` правит одно место, а не пять».
    // Первая половина осталась ровно той же и стережётся ниже; вторая исполнена: форм больше
    // не две, канон — `FrameInterval` модели (`{frameStart, frameEnd}`), и теперь охранник
    // держит ЕЁ, а не отсутствие её имён.
    for (const impl of impls) {
      expect(impl.mountSource, callOf(impl)).not.toContain('clip.frames');
      // Форма рантайма мертва: `ctx.frames.start`/`.end` на модельном IR дали бы `NaN`-окно
      // и невидимый клип — ровно то, чем долг №168 и был опасен.
      expect(impl.mountSource, callOf(impl)).not.toContain('ctx.frames.start');
      expect(impl.mountSource, callOf(impl)).not.toContain('ctx.frames.end');
    }

    // ОКНО ЧИТАЮТ НЕ ВСЕ, И ЭТО НЕ ДЫРА В ОХРАННИКЕ: `still@1`, `flash@1`, `kenburns@1`,
    // `captionEmphasis@1`, `grade@1` и `parallax25@1` окном пользуются, а `bed@1` —
    // реализация-отказ (аудио-домен, долг №189), и кадров у него нет по построению. Поэтому
    // проверяется не «каждый читает», а «кто читает — читает модельной парой имён»; пустой
    // список читателей был бы зелёным охранником ни о чём, и от этого стережёт счёт.
    // *(число: 4 → 5, `E-07` — `grade@1` открывает и закрывает окно двумя `set`, как
    // `still@1`; 5 → 6, `E-02` — `parallax25@1` делает то же и вдобавок берёт из окна
    // ДЛИТЕЛЬНОСТЬ хода.)*
    const readers = impls.filter((impl) => impl.mountSource.includes('ctx.frames.'));
    expect(readers).toHaveLength(6);
    for (const impl of readers) {
      expect(
        impl.mountSource.includes('ctx.frames.frameStart') ||
          impl.mountSource.includes('ctx.frames.frameEnd'),
        callOf(impl),
      ).toBe(true);
    }
  });
});

describe('`captionEmphasis@1` — механизм эмфазы под охраной, раз пиксели его не ловят', () => {
  // ~~Пиксельного охранника у эмфазы быть не может.~~ *(изменено: `H-07`, 2026-08-31.)*
  // Он появился: с вариативным шрифтом проекта `bold` и базовое начертание дают РАЗНЫЕ кадры
  // ([`captions-visibility.test.ts`](./captions-visibility.test.ts), утверждение перевёрнуто).
  // Причина, по которой охранник ЗДЕСЬ всё равно остаётся: пиксель ловит «эмфаза видна», а
  // здесь стережётся, каким именно механизмом она сделана, — а умереть молча могут оба
  // отвергнутых (`{attr: …}` и твин по селектору), и тогда пиксельный тест покраснеет, не
  // сказав почему.
  const source = resolveTemplate(rendererTemplates, 'captionEmphasis@1', 'тест').mountSource;

  it('шаблон объявляет ПАЛИТРУ (вес + тёплый цвет), а правило полосы — у трека', () => {
    // Правило `font-weight: var(…)` переехало в `runtime.js` вместе со всей раскладкой; у
    // шаблона остались только ЗНАЧЕНИЯ и пара имён, по которой они попадают в слово.
    expect(source).toContain('--vpe-caption-weight');
    expect(source).toContain('--vpe-caption-color');
    expect(source).not.toContain('font-weight: var(');
    expect(RUNTIME_JS).toContain('font-weight: var(');
    // Тёплый акцент — вторая половина решения владельца `H-07`: жирность одна на телефоне
    // не читается. Цвет обязан быть НАЗВАН, иначе эмфаза снова станет только весом.
    expect(source).toMatch(/#[0-9a-f]{6}/u);
  });

  it('переменные ставятся ТАЙМЛАЙНОМ на корне документа, на обеих границах окна', () => {
    expect(source).toContain(
      'ctx.timeline.set(document.documentElement, emph, ctx.toSeconds(ctx.frames.frameStart))',
    );
    expect(source).toContain(
      'ctx.timeline.set(document.documentElement, base, ctx.toSeconds(ctx.frames.frameEnd))',
    );
  });

  it('значения — КЛЮЧЕВЫЕ СЛОВА: числу gsap дописал бы единицу и правило стало бы невалидным', () => {
    expect(source).toContain('"bold"');
    // Снятие палитры — `initial` (guaranteed-invalid), а не «база»: база живёт у трека одним
    // комплектом чисел, и второй здесь разъехался бы с ним при первой правке.
    expect(source).toContain('"initial"');
    expect(source).not.toMatch(/--vpe-caption-weight"\]\s*=\s*"\d/u);
    expect(source).not.toMatch(/--vpe-caption-color"\]\s*=\s*"\d/u);
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
    expect(source).toContain("document.getElementById(\"vpe-caption-emphasis\") === null");
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
