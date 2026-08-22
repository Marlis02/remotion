// Семейство `render-profile/1` — схема и чтение.
//
// ЧТО ЭТО ЗА ФАЙЛ (ADR-0005 §9, M9). Профиль рендера содержит ТОЛЬКО НАМЕРЕНИЕ ЧЕЛОВЕКА.
// Измеренное окружение (версии hyperframes / chrome-headless-shell / gsap / three / ffmpeg,
// фактическая строка запуска Chrome, платформа, фактическая командная строка энкодера)
// живёт в одном месте — `engineFingerprint` (ADR-0006 §3) — и в схему профиля не попадает
// ни под каким именем. Это инвариант K6; в части профилей он охраняется тестом
// `packages/schema/test/render-profile.test.ts` («ни одного ключа с version/hash/sha/
// checksum/fingerprint в имени»), а не соглашением.
//
// СОСТАВ ПОЛЕЙ. Ровно то, что лежит в трёх файлах фикстуры
// `fixtures/minimal/profiles/render.{final,draft,ac4}.yaml`. Ничего сверх: лишнее поле в схеме
// означало бы, что профиль знает что-то, чего нет в артефакте (P10).
//
// ПОЧЕМУ `.strict()` НА КАЖДОМ УРОВНЕ (P10, roadmap §9 п. 1). Из профилей удалены поля снятого
// кандидата-рендерера (`gl: swangle`, `concurrency`, `offthreadVideoCacheSizeInBytes`,
// `mediaCacheSizeInBytes`, `offthreadVideoThreads`, `disallowParallelEncoding`). Дрейф вида
// «поле осталось от прошлого рендерера и молча игнорируется» — ровно тот класс ошибки, который
// эта схема обязана ловить, поэтому неизвестное поле — ОШИБКА, а не WARN и не strip.
//
// ГРАНИЦА ЖЁСТКОСТИ (решение владельца, R-02, 2026-08-22). Жёстко ограничено только то, что
// записано в ADR: `threads` (D13 / ADR-0006 §5 — число, никогда `auto`), `chapterParallelism`
// (ADR-0008 «Параллелизм» — в v1 константа), `workers` (ADR-0008), `scale` (ADR-0008 «Draft»),
// `profileId` (таблица ADR-0005 §1a), `imageFormat` + условие на `jpegQuality`. Остальные поля
// получают тип и физически обязательную границу — без выдуманных enum'ов и верхних порогов:
// ни один ADR не нормирует множество допустимых `colorSpace`/`codec`/`preset`, и `enum(['bt709'])`
// был бы решением, которого никто не принимал. P10 и K6 — правила про ИМЕНА полей, а не про
// области значений.

import { z } from 'zod';

/** Семейство файлов (ADR-0005 §3: `schema: <family>/N` в шапке). */
export const RENDER_PROFILE_FAMILY = 'render-profile';

/**
 * Версия схемы семейства. ADR-0006 §3: `schemaVersion` (руками, редко, служит миграциям)
 * — это НЕ `engineFingerprint` (автоматически, служит кэшу). K6 запрещает поля версий
 * в самом профиле; версия семейства — часть шапки формата, а не поле данных.
 */
export const RENDER_PROFILE_VERSION = 1;

/** Значение шапки целиком: `render-profile/1`. */
export const RENDER_PROFILE_HEADER = `${RENDER_PROFILE_FAMILY}/${RENDER_PROFILE_VERSION}`;

/**
 * `profileId` — то, чем именуются пространства имён кэша (ADR-0006 §13) и чем адресуется
 * запись гейта V13 в манифесте шаблона (R12). Множество закрыто таблицей ADR-0005 §1a:
 * `render.final.yaml` → `final`, `render.draft.yaml` → `draftHalf`, `render.ac4.yaml` → `ac4`.
 */
export const RENDER_PROFILE_IDS = ['final', 'draftHalf', 'ac4'] as const;

