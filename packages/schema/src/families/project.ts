// `project/1` — корневой файл проекта (ADR-0005 §1).

import { z } from 'zod';

import { FpsSchema } from './common.js';
import { identifier } from './marks.js';

/**
 * Имя переменной окружения в форме POSIX. Тот же валидатор, что в `voice-roles/1`: настоящие
 * идентификаторы голоса провайдера (`21m00Tcm4TlvDq8ikWAM` у ElevenLabs) — строчные
 * алфавитно-цифровые, под правило не подходят и отвергаются.
 */
const environmentVariableName = (): z.ZodString =>
  identifier().regex(
    /^[A-Z][A-Z0-9_]*$/,
    '`voiceId` — ИМЯ переменной окружения (`VPE_MOCK_VOICE_ID`), а не её значение: секреты берутся только из `process.env` (CLAUDE.md §2)',
  );

/**
 * Раскладка профилей — ADR-0005 §1 плюс §1a. Все пять ключей обязательны, и это не строгость
 * ради строгости: `draft` объявлен обязательным в ADR-0008 («Draft» — механизм AC3),
 * `renderAc4` требуется Charter AC4 rev5 (полный прогон фикстурного проекта).
 */
const ProfilesSchema = z
  .object({
    compile: identifier(),
    render: identifier(),
    draft: identifier(),
    renderAc4: identifier(),
    audio: identifier(),
  })
  .strict();

/**
 * Провайдер речи проекта.
 *
 * `voiceId` держит **ИМЯ ПЕРЕМЕННОЙ ОКРУЖЕНИЯ**, а не значение — решение владельца
 * (`S-02-fix`, 2026-08-22), то же правило и тот же валидатор, что у `voice-roles/1`.
 * До правки поле принимало литерал, и охранника у Charter §6 / CLAUDE.md §2 («`voice_id`
 * только из `process.env`») в этом семействе не было вовсе: боевой идентификатор голоса,
 * вписанный сюда руками, уехал бы в git молча.
 *
 * Правило действует и на мок: в фикстуре стоит `VPE_MOCK_VOICE_ID`, а не `mock-voice-a`.
 * Одно правило без исключений дешевле двух: исключение «у мока можно» пришлось бы
 * проверять по значению `providerId`, то есть межполевым правилом ради удобства записи.
 * Значение переменной сейчас никто не читает — это задача `A-02`.
 */
const VoiceSchema = z
  .object({
    providerId: identifier(),
    modelId: identifier(),
    voiceId: environmentVariableName(),
    seed: z.int().nonnegative(),
    binderId: identifier(),
  })
  .strict();

/**
 * `.store` живёт ВНЕ дерева проекта (ADR-0005 §8a, инвариант M8): `git clean -xdf` не должен
 * уносить единственную копию невоспроизводимого аудио.
 *
 * `remotes` без нижней границы: правило «реплик ≥ 2» (P7) относится к записям **определённых
 * видов** (`voice`/`snapshot`/`ai-image`) в `store.lock`, а не к длине этого списка, и его
 * охранник назван — `vpe store verify`.
 */
const StoreSchema = z
  .object({
    path: identifier(),
    remotes: z.array(identifier()),
  })
  .strict();

export const ProjectSchema = z
  .object({
    schema: z.literal('project/1'),
    id: identifier(),
    channelId: identifier(),
    // Геометрия времени — часть ПРОИЗВЕДЕНИЯ (ADR-0006 §5): смена меняет IR всех сегментов.
    fps: FpsSchema,
    width: z.int().positive(),
    height: z.int().positive(),
    // Источник истины физического времени (ADR-0003 T1).
    projectSampleRate: z.int().positive(),
    // Коммитится и входит в иерархию seed'ов (ADR-0007 §1).
    seedRoot: z.int().nonnegative(),
    profiles: ProfilesSchema,
    voice: VoiceSchema,
    store: StoreSchema,
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;
