// Контроль `targetLufs` / `truePeakDb` — ОТЧЁТ, А НЕ АВТОНОРМАЛИЗАЦИЯ.
//
// Громкость здесь НЕ подкручивается: измеряется и сверяется с профилем. Решение владельца
// (вопрос 8 сессии `M-03`); расхождение с формулировкой ADR-0006 §5 («…параметры ресемплера,
// **нормализация громкости**, пороги приёмки дубля…») названо в отчёте кандидатом в правку
// ADR — вероятно, там имелись в виду параметры как вход ключа кэша, а не действие.
//
// ЧТО ИЗМЕРЯЕТСЯ СЕЙЧАС И ПОЧЕМУ ИМЕННО ЭТО (вариант «в», решение владельца, вопрос 3).
//
//   * **Пик по сэмплам** — точная целочисленная величина `max|s|`. Ни одного float в пути
//     от байтов до решения: порог `truePeakDb` переводится в ЦЕЛУЮ границу амплитуды один
//     раз (`peakLimitFromDb`), дальше сравниваются целые.
//   * **LUFS — `null`.** Честный ITU-R BS.1770-4 — это K-взвешивание двумя биквадами, блоки
//     400 мс с перекрытием 75 %, двухступенчатое гейтирование (−70 LUFS абсолютный, −10 LU
//     относительный) и true peak через передискретизацию (при 24 кГц — до ≥192 кГц). Это не
//     оценка 1, и главное — это преждевременно: `truePeakDb` есть свойство ДОСТАВКИ, а
//     единственный энкод аудио происходит при муксе (`M-04`, R5), причём сама
//     `deliverySampleRate: 48000` имеет основание `UNKNOWN` до `X-02`. Мерить true peak на
//     промежуточном PCM 24 кГц и объявлять это контролем AC1 значило бы натянуть.
//     Адрес — `X-02`; строка в `docs/DEBTS.md`.
//   * RMS-приближение LUFS отвергнуто владельцем и мной: число, похожее на LUFS, расходится
//     с ним на речи с паузами на единицы LU — это ложный зелёный охранник AC1, что хуже
//     отсутствующего. Прецедент честного отсутствия — `alignerNoiseFloor: {p50: null …}` в
//     том же профиле.
//
// ПИК ПО СЭМПЛАМ КОНСЕРВАТИВЕН СНИЗУ, И ЭТО СКАЗАНО ВСЛУХ: истинный пик (true peak,
// межсэмпловый) НЕ МЕНЬШЕ пика по сэмплам. Значит, превышение, которое этот охранник нашёл,
// — настоящее; а молчание охранника ещё не означает, что доставка укладывается в −1.0 dBTP.
// Поэтому результат проверки несёт поле `notMeasured`: «что охранник НЕ проверял» обязано
// быть в самом результате, а не в комментарии рядом.

import type { AudioProfile } from '@vpe/schema';

import { AudioError } from './errors.js';
import { PCM_SAMPLE_MAX, PCM_SAMPLE_MIN, type PcmS16 } from './pcm.js';

/**
 * Полная шкала для перевода в dBFS — 32768, модуль самой отрицательной величины s16.
 *
 * Выбор между 32768 и 32767 — соглашение, и оно записано здесь, потому что от него зависит
 * целая граница: при 32768 нулю dBFS соответствует ровно отрицательный край шкалы, а
 * положительный максимум 32767 оказывается на −0.00027 dBFS.
 */
export const FULL_SCALE = -PCM_SAMPLE_MIN;

/**
 * Насколько далеко произведение обязано отстоять от целого, чтобы `Math.floor` не зависел
 * от платформы. `Math.pow` в ECMA-262 «implementation-approximated» — то есть на разных
 * движках может отличаться в последнем разряде; на расстоянии 1e-6 от целого этой разницы
 * не хватит, чтобы изменить результат.
 */
const STABILITY_EPSILON = 1e-6;

export interface LoudnessReport {
  /** Точный целочисленный `max|s|`. Величина без единого float — она и входит в решение. */
  readonly samplePeak: number;
  /** Сколько сэмплов стоят ровно на краю шкалы: симптом уже случившегося клиппинга. */
  readonly fullScaleSamples: number;
  /**
   * Интегральная громкость по ITU-R BS.1770. `null` — «не измерялась», честно и намеренно
   * (см. шапку). Тип именно `null`, а не `number | null`: пока величины нет, вызывающий не
   * должен иметь возможности написать ветку «а если число».
   */
  readonly lufs: null;
}

/** Измерение. Один проход, целые числа, никаких аллокаций сверх результата. */
export function measureLoudness(pcm: PcmS16): LoudnessReport {
  let samplePeak = 0;
  let fullScaleSamples = 0;
  for (const sample of pcm.samples) {
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > samplePeak) samplePeak = magnitude;
    if (sample === PCM_SAMPLE_MIN || sample === PCM_SAMPLE_MAX) fullScaleSamples += 1;
  }
  return { samplePeak, fullScaleSamples, lufs: null };
}

