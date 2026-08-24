// Два охранника приёмки дубля (`V-02`), оба — греп по исходнику пакета `voice`.
//
// (а) ПОРОГ СРАВНЕНИЯ БЕРЁТСЯ ИЗ ОБЪЕКТА ПОРОГОВ, А НЕ ИЗ КОДА. Числа `takeAcceptance`
//     (0.9 / 8 / 2) — данные профиля `audio-profile/1`; их вторая запись в коде разъехалась
//     бы с `fixtures/minimal/profiles/audio.yaml` при первой правке, и приёмка молча судила
//     бы дубли по устаревшему порогу. Поведенческая половина охранника — тесты «правка порога
//     в переданном объекте меняет вердикт» и «граница проходит РОВНО по значению профиля»
//     (`packages/voice/test/acceptance.test.ts`). Чего они НЕ ловят: замену правой части
//     сравнения на литерал или на константу файла — с ними тест на границу продолжит зеленеть
//     до тех пор, пока литерал совпадает с профилем, и покраснеет только в день правки
//     профиля, то есть на один прогон позже нужного. Ловится это здесь.
//
//     ПОЧЕМУ ГРЕП ИМЕННО ПО СРАВНЕНИЮ, А НЕ ПО ИМЕНИ ПОРОГА. Имена `maxEqualRun` и
//     `uniqueTimestampRatio` носят ДВЕ разные величины: измеренная метрика дубля (`TakeHealth`,
//     форма roadmap) и порог профиля (`TakeAcceptance`). Греп по имени краснел бы на каждой
//     строке, где считается метрика, — то есть не годился бы вовсе.
//
// (б) `interpolated` ЗАРЕЗЕРВИРОВАН ТИПОМ, А НЕ ПОРОЖДАЁТСЯ. ADR-0010 §5 требует статус
//     `interpolated|absent`, но в v1 биндер один — `provider-timestamps`, и он ничего не
//     интерполирует. Значение обязано существовать в типе (иначе будущий `ctc-fa@1` добавит
//     ПОЛЕ вместо ВЕТКИ), но не должно появиться в исполняемом коде незаметно: интерполяция
//     без охранника — это ровно «компилятор выдумал время» (**V8**). Адрес пополнения — `V-05`.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

/** Сравнение метрики с порогом: где стоит и чем обязана быть его правая часть. */
const COMPARISONS = [
  {
    what: 'уникальность стартов',
    // Имя метрики, за которым идёт знак сравнения, — это и есть проверка порога.
    metric: /uniqueTimestampRatio\s*[<>]=?/,
    threshold: 'acceptance.minUniqueTimestampRatio',
  },
  {
    what: 'длина серии одинаковых стартов',
    metric: /maxEqualRun\s*[<>]=?/,
    threshold: 'acceptance.maxEqualRun',
  },
] as const;

/** Число попыток лестницы обязано считаться от порога профиля, а не от числа в коде. */
const LADDER = {
  file: 'packages/voice/src/acceptance/ladder.ts',
  bound: /const\s+total\s*=/,
  threshold: 'acceptance.maxRetries',
};

const acceptanceFiles = (): string[] =>
  sourceFiles('voice').filter((file) => file.includes('/acceptance/'));

