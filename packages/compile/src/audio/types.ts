// Формы зоны `audio` (`CP-05`) — план непрерывной аудио-дорожки ролика.
//
// ЕДИНИЦА ЗДЕСЬ ОДНА — СЭМПЛ ПРОЕКТА, как и в `timeline`. Кадры в этой зоне встречаются
// ровно дважды и оба раза ПРИХОДЯТ ГОТОВЫМИ из манифеста (`totalFrames`, `firstFrame`):
// звук не сегментируется никогда (ADR-0008), и переводить длины в кадры здесь нечем и незачем.
// Новой точки конверсии времени зона не заводит: `frameStartSample` зовётся из `core-model`.
//
// ПОЧЕМУ ЗОНА ТРЕТЬЯ, А НЕ ЧАСТЬ `timeline` ИЛИ `render-ir`. Правило **M5** (ADR-0009)
// разводит «IR не знает Timeline»; аудио не знает НИ ТОГО, НИ ДРУГОГО в смысле кадров: оно
// читает клипы Timeline (речь и тишины лежат там) и ЧИСЛА манифеста (`core-model`), а
// видео-IR ему не нужен вовсе — в `RenderIrSegment` нет ни одного сэмпла. Отсюда строка зон
// `audio ↔ render-ir` в `eslint.config.js` (решение владельца 6, 2026-08-27).
//
// ЧЕГО В ЭТИХ ТИПАХ НЕТ:
//
//   * **байтов** — план это ДАННЫЕ, материализует их `renderAudioTrack(plan, pcmSource)`.
//     `compileAudio` чистая: ни `fs`, ни часов, ни случайности, ни чтения CAS;
//   * **микса** — музыка едет ДАННЫМИ (`music[]`, решение владельца 1, вариант «а»): читать
//     `params` шаблона компилятор не вправе до `TS-01`, а `params.asset` у `bed@1` — alias,
//     не sha (ИЗМЕРЕНО на `fixtures/minimal`: `asset: 'pad-loop'`). Поэтому `mixSaturating`
//     в этой зоне не зовётся ни разу, и `AudioPlan` честно говорит, сколько клипов осталось
//     несмикшированными (поправка владельца П4);
//   * **фейда, нормализации, лимитера** — `applyEdgeFade`/`checkLoudness` это `X-02`.
//     Компилятор не выдумывает звук: тишина — нули, речь — байты дубля как есть в окне T7;
//   * **ЧЕТВЁРТОГО ВИДА ТИШИНЫ.** Решение владельца 5, вариант «а» (2026-08-27): вида
//     `final-padding` НЕТ. Добивка T5 приезжает ПОЛЕМ элемента `boundary-correction`
//     последнего сегмента — см. `AudioCorrectionSilence`.

import type { Frames, Samples, TemplateParams } from '@vpe/core-model';

/**
 * Вид тишины на дорожке — `TimelineSilence.silenceKind` (ADR-0001) КАК ЕСТЬ, три имени.
 *
 * Второй копии закрытой таксономии здесь нет и быть не может: она «необратимая часть модели
 * времени» (ADR-0003 T6), и четвёртое имя означало бы правку ADR, а не правку типа.
 */
export type AudioSilenceKind = 'author' | 'gap' | 'boundary-correction';

/** Общее у всех элементов плана: где стоит и сколько длится. Позиция — АБСОЛЮТНАЯ, в дорожке. */
interface AudioElementBase {
  /** `speech:<chunkKey>` либо `silence:<startSample Timeline>` — id клипа Timeline как есть. */
  readonly clipId: string;
  /** Абсолютная позиция в ДОРОЖКЕ (не в Timeline: между ними лежит `Σ δ` предыдущих сегментов). */
  readonly atSample: Samples;
  readonly lengthSamples: Samples;
  /** Сегмент, которому элемент принадлежит (T6: разбиение дорожки тотально и без пересечений). */
  readonly segmentId: string;
}

/**
 * Речь: окно в СЫРОМ PCM дубля, уложенное на дорожку (ADR-0003 T7 после `DOC-04`).
 *
 * `fromSample`/`toSample` — `[leadInSamples, numSamples − tailSamples)` дубля; байты берутся
 * ОТТУДА И КАК ЕСТЬ. Ни фейда, ни ресемплинга, ни нормализации: «на импорте НИЧЕГО не
 * срезается, режет интервал речи тот, кто строит дорожку» — это и есть здесь.
 */
