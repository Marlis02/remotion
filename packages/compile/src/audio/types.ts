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
//   * ~~**микса**~~ **МИКС ЕСТЬ С `X-02` (2026-09-12).** Решение владельца «микс делаем»
//     отменяет не правило, а ЭТАП: `params` компилятор по-прежнему читать не вправе, и числа
//     микса приезжают четвёртой декларацией спека (`declareAudio` → `ClipContract.audio` →
//     `AudioMusicClip.audio`). Абзац ниже оставлен как история решения:
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

import type { Frames, IrAssetRef, Samples, TemplateParams, TrackKind } from '@vpe/core-model';

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
 * Ручки микса, приехавшие из профиля звука ДАННЫМИ (`X-02`).
 *
 * ПОЧЕМУ В ПЛАНЕ, А НЕ У ТОГО, КТО КЛАДЁТ БАЙТЫ. `renderAudioTrack` получает ТОЛЬКО план и
 * источник PCM: величина, которой нет в плане, доехала бы до байтов вторым путём — и дамп
 * плана перестал бы объяснять получившуюся дорожку. Правило то же, по которому в плане лежат
 * `ε_i` и раскладка: печатается, а не подразумевается.
 */
export interface AudioMixPlan {
  /**
   * `audio-profile/1 → mix.enabled`. `false` — прежнее поведение «только голос».
   *
   * НЕ «ВЫКЛЮЧАТЕЛЬ НА ВСЯКИЙ СЛУЧАЙ», А ПРИБОР СРАВНЕНИЯ: запись `bed@1`, собранная до
   * `X-02`, и она же после обязаны давать РАЗНЫЙ звук, и доказывается это побайтовым
   * равенством дорожки при `false` с дорожкой прежней сборки (AC4 на старых записях).
   */
  readonly enabled: boolean;
  /** `mix.duckRampMs`, переведённые в сэмплы проекта: длина спуска и подъёма подложки. */
  readonly duckRampSamples: Samples;
  /** `crossfadeSamples` профиля — микрофейд краёв клипа и стыков петли (ADR-0003 T7). */
  readonly crossfadeSamples: Samples;
}

/**
 * Усиление рациональной дробью — та же форма, что у `Gain` в `media/audio/gain.ts`.
 *
 * ПЕЧАТАЕТСЯ В ДАМПЕ ЧИСЛАМИ: `4125/32768` проверяемо глазами и не зависит от того, как
 * движок печатает `double`. Считает дробь ОДНА функция тракта (`gainFromDb`) — здесь она
 * только лежит.
 */