describe('`V-02` (а): порог сравнения приходит из профиля, а не из кода', () => {
  it('модуль приёмки существует и найден обходом, а не списком имён', () => {
    expect(acceptanceFiles().length > 0).toBe(true);
  });

  it('каждое сравнение метрики с порогом называет поле объекта порогов', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of acceptanceFiles()) {
      codeLines(readSource(file)).forEach((line, index) => {
        for (const rule of COMPARISONS) {
          if (!rule.metric.test(line)) continue;
          checked += 1;
          if (!line.includes(rule.threshold)) {
            offenders.push(`${file}:${String(index + 1)} (${rule.what}): ${line.trim()}`);
          }
        }
      });
    }
    expect(
      offenders,
      `порог сравнения взят мимо профиля:\n${offenders.join('\n')}`,
    ).toEqual([]);
    // Иначе правило зеленело бы на удалённой проверке: «нет сравнений» — не «всё в порядке».
    expect(checked, 'ни одного сравнения метрики с порогом не найдено').toBe(COMPARISONS.length);
  });

  it('число попыток лестницы считается от `maxRetries` профиля', () => {
    const lines = codeLines(readSource(LADDER.file));
    const bounds = lines.filter((line) => LADDER.bound.test(line));
    expect(bounds.length, 'граница цикла лестницы не найдена').toBe(1);
    expect(bounds[0]?.includes(LADDER.threshold), bounds[0] ?? '').toBe(true);
  });

  it('у объекта порогов НЕТ значения по умолчанию и нет запасного варианта', () => {
    // НАЙДЕНО ПРОТОКОЛОМ НАРУШЕНИЙ (№14): грепа по сравнению НЕДОСТАТОЧНО. Умолчание параметра
    // `acceptance: TakeAcceptance = { minUniqueTimestampRatio: 0.9, maxEqualRun: 8, maxRetries: 2 }`
    // в `mock.ts` оставляло ВЕСЬ пакет зелёным: сравнение продолжало читать поле объекта, а
    // числа профиля тихо вернулись в код второй записью. Правило закрывает три формы возврата.
    const offenders: string[] = [];
    for (const file of sourceFiles('voice')) {
      codeLines(readSource(file)).forEach((line, index) => {
        const at = `${file}:${String(index + 1)}: ${line.trim()}`;
        // (1) умолчание параметра либо константа-объект с аннотацией типа;
        if (/:\s*TakeAcceptance\s*=/.test(line)) offenders.push(`умолчание — ${at}`);
        // (2) запасной вариант вместо переданного объекта;
        if (/\bacceptance\s*(\?\?|\|\|)/.test(line)) offenders.push(`fallback — ${at}`);
        // (3) число, присвоенное имени порога в литерале объекта. Проверяются ДВА имени из
        //     трёх: `maxEqualRun` носит ещё и метрика `TakeHealth` (`maxEqualRun: 0` в ветке
        //     отсутствующего alignment — законная строка), а объект порогов без двух других
        //     полей не соберётся, то есть подделка всё равно краснеет.
        if (/\b(minUniqueTimestampRatio|maxRetries)\s*:\s*[0-9]/.test(line)) {
          offenders.push(`литерал порога — ${at}`);
        }
      });
    }
    expect(offenders, `числа профиля вернулись в код:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('поля `TakeAcceptance` обязательны: необязательное поле — то же умолчание, но в типе', () => {
    const declaration = readSource('packages/voice/src/acceptance/health.ts');
    const block = /export interface TakeAcceptance \{([\s\S]*?)\n\}/.exec(declaration);
    expect(block?.[1], 'объявление `TakeAcceptance` не найдено').toBeDefined();
    expect(/\w\?\s*:/.test(block?.[1] ?? '')).toBe(false);
  });

  it('все три порога действительно читаются хотя бы раз', () => {
    const all = acceptanceFiles()
      .map((file) => codeLines(readSource(file)).join('\n'))
      .join('\n');
    for (const name of ['minUniqueTimestampRatio', 'maxEqualRun', 'maxRetries']) {
      expect(all.includes(`acceptance.${name}`), `порог ${name} не читается ниоткуда`).toBe(true);
    }
  });
});

describe('`V-02` (б): `interpolated` зарезервирован типом и не порождается', () => {
  it('литерал `interpolated` встречается только в объявлении union’а статусов', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('voice')) {
      codeLines(readSource(file)).forEach((line, index) => {
        if (!line.includes('interpolated')) return;
        // Единственная законная форма — член union'а: `'measured' | 'interpolated'`.
        if (!/'measured'\s*\|\s*'interpolated'/.test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `\`interpolated\` появился в исполняемом коде — интерполяция обязана прийти с охранником (V-05):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('и он всё-таки объявлен: правило охраняет резерв, а не его отсутствие', () => {
    const all = sourceFiles('voice').map((file) => readSource(file)).join('\n');
    expect(all.includes("'interpolated'")).toBe(true);
  });
});
