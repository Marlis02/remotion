// `asset-record/1` — provenance по файлу на ассет (ADR-0005 §1, §9a, §9b).
// Формат — JSON (`assets/records/<sha256>.json`), а не YAML: файл пишет CLI.

import { z } from 'zod';

import { sha256Hex } from './common.js';
import { identifier } from './marks.js';

/**
 * Форматы шрифта, которые умеет встроить компилятор.
 *
 * ПЕРЕЧЕНЬ, А НЕ СВОБОДНАЯ СТРОКА — в отличие от `status` и `providerId` рядом, и причина
 * обратная их причине. `FACT` (SP-3c §4): компилятор встраивает локальный шрифт `data URI`
 * ДО запуска браузера, а байты приходят из CAS **без имени файла** (`.store/ab/cd/<sha256>`)
 * — MIME-тип брать больше неоткуда, кроме этого поля. Незнакомое значение здесь не «новый
 * законный вход», как незнакомый провайдер, а молча битый `data URI` в готовом ролике.
 */
const FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2'] as const;

/** Та же пометка идентификатора, что у `identifier()`: enum сам по себе её не несёт (P17). */
const fontFormat = (): z.ZodEnum<Record<(typeof FONT_FORMATS)[number], (typeof FONT_FORMATS)[number]>> =>
  z.enum(FONT_FORMATS).meta({ vpeIdentifier: true });

/**
 * Собственные свойства файла. Три ветки — по числу видов ассетов в фикстуре: изображение,
 * звук, шрифт.
 *
 * ТРЕТЬЯ ВЕТКА ПОЯВИЛАСЬ В `M-02` («шрифт канала как ассет», V10, решение владельца 4),
 * вместе с первой настоящей записью `fonts/records/<sha256>.json` — как и было обещано на
 * этом месте. Состав полей минимален и каждое поле отвечает на свой вопрос:
 *
 * * `family` + `subfamily` (`name`-таблица, nameID 1 и 2) — чем шрифт зовётся. Без второго
 *   поля запись не отличает Bold от Regular ничем, кроме sha, а «DejaVu Sans **Bold**»
 *   обязано быть записано словами: выбор шрифта канала — `UNKNOWN` за владельцем
 *   (`docs/DEBTS.md` №13), и молчаливым он стать не должен;
 * * `format` — см. `FONT_FORMATS` выше;
 * * `fsType` (`OS/2`) — **разрешение на встраивание**, то есть единственное действие, которое
 *   конвейер со шрифтом совершает. Поле обязательное: запись шрифта без него не читается.
 *
 * ГРАНИЦА, ПРОВЕДЁННАЯ ЯВНО (решение владельца, `M-02`): **`fsType` схема ЗАПИСЫВАЕТ, но не
 * судит.** Правило «значение допускает встраивание» принадлежит Policy Guard (`CP-06`), а не
 * форме записи: схема, отвергающая `fsType` по значению, вшила бы политику в формат — и
 * ассет, законный для другого сценария использования, стал бы нечитаемым файлом. Диапазон
 * `0…0xFFFF` — это ФОРМА (в OpenType поле объявлено как `uint16`), а не суждение о правах.
 *
 * ЧЕГО В ВЕТКЕ НЕТ И ПОЧЕМУ. Лицензии как отдельного поля: она живёт в `provenance`
 * (`work`/`reproduction`) — там же, где у всех остальных ассетов. Второй словарь лицензий
 * в одной записи разъехался бы с первым при первой правке — тот же довод, по которому в
 * репозитории нет второй копии ни перечня видов блоба, ни регулярки якоря. `unitsPerEm`,
 * `numGlyphs`, версии: они интринсики, но их не читает никто — ни движок, ни Guard;
 * `width`/`height` соседней ветки читает укладка кадра, а этих — никто.
 */
