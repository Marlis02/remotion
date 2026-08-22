// `publish/1` — ADR-0005 §2a. Единственный вход BLOCK-правил Policy Guard (находка C7).
//
// ПОЛЯ ЗАВЕДЕНЫ ВСЕ, включая те, чьи правила в MVP не реализуются (`core.md` §18.3 п. 17).
// Причина записана в самом ADR: поле стоит строки в схеме, а миграция формата после первого
// ролика стоит несравнимо больше. В MVP реально проверяются домены D и E.

import { z } from 'zod';

import { publicAnchor } from './common.js';
import { identifier } from './marks.js';

/** PG-C1/C2/C3 — раскрытие синтетики. */
const DisclosureSchema = z
  .object({
    syntheticVoice: z.boolean(),
    aiImagery: z.boolean(),
    aiMusic: z.boolean(),
  })
  .strict();

/**
 * PG-A1/A6 — указанный источник текста сценария.
 *
 * URL законны ЗДЕСЬ и запрещены только в прозе (ADR-0002 §3). Без этой оговорки нормативный
 * линт прозы конфликтовал бы с обязательным BLOCK-правилом PG-A1.
 */
const SourceSchema = z
  .object({
    url: identifier().url(),
    appliesTo: publicAnchor(),
  })
  .strict();

export const PublishSchema = z
  .object({
    schema: z.literal('publish/1'),
    // КОНТЕНТ (уходит в публикацию) ⇒ английский, Charter V12. Охранник — строка V13 реестра.
    title: z.string().min(1),
    // `{{attributions}}` — единственный слот, который заполняет компилятор из provenance
    // ассетов; это и делает PG-D5 (BLOCK) исполнимым.
    descriptionTemplate: z.string(),
    topic: identifier(), // PG-A5/A6
    // PG-A5, трёхфакторный чек AI-персоны. Ссылается на роль из `voice-roles/1`, поэтому
    // enum здесь невозможен: множество ролей задаёт канал, а не схема.
    voiceRole: identifier(),
    madeForKids: z.boolean(), // PG-A8
    disclosure: DisclosureSchema,
    sources: z.array(SourceSchema),
  })
  .strict();

export type Publish = z.infer<typeof PublishSchema>;