/** Параметры энкодера целиком (находка C5, ADR-0006 §5). */
const EncoderProfileSchema = z
  .object({
    // ADR-0006 §5 и D13: ЧИСЛО, никогда `auto`. `threads=1` и `threads=4` дают разный
    // битстрим между собой (FACT SP-3d §4.3), поэтому машинно-зависимое значение здесь
    // сделало бы AC4 недостижимым при полностью корректной остальной архитектуре.
    threads: z.int().positive(),
    preset: z.string().min(1),
    tune: z.string().min(1),
    rcLookahead: z.int().nonnegative(),
    aqMode: z.int().nonnegative(),
    psy: z.int().nonnegative(),
    // `-fflags +bitexact` / `-flags:v +bitexact`.
    bitexact: z.boolean(),
  })
  .strict();

/** Всё, что меняет ПИКСЕЛИ. Входит в ключ стадии `segment` (ADR-0006 §5). */
const PixelProfileSchema = z
  .object({
    // `--no-browser-gpu`: софтверный путь (ADR-0008). Бэкенд растеризации меняет пиксели,
    // поэтому величина живёт в `pixelProfile`, а не в `executionProfile`.
    browserGpu: z.boolean(),
    imageFormat: z.enum(['jpeg', 'png']),
    // Условие «обязателен при jpeg, запрещён при png» — ниже, в `.superRefine`:
    // оно межполевое и на уровне одного поля невыразимо.
    jpegQuality: z.int().min(1).max(100).optional(),
    // ADR-0008 «Draft»: `scale` 0.5 у `draftHalf`, 0.25 у `ac4`, 1 у `final`. Масштаб < 1
    // раскрывает АДАПТЕР в геометрию композиции; увеличение (> 1) контрактом не предусмотрено.
    scale: z.number().gt(0).lte(1),
    colorSpace: z.string().min(1),
    pixelFormat: z.string().min(1),
    codec: z.string().min(1),
    crf: z.number().nonnegative(),
    // GOP задаётся явно, чтобы «не решал энкодер» (ADR-0008, «Сборка»).
    gopSize: z.int().positive(),
    encoder: EncoderProfileSchema,
  })
  .strict()
  .superRefine((pixelProfile, ctx) => {
    // `jpegQuality` при `imageFormat: png` — не безобидное лишнее поле, а вычисляемо
    // бессмысленное: профиль `ac4` изолирует Chrome от энкодера именно тем, что хэширует
    // кадр ДО энкода, и качество JPEG там ни на что не влияет. Молча проигнорировать его
    // значит позволить профилю врать о себе.
    if (pixelProfile.imageFormat === 'jpeg' && pixelProfile.jpegQuality === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['jpegQuality'],
        message: '`jpegQuality` обязателен при `imageFormat: jpeg`',
      });
    }
    if (pixelProfile.imageFormat === 'png' && pixelProfile.jpegQuality !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['jpegQuality'],
        message: '`jpegQuality` запрещён при `imageFormat: png`',
      });
    }
  });

/** Всё, что меняет СКОРОСТЬ и ничего не меняет в картинке (ADR-0006 §5: ни в один ключ). */
const ExecutionProfileSchema = z
  .object({
    // = логических ядер / 3 (ADR-0008). ЧИСЛО, а не формула: профиль — намерение человека (M9),
    // вычисляемых полей в нём нет (P10). Снижение `workers` — откат №2 лестницы ADR-0008.
    workers: z.int().positive(),
    // ADR-0008 «Параллелизм»: в v1 КОНСТАНТА, а не настройка. Механика параллельного рендера
    // глав не строится, поэтому `2` здесь — не «медленнее/быстрее», а необеспеченное обещание.
    chapterParallelism: z.literal(1),
    segmentTimeoutMs: z.int().positive(),
  })
  .strict();

/** Схема семейства `render-profile/1`. */
export const RenderProfileSchema = z
  .object({
    schema: z.literal(RENDER_PROFILE_HEADER),
    profileId: z.enum(RENDER_PROFILE_IDS),
    pixelProfile: PixelProfileSchema,
    executionProfile: ExecutionProfileSchema,
    // Только у `ac4`: ограничение прогона ≤ 3 с видео, иначе AC4 не помещается
    // в цикл коммита (ADR-0007 §10).
    maxProbeDurationFrames: z.int().positive().optional(),
  })
  .strict();

export type RenderProfile = z.infer<typeof RenderProfileSchema>;