export interface AudioGain {
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * Звук клипа аудио-домена: что объявил шаблон и во что это превратилось для микса.
 *
 * `gainDb`/`duckUnderSpeechDb` остаются рядом с дробями НАМЕРЕННО: дробь — то, чем считают,
 * децибелы — то, что написал автор, и в отчёте обязано быть видно и то и другое.
 */
export interface AudioClipSound {
  /** Адрес байтов ассета в CAS — разрешён контрактом шаблона (`CP-07`), не планом. */
  readonly assetSha256: string;
  /** Роль ассета у шаблона (`asset` у `bed@1`) — для сообщений и дампа. */
  readonly role: string;
  readonly inPointSamples: Samples;
  readonly gainDb: number;
  readonly duckUnderSpeechDb: number;
  /** `10^(gainDb/20)` дробью — уровень вне речи. */
  readonly gain: AudioGain;
  /** `10^((gainDb + duckUnderSpeechDb)/20)` дробью — уровень под речью. */
  readonly duckedGain: AudioGain;
  /** Зацикливать ли ассет, когда окно клипа длиннее него (`true` у подложки). */
  readonly loop: boolean;
  /**
   * Паузы источника, на которых звук клипа МОЛЧИТ (`VID-02b`): `holds` у `video@1`.
   *
   * `atSourceSample` — момент внутри файла, `lengthSamples` — сколько молчать. Пустой список —
   * обычное состояние: подложка не замирает никогда.
   */
  readonly pauses: readonly AudioClipPause[];
}

/** Пауза звука клипа: где в источнике и насколько (`VID-02b`). Оба числа — сэмплы. */
export interface AudioClipPause {
  readonly atSourceSample: Samples;
  readonly lengthSamples: Samples;
}

/**
 * Клип аудио-домена — подложка или эффект — и его звук.
 *
 * `params` — ДАННЫМИ насквозь, ровно как в Timeline: контракт параметров объявляет `TS-01`,
 * *(изменено: `CP-07`, 2026-08-28.)* ~~`params.asset` у `bed@1` остаётся alias'ом, который
 * компилятор разрешать не вправе, поэтому здесь НЕТ поля `sha256`.~~ Sha есть: alias
 * разрешает `declareAssets` спека (`bed@1` объявляет одну ссылку `{alias: 'pad-loop',
 * role: 'asset'}`, хотя alias встречается в `params` дважды), и она приезжает сюда полем
 * `assets` — той же формы `IrAssetRef`, что в видео-IR. Долг №141 сужается до `X-02`: микса
 * по-прежнему нет, и `unmixedClips` по-прежнему считает клипы, которых нет в дорожке.
 */
export interface AudioMusicClip {
  /**
   * Имя дорожки Timeline, на которой стоит клип.
   *
   * **БОЛЬШЕ НЕ ДВА ЛИТЕРАЛА** *(изменено: `VID-02b`, 2026-09-12; было `'music' | 'sfx'`)*.
   * Звук приносит не только аудио-домен: `video@1` стоит на `visual` и с `audio: "full"`
   * кладёт в дорожку свой звук. Сузить тип обратно значило бы либо врать в поле, либо завести
   * второй список клипов со звуком — то есть два места, где считается одно и то же.
   */
  readonly track: TrackKind;
  readonly clipId: string;
  readonly template: string;
  /** Авторские `params` (решение владельца `CP-07`, вопрос 2): alias'ы не подменены. */
  readonly params: TemplateParams;
  /** `declareAssets(params)` шаблона, разрешённые в sha (`CP-07`, долг №141 → `X-02`). */
  readonly assets: readonly IrAssetRef[];
  /** Начало клипа в TIMELINE. Остаётся полем: правки (`O-01`) адресуются к нему. */
  readonly startSample: Samples;
  readonly endSample: Samples;
  /**
   * Начало клипа В ДОРОЖКЕ — `startSample` плюс `Σ δ` сегментов до него (`X-02`).
   *
   * **ДВЕ КООРДИНАТЫ, А НЕ ОДНА, И ЭТО НЕ ДУБЛИРОВАНИЕ.** Между Timeline и дорожкой лежат
   * поправки границ (T6): дорожка ДЛИННЕЕ Timeline ровно на `Σ δ`, и клип, положенный по
   * координате Timeline, поехал бы относительно речи тем сильнее, чем дальше он от начала.
   * У речевых элементов эта же величина называется `atSample` и считается той же формулой —
   * второго правила пересчёта в зоне нет.
   */
  readonly atSample: Samples;
  /** Конец клипа в дорожке. `untilSample − atSample` — длина окна, в которое кладётся звук. */
  readonly untilSample: Samples;
  /**
   * Звук клипа — `null`, если шаблон его не объявил (`declareAudio`).
   *
   * `null` И ЕСТЬ «НЕ СМИКШИРОВАН»: клип аудио-домена без объявленного звука лежит в плане
   * данными и в дорожку не попадает — ровно как вся музыка до `X-02`. Считает такие клипы
   * `unmixedClips`, и ноль у него означает «всё, что просили, звучит».
   */
  readonly audio: AudioClipSound | null;
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
  /** Ручки микса из профиля звука — данными, а не вторым путём до байтов (`X-02`). */
  readonly mix: AudioMixPlan;
  /** Клипы аудио-домена: подложки и эффекты, со звуком (`X-02`) либо без него. */
  readonly music: readonly AudioMusicClip[];
  /**
   * Сколько клипов аудио-домена ВОЙДУТ в дорожку (`X-02`, 2026-09-12).
   *
   * ЧИСЛОМ, А НЕ ДЛИНОЙ ОТФИЛЬТРОВАННОГО МАССИВА У ЧИТАТЕЛЯ — по той же причине, по которой
   * им был `unmixedClips`: отчёт сборки печатает величину, и «подложка звучит» обязано
   * отличаться от «подложки не просили» одним взглядом. Ассерт стадии —
   * `mixedClips + unmixedClips == music.length`.
   */
  readonly mixedClips: number;
  /**
   * Сколько клипов аудио-домена НЕ смикшировано (поправка владельца П4, 2026-08-27).
   *
   * ЧИСЛОМ, А НЕ ДЛИНОЙ МАССИВА У ЧИТАТЕЛЯ: отчёт сборки (`L-01`) печатает величину, и ролик
   * без музыки обязан отличаться от ролика, в котором музыки не было. ~~Равенство
   * `unmixedClips == music.length` — ассерт стадии.~~ *(Изменено `X-02`, 2026-09-12: микс
   * есть, и ассерт стал `mixedClips + unmixedClips == music.length`.)* Ненулевое значение
   * теперь означает ровно одно из двух: `mix.enabled: false` либо шаблон аудио-домена, не
   * объявивший `declareAudio`.
   */
  readonly unmixedClips: number;
}
