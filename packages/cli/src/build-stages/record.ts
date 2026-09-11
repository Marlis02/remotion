// **`BuildRecord` И ПЕРСИСТ СТАДИЙ** (`L-01`): что легло в `build/`, из чего это собрано и
// чем измерено.
//
// ═══ ЧТО ЗДЕСЬ АРТЕФАКТ, А ЧТО ОТЧЁТ — И ПОЧЕМУ ЭТО РАЗНЫЕ КАТАЛОГИ ═══
// `build/**` (кроме `build/reports/**`) — ВЫХОДЫ СТАДИЙ: они обязаны быть равны побайтово у
// двух сборок с разным `now`, и ровно это проверяет тест. `build/reports/**` — ОТЧЁТЫ: в них
// живёт то, что от прогона зависит, — момент сборки, стенка, число обращений к провайдеру.
// Смешать их значило бы сделать критерий «две сборки дают равные артефакты» невыполнимым по
// построению, а потом ослабить его сравнением «с точностью до полей».
//
// `BuildRecord` — ОТЧЁТ, и он лежит в `reports/`. Его отличие от прочих отчётов в том, что он
// есть ЧИСТАЯ ФУНКЦИЯ входов и `now`: две сборки с разным `now` дают записи, различающиеся
// РОВНО ОДНИМ полем `now`. Тест это и утверждает — сравнением записей со снятым `now`.
// Поэтому стенки, счётчиков попыток и пиков RSS в записи нет: они уехали в `timings.txt`.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '@vpe/core-model';

import { sha256Of, type InputFile } from './inputs.js';