/**
 * Кадровая частота — РАЦИОНАЛЬНАЯ, как её объявляет файл (`r_frame_rate`).
 *
 * Не число: `30000/1001` не выражается двоичной дробью, а именно на нём стоит половина
 * снятого телефонами материала. Округление до `29.97` разошлось бы с кадровой сеткой роликов
 * на кадр за пятьсот, и разъезд был бы тем самым тихим — ровно тот довод, по которому
 * `project.yaml` держит `fps: { num, den }`, а не десятичную дробь.
 */
const FpsSchema = z.object({ num: z.int().positive(), den: z.int().positive() }).strict();

/** Поворот из side-data — четыре законных значения, приведённые к `[0, 360)`. */
const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

const IntrinsicSchema = z.union([
  z.object({ width: z.int().positive(), height: z.int().positive() }).strict(),
  z.object({ durationSamples: z.int().positive(), sampleRate: z.int().positive() }).strict(),
  z
    .object({
      family: identifier(),
      subfamily: identifier(),
      format: fontFormat(),
      fsType: z.int().min(0).max(0xffff),
    })
    .strict(),
  // ═══ ЧЕТВЁРТАЯ ВЕТКА — ВИДЕО (`VID-01`, разрешение владельца, `ASSET-01` 2026-09-10) ═══
  //
  // Появилась вместе с первой командой, которая пишет записи ассетов (`vpe asset add`), и
  // ни минутой раньше: паспорт, который некому заполнить, — это форма без единого файла.
  // Каждое поле отвечает на вопрос, который движку ПРИДЁТСЯ задать до появления `video@1`:
  //
  // * `width`/`height` — **ОТОБРАЖАЕМАЯ** геометрия, то есть уже после поворота из side-data.
  //   Иначе вертикальное видео с телефона (`1920×1080` в потоке, `rotation: 90`) легло бы в
  //   укладку кадра горизонтальным, и «почему ролик набок» выяснялось бы глазами на финале.
  //   Ровно то же поле, что у первой ветки, и читает его та же укладка — расходиться им
  //   нельзя;
  // * `rotation` — **ДЛЯ ЧЕСТНОСТИ, А НЕ ДЛЯ РАСЧЁТА**: геометрия выше уже развёрнута, и
  //   второй раз крутить по этому полю нельзя. Оно существует затем, чтобы «1080×1920» в
  //   записи можно было сверить с тем, что показывает `ffprobe` на файле, не гадая, кто из
  //   двоих ошибся;
  // * `fps` — см. `FpsSchema`. Берётся `r_frame_rate` (БАЗОВАЯ частота), а не
  //   `avg_frame_rate`: тот же выбор и по той же причине, что у `StreamFingerprint`
  //   (`media/src/assemble/ffprobe.ts`) — средняя частота «плывёт» у усечённого файла;
  // * `frames` — **ПОСЧИТАНО ДЕКОДОМ** (`-count_frames`), а не взято из заголовка. Заголовок
  //   у mp4 обычно прав, но у MPEG-TS поля `nb_frames` нет вовсе (`FACT`, измерено `M-04`), а
  //   ошибка на один кадр здесь — это ошибка на один кадр в T-правилах укладки;
  // * `hasAlpha` — по `pix_fmt` ФАЙЛА. `FACT` (`SP-VID` A4, долг №256): `libvpx-vp9`
  //   принимает `-pix_fmt yuva420p` без единого предупреждения и теряет альфу молча — но
  //   теряет её и в `pix_fmt` готового файла (`ffprobe` показывает `yuv420p`), поэтому
  //   измерение файла честно говорит «альфы нет». Сверено вторым способом (`alphaextract`)
  //   охранником `ASSET-01`;
  // * `audio` — `null` ЯВНО, а не пропуск поля: «дорожки нет» и «не смотрели» — разные
  //   утверждения, и первое обязано быть записано (тот же довод, что у `derivedFrom: null`,
  //   P11). Полей два: частота и число каналов — их читает микс дорожки (V6); битрейта и
  //   кодека здесь нет, они свойства ЭТОГО файла, а не произведения.
  //
  // ЧЕГО В ВЕТКЕ НЕТ И ПОЧЕМУ: КОДЕКА И КОНТЕЙНЕРА. Их не читает никто. Сборка по вердикту
  // «(а)» (`SP-VID`) подаёт файл ffmpeg'у ПУТЁМ из CAS, а контейнер ffmpeg определяет по
  // байтам сам (`probe_score: 100` на `work/in/demo.mp4`) — ровно так же, как `magic.ts`
  // выводит расширение из байтов, «потому что имя файла — это адрес, а не тип». Поле `codec`
  // в записи стало бы вторым источником истины против самого файла и разошлось бы с ним при
  // первой перекодировке; где кодек ДЕЙСТВИТЕЛЬНО нужно сверять, там уже есть
  // `StreamFingerprint` из десяти измеренных полей (ADR-0008). Длительности в секундах тоже
  // нет: она есть `frames` ÷ `fps`, и записанная рядом третьим числом расходилась бы с ними.
  z
    .object({
      width: z.int().positive(),
      height: z.int().positive(),
      rotation: RotationSchema,
      fps: FpsSchema,
      frames: z.int().positive(),
      hasAlpha: z.boolean(),
      audio: z.object({ sampleRate: z.int().positive(), channels: z.int().positive() }).strict().nullable(),
    })
    .strict(),
]);

