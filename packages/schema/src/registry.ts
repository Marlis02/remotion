// Реестр семейств файлов (ADR-0005 §3: «версия схемы — у каждого семейства своя, в шапке»).
//
// ОДНО МЕСТО, ГДЕ ПЕРЕЧИСЛЕНЫ ВСЕ СЕМЕЙСТВА. Читатель и писатель ничего не знают про
// конкретные семейства и берут всё отсюда: добавление тринадцатого семейства — одна строка
// в этой таблице плюс файл схемы, и ни одной правки в `read.ts`/`write.ts`.
//
// ФОРМА ВЕРСИЙ — union, сейчас из одного элемента у всех (ADR-0005 §4: «одна функция чтения
// на семейство понимает все исторические варианты»). Она заведена ДО первого бампа
// намеренно: если бы `versions` был одиночной схемой, первый бамп менял бы и структуру
// реестра, и читателя, и все тесты разом. Сейчас он добавляет строку в `versions`.

import type { z } from 'zod';

import { AliasesSchema } from './families/aliases.js';
import { AnchorEntrySchema } from './families/anchors.js';
import { AssetRecordSchema } from './families/asset-record.js';
import { AudioProfileSchema } from './families/audio-profile.js';
import { CompileProfileSchema } from './families/compile-profile.js';
import { DirectionSchema } from './families/direction.js';
import { ProjectSchema } from './families/project.js';
import { SourceDialectHeaderSchema } from './families/source-dialect.js';
import { PublishSchema } from './families/publish.js';
import { StoreLockSchema } from './families/store-lock.js';
import { VoiceRolesSchema } from './families/voice-roles.js';
import { RenderProfileSchema } from './profiles/render-profile.js';

/**
 * Как файл разложен на диске.
 *
 * * `yaml` — один YAML-документ, шапка — поле `schema` верхнего уровня;
 * * `json` — один JSON-объект, шапка — поле `schema`;
 * * `jsonl` — **строка = запись** (ADR-0005 §10), шапка — ПЕРВОЙ СТРОКОЙ, отдельным
 *   объектом `{"schema":"anchors/1"}`. Это `INFERENCE`: ADR-0005 §3 требует шапку, но не
 *   называет её синтаксис для JSONL; объект первой строкой — единственная форма, при которой
 *   файл остаётся валидным JSONL целиком;
 * * `markdown-header` — проза с шапкой в первой строке. Тело НЕ разбирается: диалект `source/`
 *   читает лексер (`C-02`).
 */
export type FamilyFormat = 'yaml' | 'json' | 'jsonl' | 'markdown-header';

export interface FamilyEntry {
  readonly family: string;
  /** Версия → схема. Union по версиям; сейчас у всех ровно одна. */
  readonly versions: ReadonlyMap<number, z.ZodType>;
  /** Текущая версия — та, которую пишет писатель. */
  readonly current: number;
  readonly format: FamilyFormat;
  /**
   * Может ли писатель создать этот файл целиком.
   *
   * `false` у `source-dialect/1`, и это защита, а не недоделка: схема семейства — ТОЛЬКО
   * шапка, тела прозы читатель не разбирает. Писатель, вызванный на прозе, вернул бы файл
   * из одной строки и уничтожил бы сценарий. Отказ громче потери.
   */
  readonly writable: boolean;
  /**
   * Диалект `source/` не мигрируется НИКОГДА (M7, ADR-0005 §4): маркеры добавляются, старые
   * не удаляются и не меняют смысла. Самой опасной миграции просто не существует.
   */
  readonly neverMigrates: boolean;
}

function entry(
  family: string,
  version: number,
  schema: z.ZodType,
  format: FamilyFormat,
  options: { writable?: boolean; neverMigrates?: boolean } = {},
): FamilyEntry {
  return {
    family,
    versions: new Map([[version, schema]]),
    current: version,
    format,
    writable: options.writable ?? true,
    neverMigrates: options.neverMigrates ?? false,
  };
}

/**
 * Двенадцать семейств.
 *
 * `override/1` в реестре **нет**, и это решение владельца (`S-02`, 2026-08-22): ADR-0004 §7
 * задаёт формат журнала, но не схему записи — четыре класса операций видны только как примеры
 * в таблице таксономии §7. Форму предложит `C-04`/`O-01` вместе с правкой ADR-0004 §7, где
 * появится единственный писатель. Черновик, выведенный из ADR, лежит в
 * `docs/impl/S-02/report.md` как материал для той задачи, а не в коде.
 */
const ENTRIES: readonly FamilyEntry[] = [
  entry('project', 1, ProjectSchema, 'yaml'),
  entry('compile-profile', 1, CompileProfileSchema, 'yaml'),
  // `render-profile/1` лежит в `src/profiles/` с задачи `R-02` — путь сохранён, чтобы ссылки
  // в отчёте `R-02` и в `docs/invariants.md` (строка P10) остались верными.
  entry('render-profile', 1, RenderProfileSchema, 'yaml'),
  entry('audio-profile', 1, AudioProfileSchema, 'yaml'),
  entry('direction', 1, DirectionSchema, 'yaml'),
  entry('publish', 1, PublishSchema, 'yaml'),
  entry('aliases', 1, AliasesSchema, 'yaml'),
  entry('store-lock', 1, StoreLockSchema, 'yaml'),
  entry('voice-roles', 1, VoiceRolesSchema, 'yaml'),
  entry('asset-record', 1, AssetRecordSchema, 'json'),
  entry('anchors', 1, AnchorEntrySchema, 'jsonl'),
  entry('source-dialect', 1, SourceDialectHeaderSchema, 'markdown-header', {
    writable: false,
    neverMigrates: true,
  }),
];

export const FAMILIES: ReadonlyMap<string, FamilyEntry> = new Map(
  ENTRIES.map((item) => [item.family, item]),
);

export const FAMILY_NAMES: readonly string[] = ENTRIES.map((item) => item.family);
