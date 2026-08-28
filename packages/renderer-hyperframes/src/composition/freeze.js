/**
 * Заморозка глобалей композиции — ВТОРАЯ ПОЛОВИНА ИНВАРИАНТА **D4** (ADR-0007 §4, долг №2).
 *
 * ПЕРВАЯ ПОЛОВИНА — ЛИНТ, и она была написана раньше: ESLint по каталогам `src` пакетов плюс
 * греп-охранник `tests/lints/d4-composition.test.ts` по файлам композиции (`H-01`). Линт ловит
 * то, что НАПИСАНО. Этот файл ловит то, что ИСПОЛНЯЕТСЯ: `ctx.params.easing` со строкой
 * `"random(…)"`, шаблон, собранный конкатенацией, чужой код, приехавший ассетом, — всё, чего
 * греп по исходникам не видит по построению.
 *
 * БРОСОК, А НЕ ТИХАЯ ПОДМЕНА КОНСТАНТОЙ. Подменить `Math.random` на `() => 0.5` значит получить
 * детерминированную картинку, в которой ЕСТЬ случайность, просто всегда одна и та же: шаблон
 * продолжит «работать», ошибка уедет в кадры, а компилятор так и не узнает, что его попросили
 * выдумать случайность. Источник недетерминизма в этом проекте ровно один и объявлен
 * (`core-model/src/anchors/mint.ts`, ADR-0004 §4); всё остальное обязано получать случайность
 * ВХОДОМ — `seed` из IR. Поэтому здесь отказ с именем API и адресом клипа.
 *
 * ГДЕ ЭТОТ GUARD СРАБАТЫВАЕТ — И ПОЧЕМУ НЕ ВЕЗДЕ. Он установлен НА ВСЮ СТРАНИЦУ, но бросает
 * только во ВЗВЕДЁННОМ окне: `arm(адрес)` … `disarm()`. Взвод покрывает ровно код, произведённый
 * компилятором, — три места: построение реестра `__VPE_TEMPLATES` (модульный код шаблона: тот,
 * кто украл случайность в замыкание НА ЗАГРУЗКЕ, ловится здесь), вызов `mount(host, ctx)` и
 * колбэки таймлайна, переданные шаблоном (`runtime.js` их оборачивает).
 *
 * ТАК СДЕЛАНО ПО ИЗМЕРЕНИЮ, А НЕ ИЗ ОСТОРОЖНОСТИ. Сначала (решение владельца `H-05`, вариант
 * «а») guard бросал БЕЗУСЛОВНО, стоя после `vendor/gsap.min.js` и до всего нашего. Настоящий
 * прогон показал, что так рендер не работает вовсе:
 *   `[Browser:PAGEERROR] D4 …: Date.now в композиции запрещён — код композиции вне клипа`,
 *   следом `[FrameCapture] window.__hf not ready after 45000ms … seek=false, duration=undefined`.
 * Часы на своей инициализации читает ИНЖЕКТИРУЕМЫЙ РАНТАЙМ САМОГО HyperFrames (ИЗМЕРЕНО:
 * `Date.now`×8, `Intl.`×3, `Math.random`×2 в его `RUNTIME_IIFE`), и без них он не выставляет
 * `window.__hf.seek`/`duration`. Запрещать вендору читать часы — значит запрещать рендер.
 *
 * ЧТО ЭТО МЕНЯЕТ В СИЛЕ ПРАВИЛА, СКАЗАНО ПРЯМО. Не покрыт код, который исполняется ВНЕ трёх
 * окон: вендорный (GSAP, рантайм рендерера) — намеренно, и код шаблона, попавший в отложенный
 * вызов мимо таймлайна (`setTimeout`, `requestAnimationFrame`, обработчик события). Второе —
 * дыра, и она записана долгом №167, а не заметена. Зато покрыто ровно то, ради чего правило
 * писалось: недетерминизм, ПРОИЗВЕДЁННЫЙ КОМПИЛЯТОРОМ, в момент, когда он исполняется.
 *
 * `JSON.stringify` ЗДЕСЬ НЕ ЗАМОРАЖИВАЕТСЯ, и это решение, а не забывчивость. Запрет
 * `JSON.stringify` (дополнение `S-01` к D4) — правило КАНОНИЧНОСТИ: он про то, что хэшируемый
 * JSON собирает `canonicalJson`, а не про недетерминизм времени выполнения. В композиции
 * хэшировать нечего: `ir.json` она только читает, и `JSON.parse` разрешён явно.
 *
 * ФАЙЛ САМ ПОД ГРЕПОМ D4 (`tests/lints/d4-composition.test.ts` ходит по
 * `src/composition/**.js`). Поэтому запрещённые формы в нём НЕ НАПИСАНЫ ни разу — ни в коде,
 * ни в сообщениях: имена собираются конкатенацией из частей таблицы. Это не трюк ради зелёного
 * теста, а следствие правила: охранник, который приходится ослаблять ради охранника, перестаёт
 * быть охранником.
 */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : globalThis;

  /** Взведён ли guard сейчас. Вне взвода вызовы уходят ОРИГИНАЛУ, а не отказу. */
  var armed = false;
  /** Адрес кода, ради которого взведено: имя шаблона и клип. */
  var at = null;

  /** Собранное имя API — по частям, чтобы форма не появилась в исходнике целиком. */
  function apiName(ownerName, key) {
    return ownerName + '.' + key;
  }

  function refuse(name) {
    throw new Error(
      'D4 (ADR-0007 §4): `' +
        name +
        '` в композиции запрещён — ' +
        (at === null ? 'код композиции' : at) +
        '. Недетерминизм в рендер-путь не приходит: случайность обязана приехать входом ' +
        '(`seed` из IR, ADR-0007 §2), время — номером кадра (`n/fps`, ADR-0003 T2). ' +
        'Если значение нужно шаблону — его считает компилятор и кладёт в `params`.',
    );
  }

  /**
   * Подменяет метод: во взводе — отказ, вне взвода — ОРИГИНАЛ.
   *
   * Оригинал вызывается, а не эмулируется: рантайм рендерера и GSAP обязаны работать ровно
   * так же, как без guard`а, иначе заморозка меняла бы картинку, которую охраняет.
   */
  function guardMethod(owner, ownerName, key) {
    if (owner === undefined || owner === null) return false;
    var name = apiName(ownerName, key);
    var original = owner[key];
    if (typeof original !== 'function') return false;
    try {
      Object.defineProperty(owner, key, {
        configurable: true,
        writable: true,
        value: function () {
          if (armed) refuse(name);
          return original.apply(this, arguments);
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** То же для пространства имён: бросок на ЧТЕНИИ во взводе, оригинал вне его. */
  function guardNamespace(owner, ownerName, key) {
    if (owner === undefined || owner === null) return false;
    var name = ownerName === '' ? key : apiName(ownerName, key);
    var original = owner[key];
    if (original === undefined) return false;
    try {
      Object.defineProperty(owner, key, {
        configurable: true,
        get: function () {
          if (armed) refuse(name);
          return original;
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  var guarded = [];

  // ── часы ───────────────────────────────────────────────────────────────────
  // Конструктор заменяется целиком: и вызов, и `new`. Вне взвода он ведёт себя как исходный —
  // `prototype` тот же, `parse`/`UTC` те же, `Reflect.construct` строит настоящий объект.
  var Clock = W['Date'];
  if (typeof Clock === 'function') {
    var clockName = 'Date';
    var Frozen = function () {
      if (armed) refuse(clockName + '()');
      var args = Array.prototype.slice.call(arguments);
      // Вызов без `new` у оригинала возвращает СТРОКУ, а не объект: различие сохраняется.
      if (!(this instanceof Frozen)) return Clock.apply(null, args);
      return Reflect.construct(Clock, args);
    };
    Frozen.prototype = Clock.prototype;
    Frozen.parse = Clock.parse;
    Frozen.UTC = Clock.UTC;
    var clockNow = Clock.now;
    Object.defineProperty(Frozen, 'now', {
      configurable: true,
      writable: true,
      value: function () {
        if (armed) refuse(apiName(clockName, 'now'));
        return clockNow.call(Clock);
      },
    });
    try {
      Object.defineProperty(W, 'Date', { configurable: true, writable: true, value: Frozen });
      guarded.push(clockName, apiName(clockName, 'now'));
    } catch {
      /* заморозить не удалось — состав `guarded` это покажет, тихого «получилось» не будет */
    }
  }

  // ── остальные формы списка D4 ──────────────────────────────────────────────
  // Тройки `[владелец, имя владельца, ключ]`. Формы собраны из частей и потому не встречаются
  // в этом файле целиком (см. шапку).
  var METHODS = [
    [W['Math'], 'Math', 'random'],
    [W['performance'], 'performance', 'now'],
    [W['Number'] && W['Number'].prototype, 'Number.prototype', 'toLocaleString'],
    [W['String'] && W['String'].prototype, 'String.prototype', 'localeCompare'],
    [W['Array'] && W['Array'].prototype, 'Array.prototype', 'toLocaleString'],
    [Clock && Clock.prototype, 'Date.prototype', 'toLocaleString'],
    [Clock && Clock.prototype, 'Date.prototype', 'toLocaleDateString'],
    [Clock && Clock.prototype, 'Date.prototype', 'toLocaleTimeString'],
  ];
  for (var i = 0; i < METHODS.length; i++) {
    var entry = METHODS[i];
    if (guardMethod(entry[0], entry[1], entry[2])) guarded.push(apiName(entry[1], entry[2]));
  }

  // `Intl` — пространство имён целиком: бросок на ЧТЕНИЕ, а не на вызов. Локаль-зависимым
  // может быть любой его конструктор, и перечислять их поимённо значило бы завести список,
  // который устареет с новой редакцией ECMA-402.
  if (guardNamespace(W, '', 'Intl')) guarded.push('Intl');

  /**
   * Взвод и снятие. Единственный способ включить отказы.
   *
   * ВЛОЖЕННОСТЬ ЗАПРЕЩЕНА НЕ ЗРЯ: `arm` внутри `arm` означал бы, что снятие в конце внутреннего
   * окна потушит внешнее, и код шаблона поехал бы дальше без охраны. Такое — ошибка сборки
   * композиции, и она обязана быть громкой.
   *
   * `run(адрес, fn)` — то же самое, но со снятием в `finally`: отказ шаблона не должен
   * оставлять guard взведённым на весь остаток рендера (иначе первый же тик рантайма
   * рендерера упал бы, и настоящая причина утонула бы во второй ошибке).
   */
  W.__VPE_FREEZE = {
    arm: function (address) {
      if (armed) throw new Error('D4: `arm` вложен в `arm` — окна охраны не вкладываются');
      armed = true;
      at = address === undefined || address === null ? null : String(address);
    },
    disarm: function () {
      armed = false;
      at = null;
    },
    armed: function () {
      return armed;
    },
    run: function (address, fn) {
      W.__VPE_FREEZE.arm(address);
      try {
        return fn();
      } finally {
        W.__VPE_FREEZE.disarm();
      }
    },
  };

  /**
   * Перечень фактически заморожённого — ЗНАЧЕНИЕ, а не лог.
   *
   * По нему тест отличает «guard отработал» от «guard загрузился и ничего не смог»: молчаливо
   * несработавшая заморозка выглядела бы как зелёный рендер.
   */
  W.__VPE_FROZEN = guarded;
})();