/**
 * Порог в dBFS → наибольшая допустимая ЦЕЛАЯ амплитуда.
 *
 * Единственное место тракта, где вообще появляется `Math.pow`, и появляется он ровно один
 * раз на проверку — дальше сравниваются целые. Устойчивость результата не предполагается, а
 * проверяется: если произведение подошло к целому ближе, чем `STABILITY_EPSILON`, функция
 * ОТКАЗЫВАЕТ, потому что на таком пороге `Math.floor` зависел бы от последнего разряда
 * `pow`, а он в ECMA-262 «implementation-approximated».
 *
 * РАССТОЯНИЕ РОВНО 0 — САМЫЙ ОПАСНЫЙ СЛУЧАЙ, А НЕ САМЫЙ БЕЗОПАСНЫЙ, и это измерено в этой
 * сессии: `truePeakDb = 20·log10(29204/32768)` даёт произведение, РАВНОЕ 29204 в double,
 * тогда как истинная величина отличается от целого в неизвестную сторону. На другой
 * реализации `pow` тот же порог дал бы 29203. Поэтому ноль расстояния отвергается наравне с
 * «почти нулём»: отказ консервативен (он отвергает и пороги, которые обошлись бы), но
 * молчаливой платформенной разницы в артефактном пути не оставляет.
 *
 * Порог `≥ 0 dBFS` ограничением не является — шкала кончается раньше, — и обрабатывается
 * ДО всякого float: `10^0 = 1` по спецификации точно, но считать это незачем.
 */
export function peakLimitFromDb(truePeakDb: number): number {
  if (!Number.isFinite(truePeakDb)) {
    throw new AudioError('M-03 формат тракта (INFERENCE)', `\`truePeakDb\` = ${String(truePeakDb)}: ожидалось конечное число`);
  }
  if (truePeakDb >= 0) return FULL_SCALE;

  const exact = Math.pow(10, truePeakDb / 20) * FULL_SCALE;
  const distance = Math.abs(exact - Math.round(exact));
  if (distance <= STABILITY_EPSILON) {
    throw new AudioError(
      'M-03 формат тракта (INFERENCE)',
      `\`truePeakDb\` = ${String(truePeakDb)}: граница амплитуды ${String(exact)} лежит ` +
        `к целому ближе, чем ${String(STABILITY_EPSILON)}, и её округление зависело бы от ` +
        'реализации `Math.pow`. Возьмите порог, отстоящий от целой амплитуды.',
    );
  }
  return Math.floor(exact);
}

/** Отрисовка величины для человека. Float; в артефакт не идёт — только в сообщение. */
export function dbFsOf(peak: number): number {
  if (peak <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(peak / FULL_SCALE);
}

export interface LoudnessCheck {
  /** Найденные нарушения профиля. Пусто — проверенное сошлось. */
  readonly problems: readonly string[];
  /**
   * Что охранник НЕ проверял. Поле обязательно и обязано читаться вызывающим: пустой
   * `problems` при непустом `notMeasured` — это «не нашёл», а не «всё хорошо».
   */
  readonly notMeasured: readonly string[];
  /** Целая граница, с которой сравнивался пик, — чтобы решение было воспроизводимо глазами. */
  readonly peakLimit: number;
}

/**
 * Сверка отчёта с профилем. Ничего не меняет и ничего не «подтягивает»: возвращает список.
 */
export function checkLoudness(report: LoudnessReport, loudness: AudioProfile['loudness']): LoudnessCheck {
  const peakLimit = peakLimitFromDb(loudness.truePeakDb);
  const problems: string[] = [];
  if (report.samplePeak > peakLimit) {
    problems.push(
      `пик по сэмплам ${String(report.samplePeak)} (${dbFsOf(report.samplePeak).toFixed(3)} dBFS) ` +
        `выше границы ${String(peakLimit)} из \`truePeakDb\` = ${String(loudness.truePeakDb)}. ` +
        'Пик по сэмплам не превосходит истинного, поэтому превышение настоящее.',
    );
  }
  if (report.fullScaleSamples > 0) {
    problems.push(
      `${String(report.fullScaleSamples)} сэмпл(ов) стоят ровно на краю шкалы — клиппинг уже ` +
        'случился, и он необратим: вершины срезаны в самих байтах.',
    );
  }
  return {
    problems,
    notMeasured: [
      `targetLufs (${String(loudness.targetLufs)} LUFS): интегральная громкость ITU-R BS.1770 ` +
        'не измеряется в `M-03` — адрес `X-02`, см. шапку `loudness.ts` и `docs/DEBTS.md`',
      'true peak (межсэмпловый): измеряется пик по сэмплам, он консервативен снизу',
    ],
    peakLimit,
  };
}
