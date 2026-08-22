// `project/1` — корневой файл проекта (ADR-0005 §1).

import { z } from 'zod';

import { FpsSchema } from './common.js';
import { identifier } from './marks.js';

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
 * Провайдер речи проекта. `voiceId` здесь — **значение**, и в фикстуре это `mock-voice-a`
 * провайдера `tts:mock@1` (ADR-0010 §7): у мока идентификатор голоса не секрет.
 *
 * ВНИМАНИЕ, записано явно и охранника не имеет: для боевого провайдера литерал в этом поле
 * нарушал бы Charter §6 и CLAUDE.md §2 («`voice_id` только из `process.env`»). Схема этого
 * не ловит — правило сформулировано про боевой ключ, а не про форму поля, и запрет литерала
 * сломал бы фикстуру. Ср. `voice-roles/1`, где поле держит **имя переменной** и валидатор
 * это проверяет. Вопрос «должен ли `project/1` тоже держать имя переменной» — владельцу.
 */
const VoiceSchema = z
  .object({
    providerId: identifier(),
    modelId: identifier(),
    voiceId: identifier(),
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
