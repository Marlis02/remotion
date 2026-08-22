// `voice-roles/1` — пресеты ролей голоса (ADR-0005 §1b, ADR-0010 §3a-bis).
//
// ФОРМА УТОЧНЕНА РЕШЕНИЕМ ВЛАДЕЛЬЦА (`S-02`, 2026-08-22). ADR давал состав («роль несёт
// `voice_settings` и модель/голос по умолчанию»), но не давал контейнер и имена полей.
// Принято: **список, а не карта** (порядок канонический и диффится построчно);
// `providerId` на роль **нет** — провайдер один на проект, из `project.yaml.voice`;
// `modelId` **опционален** и наследует `project.yaml.voice.modelId`; `voice_id` **обязателен**.

import { z } from 'zod';

import { identifier } from './marks.js';

/**
 * `voice_id` держит **ИМЯ ПЕРЕМЕННОЙ ОКРУЖЕНИЯ**, а не значение (CLAUDE.md §2, Charter §6).
 * Валидатор — не косметика: он ловит ровно ту ошибку, ради которой правило написано, —
 * человек вставил в файл настоящий `voice_id` из дашборда провайдера, и тот уехал в git.
 *
 * Форма имени — POSIX: заглавные, цифры и `_`, первым символом не цифра. Настоящие `voice_id`
 * ElevenLabs — строчный алфавитно-цифровой (`21m00Tcm4TlvDq8ikWAM`), то есть под правило не
 * подходят и отвергаются.
 */
const environmentVariableName = (): z.ZodString =>
  identifier().regex(
    /^[A-Z][A-Z0-9_]*$/,
    '`voice_id` — ИМЯ переменной окружения (`ELEVENLABS_VOICE_ID`), а не её значение: секреты берутся только из `process.env` (CLAUDE.md §2)',
  );

const VoiceRoleSchema = z
  .object({
    roleId: identifier(),
    // Опционален: пустое место наследует `project.yaml.voice.modelId`.
    modelId: identifier().optional(),
    voice_id: environmentVariableName(),
    /**
     * `voice_settings` уходят провайдеру КАК ЕСТЬ — это его `providerOpts` (ADR-0010 §8,
     * «ветвление по capabilities»). Нормировать их здесь значило бы держать копию контракта
     * провайдера в нашей схеме и обновлять её при каждом его релизе.
     *
     * Следствие, уже записанное в ADR-0006 §2: `roleDigest` считается как blake3 канонической
     * формы применимых записей — то есть правка любого поля внутри `voice_settings` меняет
     * `voiceKey` (инвариант V15), даже если движок не знает, что это поле означает.
     */
    voice_settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

export const VoiceRolesSchema = z
  .object({
    schema: z.literal('voice-roles/1'),
    roles: z.array(VoiceRoleSchema),
  })
  .strict();

export type VoiceRoles = z.infer<typeof VoiceRolesSchema>;