export interface AudioSpeechElement extends AudioElementBase {
  readonly kind: 'speech';
  readonly chunkKey: string;
  /**
   * Адрес байтов дубля в CAS. **Не `null`**: дубль без байтов — это ошибка стадии, а не
   * «тишина вместо речи» (список `chunkKey` печатается в `CompileAudioError`).
   */
  readonly pcmSha256: string;
  /** Начало окна речи ВНУТРИ сырого PCM. */
  readonly fromSample: Samples;
  /** Конец окна речи внутри сырого PCM. `toSample − fromSample == lengthSamples` — ассерт. */
  readonly toSample: Samples;
}

/** Авторская пауза (`[pause:]`) или тишина движка (T8). Обе входят в `L_i`. */
export interface AudioPlainSilence extends AudioElementBase {
  readonly kind: 'silence';
  readonly silenceKind: 'author' | 'gap';
}

/**
 * Поправка `δ_i` (ADR-0003 T6) — ЕДИНСТВЕННЫЙ вид тишины, который **не входит ни в один `L`**.
 *
 * СТОИТ В КОНЦЕ ХВОСТОВОГО GAP'А СЕГМЕНТА `i` (T6 после `DOC-05`, дословно), то есть последним
 * элементом сегмента: разрез `CP-03` ставится в КОНЦЕ клипа `Silence`, значит хвостовой gap —
 * последний клип сегмента, и «в конец gap'а» совпадает с «в конец сегмента». У последнего
 * сегмента хвостового gap'а нет вовсе, и его поправка — это конец ролика.
 *
 * **ДВА ПОЛЯ, А НЕ ОДНА СУММА** (поправка владельца П1, 2026-08-27). Длина элемента у
 * последнего сегмента складывается из двух РАЗНЫХ величин:
 *
 *   * `correctionSamples` = `δ_n = A_n − L_n` — поправка T6, обязана быть `< S` (**T6b**);
 *   * `finalPaddingSamples` = `frameStartSample(F) − Σ A_i` — добивка T5, обязана быть `< n`.
 *
 * Сложи их в одно число — и `δ_n < S` перестанет быть проверяемым ПО ЭЛЕМЕНТУ (только по
 * манифесту), а ассерт на элементе — это ровно то, ради чего элемент существует. У всех
 * сегментов, кроме последнего, `finalPaddingSamples` равен нулю: добивка бывает одна и в
 * самом конце ролика.
 *
 * ИЗМЕРЕНО (`CP-05`, 2026-08-27): на ЦЕЛОМ `S` добивка тождественно нулевая — `frameStartSample`
 * при целом `S` аддитивна, и `Σ A_i` уже равно `frameStartSample(F)`. Ненулевой она бывает
 * только на дробном `S`: при 48000 и 30000/1001 (`S = 1601.6`) замерены 1 и 2 сэмпла. Поэтому
 * заводить под неё ЧЕТВЁРТЫЙ вид тишины значило бы завести элемент, который на единственной
 * фикстуре и на любой целой сетке имеет нулевую длину, — а пустых интервалов модель не знает
 * (**T4**). Решение владельца 5, вариант «а».
 */
export interface AudioCorrectionSilence extends AudioElementBase {
  readonly kind: 'silence';
  readonly silenceKind: 'boundary-correction';
  /** `δ_i` — ровно `manifest.segments[i].correctionSamples`, сверяется ассертом. */
  readonly correctionSamples: Samples;
  /** Добивка T5. Ненулевая только у последнего сегмента и только на дробном `S`. */
  readonly finalPaddingSamples: Samples;
}

/** Тишина на дорожке: обычная (входит в `L_i`) либо поправка (не входит). */
export type AudioSilenceElement = AudioPlainSilence | AudioCorrectionSilence;

/** Элемент плана. Дорожка есть их конкатенация встык, без дыр и перекрытий (T5). */
export type AudioElement = AudioSpeechElement | AudioSilenceElement;

/**
 * Раскладка дорожки — та самая, которую T9 обязан напечатать при падении: «речь + авторские
 * паузы + gap'ы + Σδ». Плюс добивка T5 отдельной строкой (П1: две величины, не одна).
 *
 * `speechSamples + authorSamples + gapSamples == Σ L_i`;
 * `+ correctionSamples == Σ A_i`;
 * `+ finalPaddingSamples == totalSamples`. Все три равенства — ассерты, а не комментарий.
 */