/**
 * `status` — строка без списка допустимых значений, сознательно. Тот же довод, что у
 * `providerId` в P12: enum статусов прав протух бы раньше первого ролика, а юридическую
 * сторону закрывает `sourceSnapshot`, а не перечень.
 */
const WorkSchema = z
  .object({
    status: identifier(),
    note: z.string().optional(),
  })
  .strict();

const ReproductionSchema = z
  .object({
    status: identifier(),
    attributionRequired: z.boolean(),
    attributionText: z.string().optional(),
  })
  .strict();

const RecordingSchema = z
  .object({
    status: identifier(),
  })
  .strict();

const OriginSchema = z
  .object({
    sourceUrl: identifier().url().nullable(),
    retrievedAt: identifier(),
  })
  .strict();

/** Снимок страницы условий. `FACT` (r3 §3.4): страницы условий исчезают и меняются. */
const SourceSnapshotSchema = z
  .object({
    sha256: sha256Hex(),
    capturedAt: identifier(),
  })
  .strict();

/** ADR-0005 §9b: форма provenance AI-арта. Поля опциональны — обязательными их делает `A-01`. */
const GeneratorSchema = z
  .object({
    providerId: identifier(),
    modelId: identifier(),
    modelVersion: identifier(),
  })
  .strict();

const GenerationSchema = z
  .object({
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    seed: z.int(),
    parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    generatedAt: identifier(),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    // Раздельные статусы произведения / репродукции / записи — ADR-0005 §9a.
    work: WorkSchema,
    reproduction: ReproductionSchema,
    recording: RecordingSchema,
    origin: OriginSchema,
    sourceSnapshot: SourceSnapshotSchema.nullable(),
    c2paManifestBlob: sha256Hex().nullable(),
    generator: GeneratorSchema.optional(),
    generation: GenerationSchema.optional(),
  })
  .strict();

/** ADR-0005 §9b: цепочка прав тянется к референсу явно. */
const DerivedFromSchema = z
  .object({
    sha256: sha256Hex(),
    transform: z
      .object({
        op: identifier(),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        toolVersion: identifier(),
      })
      .strict(),
  })
  .strict();

export const AssetRecordSchema = z
  .object({
    schema: z.literal('asset-record/1'),
    sha256: sha256Hex(),
    kind: identifier(),
    intrinsic: IntrinsicSchema,
    // P11: `derivedFrom: null` — ЯВНОЕ УТВЕРЖДЕНИЕ, а не пропуск поля. Поэтому поле
    // обязательное и nullable, а не опциональное.
    derivedFrom: DerivedFromSchema.nullable(),
    provenance: ProvenanceSchema,
  })
  .strict();

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