/** Файл, положенный стадией: имя стадии, путь ОТНОСИТЕЛЬНО `build/` и sha256 байтов. */
export interface StageOutput {
  readonly stage: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Измерение сегмента — то, чем он адресуется и что о нём известно после кодирования. */
export interface SegmentRow {
  readonly segmentId: string;
  readonly segmentIrHash: string;
  readonly bundleHash: string;
  readonly sha256: string;
  readonly framemd5Sha256: string;
  readonly frameCount: number;
  /**
   * Откуда взялись байты сегмента (`CACHE-01`): `hit` — межсборочный кэш, `miss` — рендер,
   * `off` — кэш выключен `--no-cache`.
   *
   * ЭТО ЕДИНСТВЕННОЕ ПОЛЕ ЗАПИСИ, КОТОРОЕ ОТ ПРОГОНА ЗАВИСИТ ПО СУЩЕСТВУ, и оно здесь, а не в
   * `timings.txt`, намеренно: «холодная сборка и прогретая дали равные артефакты» — это
   * утверждение о `sha256`/`framemd5Sha256` СОСЕДНИХ полей, и читать его надо в одной строке
   * с тем, откуда байты пришли. Родня ему — `voice.sourceCalls`/`voice.cacheHits`, которые
   * зависят от прогона ровно так же и лежат в записи с `L-01`.
   */
  readonly cache: 'hit' | 'miss' | 'off';
}

/**
 * **`BuildRecord`** — «из чего собрано, чем измерено, когда».
 *
 * ПОЧЕМУ `now` ЛЕЖИТ ПОЛЕМ, А НЕ ЧИТАЕТСЯ. **D9**: «`now` — вход сборки, внутри compile его
 * нет». Значение приезжает флагом `--now`, переменной `VPE_NOW` либо часами `bin/vpe.ts` — и
 * ни одна стадия его не спрашивает у системы (линт `v8-clock-readers`).
 */
export interface BuildRecord {
  readonly buildRecordVersion: 1;
  readonly now: string;
  readonly project: {
    readonly id: string;
    readonly channelId: string;
    readonly profileId: string;
  };
  readonly versions: {
    readonly templateRegistryVersion: string;
    readonly engineFingerprint: string;
    readonly seedRoot: number;
  };
  /** Входные файлы проекта с их sha256 — «из чего», а не «из каких путей». */
  readonly inputs: readonly InputFile[];
  /** Выходы стадий в порядке их исполнения. */
  readonly stages: readonly StageOutput[];
  readonly segments: readonly SegmentRow[];
  readonly voice: {
    readonly chunks: number;
    /** Сколько раз позван источник дубля — «сколько оплачено» (**K3**). */
    readonly sourceCalls: number;
    readonly cacheHits: number;
  };
  /**
   * Межсборочный кэш СЕГМЕНТОВ (`CACHE-01`) — блок верхнего уровня, а НЕ поле внутри `voice`.
   *
   * ═══ ПОЧЕМУ ЭТИ ЧИСЛА НЕЛЬЗЯ СЛИВАТЬ С `voice.cacheHits` ═══
   * Разница найдена владельцем на первой живой сборке и записана дословно в
   * [`pipeline.ts`](pipeline.ts) (поле `reusedTakes`): `voice.cacheHits` считает попадания
   * кэша СТАДИИ ГОЛОСА — «за что эта сборка не заплатила деньгами», — а `segmentHits`
   * считает несостоявшиеся РЕНДЕРЫ, то есть сэкономленные минуты. Сложить их в одно число
   * значило бы получить величину, из которой не следует ни то, ни другое.
   *
   * `mode` отдельным полем, а не выводится из равенства `segmentHits` нулю: холодная сборка с
   * кэшем и сборка с `--no-cache` дают один и тот же ноль попаданий и это РАЗНЫЕ события.
   */
  readonly cache: {
    readonly mode: 'on' | 'off';
    readonly segments: number;
    readonly segmentHits: number;
  };
  readonly audio: {
    readonly totalSamples: number;
    readonly totalFrames: number;
    readonly trackSha256: string;
    /**
     * Состав микса (`X-02`, 2026-09-12): что сложено в дорожку и что при этом случилось.
     *
     * **`clipped` — ФАКТ В ЗАПИСИ, А НЕ ОТКАЗ СБОРКИ** (пересмотр долга №63 владельцем):
     * насыщение видно числом, ролик собирается. Ноль подложек при непустом `music[]` плана —
     * тоже утверждение: либо `mix.enabled: false`, либо шаблон звука не объявил.
     */
    readonly mix: {
      /** `on`/`off` — ручка профиля, а не вывод из числа подложек (их может не быть вовсе). */
      readonly mode: 'on' | 'off';
      readonly beds: number;
      readonly clippedSamples: number;
      /** Пик дорожки по сэмплам: точное целое, без единого float (`measureLoudness`). */
      readonly samplePeak: number;
      readonly fullScaleSamples: number;
    };
  };
  readonly final: { readonly file: string; readonly sha256: string } | null;
}

/** Писатель стадий: кладёт файл в `build/`, считает sha256 и копит перечень для записи. */
export class StageWriter {
  readonly #buildDir: string;
  readonly #outputs: StageOutput[] = [];

  constructor(buildDir: string) {
    this.#buildDir = buildDir;
  }

  /** Кладёт байты (или текст) стадии. `relative` — путь внутри `build/`. */
  write(stage: string, relative: string, body: string | Uint8Array): StageOutput {
    const absolute = path.join(this.#buildDir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    writeFileSync(absolute, bytes);
    const output: StageOutput = {
      stage,
      file: relative,
      sha256: sha256Of(bytes),
      bytes: bytes.length,
    };
    this.#outputs.push(output);
    return output;
  }

  /** Перечень положенного — в порядке записи, то есть в порядке стадий. */
  get outputs(): readonly StageOutput[] {
    return this.#outputs;
  }
}

/**
 * Кладёт `BuildRecord` в `build/reports/build-record.json`.
 *
 * `canonicalJson`, а не `JSON.stringify`: запись сравнивается диффом между сборками, и две
 * формы записи одного факта дали бы дифф на ровном месте (ADR-0007 §3; в исходниках пакетов
 * `JSON.stringify` запрещён линтом вовсе).
 */
export function writeBuildRecord(buildDir: string, record: BuildRecord): string {
  const file = path.join(buildDir, 'reports', 'build-record.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${canonicalJson(record)}\n`, 'utf8');
  return file;
}

/** Отчёт прогона: то, что от прогона зависит. В `BuildRecord` этому места нет (см. шапку). */
export function writeReport(buildDir: string, name: string, text: string): string {
  const file = path.join(buildDir, 'reports', name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return file;
}