export interface AudioBreakdown {
  readonly speechSamples: Samples;
  readonly authorSamples: Samples;
  readonly gapSamples: Samples;
  /** `Σ δ_i` — «цена, принимаемая явно» (ADR-0003 T6). */
  readonly correctionSamples: Samples;
  /** `frameStartSample(F) − Σ A_i` — добивка T5. */
  readonly finalPaddingSamples: Samples;
}

/**
 * Клип аудио-домена, который дорожка v1 НЕ СМИКШИРОВАЛА (решение владельца 1, вариант «а»).
 *
 * `params` — ДАННЫМИ насквозь, ровно как в Timeline: контракт параметров объявляет `TS-01`,
 * и до него `params.asset` у `bed@1` остаётся alias'ом (`'pad-loop'` на `fixtures/minimal`),
 * который компилятор разрешать не вправе — alias резолвится только у порождённой
 * `[img:]`-записи (решение владельца `CP-01`, вопрос 8). Поэтому здесь НЕТ поля `sha256`:
 * его нечем заполнить, а выдуманное значение было бы хуже отсутствующего.
 */
export interface AudioMusicClip {
  /** `music` либо `sfx` — обе дорожки аудио-домена (`NON_CROSSING_TRACKS`, `CP-03`). */
  readonly track: 'music' | 'sfx';
  readonly clipId: string;
  readonly template: string;
  readonly params: TemplateParams;
  readonly startSample: Samples;
  readonly endSample: Samples;
}

/**
 * План дорожки: что и где лежит, из чего складывается длина, чего в дорожке не оказалось.
 *
 * ОДНА ДОРОЖКА НА РОЛИК, И «PCM СЕГМЕНТА» НЕ СУЩЕСТВУЕТ (T5, ADR-0008): сегменты немые по
 * построению, звук не режется вообще, поэтому стык в аудио-домене не возникает. Единственное
 * место, где `segmentId` вообще упоминается, — принадлежность элемента и точка вставки `δ_i`;
 * ни одной границы, зависящей от `segmentId`, в дорожке нет.
 */
export interface AudioPlan {
  /** `projectSampleRate`. Дорожка целиком на нём — `assertProjectRate` на каждом входном PCM. */
  readonly sampleRate: number;
  /** `F = Σ d_i` из манифеста. Приходит готовым: кадры здесь не считаются. */
  readonly totalFrames: Frames;
  /** `frameStartSample(F)` — длина дорожки (T5). Равна сумме длин элементов, это ассерт. */
  readonly totalSamples: Samples;
  /** Элементы в порядке дорожки, встык: `at + length` элемента `k` == `at` элемента `k+1`. */
  readonly elements: readonly AudioElement[];
  readonly breakdown: AudioBreakdown;
  /**
   * `ε_i = frameStartSample(f_i) − a_i` по сегментам, в порядке ролика (**T6d**).
   *
   * Печатается, а не подразумевается: это третье слагаемое движковой части бюджета AC5
   * (ADR-0007 §9). Форма ассерта — `ε_0 == 0`, `ε_i < i` при `i ≥ 1`, и `ε_i < n` (поправка
   * сессии Г, принята владельцем: буквальное `ε_i ∈ [0, i)` из ADR-0003 свойство (4) ложно
   * при `i = 0`, потому что `[0, 0)` пусто, а `ε_0` равен нулю).
   */
  readonly epsilonSamples: readonly Samples[];
  /** `frameStartSample(F) − Σ A_i` — разность свойства (3) T6, числом (**T6c**). */
  readonly trackTailSamples: Samples;
  /** Клипы аудио-домена, оставшиеся данными. Микса в v1 нет (долг с адресом `TS-01`/`X-02`). */
  readonly music: readonly AudioMusicClip[];
  /**
   * Сколько клипов аудио-домена НЕ смикшировано (поправка владельца П4, 2026-08-27).
   *
   * ЧИСЛОМ, А НЕ ДЛИНОЙ МАССИВА У ЧИТАТЕЛЯ: отчёт сборки (`L-01`) печатает величину, и ролик
   * без музыки обязан отличаться от ролика, в котором музыки не было. Равенство
   * `unmixedClips == music.length` — ассерт стадии, а не соглашение.
   */
  readonly unmixedClips: number;
}
