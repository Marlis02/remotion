// Механизм кэша стадий: `get`/`put` по ключу, манифест, проверка на попадании (`M-05`).
//
// ADR-0006 §8 ДОСЛОВНО, И ЭТОТ ФАЙЛ ЕГО ИСПОЛНЯЕТ: «Запись в CAS только `tmp + fsync +
// rename`. В манифесте рядом с ключом — `sha256`, размер, `frameCount`. На попадании
// проверяются размер и `frameCount` (дёшево), `sha256` — под `--verify-cache` и всегда в
// ночном прогоне. Для `voice/` `sha256` обязателен ВСЕГДА: пути восстановления нет».
//
// ADR-0006 §10 ДОСЛОВНО: «фикстура собирается дважды — холодный кэш и прогретый — и все
// выходные артефакты обязаны совпасть. ПОПАДАНИЕ ОБЯЗАНО БЫТЬ РАВНО ПРОМАХУ». Здесь это
// свойство типа: `get` возвращает ровно те байты, что были отданы `put`, либо не возвращает
// ничего. Третьего исхода («похожие байты») нет — на этом стоит **K3**.
//
// ЭТО НЕ ВТОРОЙ CAS, И ГРАНИЦА ПРОХОДИТ ПО ВОССТАНОВИМОСТИ. `.store` хранит то, что нельзя
// воссоздать чистой функцией из репозитория (ADR-0005 §2) — прежде всего оплаченные дубли; он
// не подлежит GC никогда (**K10**) и адресуется по sha256 СОДЕРЖИМОГО. Кэш хранит то, что
// пересчитывается, и адресуется по ключу ВХОДОВ. Отсюда практическое следствие для стадии
// `voice`: байты дубля в кэш НЕ КОПИРУЮТСЯ — они уже лежат в `.store`, а значением кэша
// служит маленькая каноническая запись, в которой их sha256 и всё, что иначе пришлось бы
// считать заново. Скопируй мы сюда PCM — те же байты жили бы в двух местах, и одно из них
// подлежало бы вытеснению.
//
// ПРОМАХ `voice` НЕ ЗОВЁТ СЕТЬ (ADR-0006 §9, **K8**). Здесь этого гейта нет намеренно: он
// стоит у ВЫЗЫВАЮЩЕГО, который и решает, какой источник дубля подставить (`record.ts` это уже
// записал). Два места, решающих «ходить ли в сеть», — это одно место слишком много.
//
// ЧЕГО ЗДЕСЬ НЕТ: GC (ADR-0006 §13 — отложен, решение владельца `M-05` вопрос 5) и
// параллельной записи манифеста. Второе названо долгом: манифест перечитывается и пишется
// целиком на каждый `put`, и два ОДНОВРЕМЕННЫХ `put` в одно пространство имён потеряли бы
// одну запись. В v1 сборка однопроцессна, `chapterParallelism` — литерал 1 (ADR-0008).

import { readFile } from 'node:fs/promises';

import { canonicalJson } from '@vpe/schema';

import { writeAtomic } from '../store/atomic.js';
import { sha256Of } from '../store/local.js';

import { CacheError } from './errors.js';
import { assertKeyShape, cacheManifestPath, cacheValuePath, type CacheAddress } from './layout.js';

/**
 * Запись манифеста — состав ADR-0006 §8.
 *
 * `frameCount` необязателен и это не мягкость: он есть у сегмента (там его дёшево проверить
 * и он ловит усечение) и его нет ни у записи `voice`, ни у `compose` — кадров там нет вовсе.
 * Пустое место лучше нуля: `frameCount: 0` означал бы «кадров ноль», то есть ложь.
 */
export interface CacheManifestEntry {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly frameCount?: number;
}

/** Манифест пространства имён: записи, упорядоченные по ключу. */
export interface CacheManifest {
  readonly stage: string;
  readonly entries: readonly CacheManifestEntry[];
}

/** Что кладут в кэш вместе с байтами. */
export interface CachePutMeta {
  readonly frameCount?: number;
}

export interface StageCacheOptions {
  /**
   * Сверять ли sha256 на попадании — флаг `--verify-cache` (ADR-0006 §8), приходит ЗНАЧЕНИЕМ.
   *
   * Для стадии `voice` значение игнорируется: там sha256 проверяется ВСЕГДА, потому что пути
   * восстановления нет. Флаг — про дешёвые стадии, а не про деньги.
   */
  readonly verify?: boolean;
}

/** Читает манифест; отсутствие файла — законный «кэш пуст», а не ошибка. */
async function readManifest(projectRoot: string, address: CacheAddress): Promise<CacheManifest> {
  let text: string;
  try {
    text = await readFile(cacheManifestPath(projectRoot, address), 'utf8');
  } catch {
    return { stage: address.stage, entries: [] };
  }
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as CacheManifest).entries)) {
    throw new CacheError(
      'ADR-0006 §8',
      `манифест \`${cacheManifestPath(projectRoot, address)}\` не является записью формы ` +
        '`{stage, entries[]}`. Пустой кэш и ИСПОРЧЕННЫЙ кэш — разные состояния: молча принять ' +
        'второе за первое значило бы пересчитать всё и потерять след порчи',
    );
  }
  return parsed as CacheManifest;
}

/**
 * Пишет манифест целиком и атомарно.
 *
 * Целиком — потому что записей единицы-десятки, а дописывание в конец потребовало бы своей
 * формы восстановления после обрыва. Атомарно — тем же `writeAtomic` (**K7**), что и блобы
 * CAS: оборванная запись манифеста оставила бы кэш, в котором ключи есть, а записи о них нет.
 */
async function writeManifest(projectRoot: string, address: CacheAddress, manifest: CacheManifest): Promise<void> {
  const sorted = [...manifest.entries].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const text = `${canonicalJson({ stage: manifest.stage, entries: sorted })}\n`;
  await writeAtomic(cacheManifestPath(projectRoot, address), new TextEncoder().encode(text));
}

/**
 * Кэш одной стадии в одном пространстве имён.
 *
 * Держит `projectRoot` и адрес, а не глобальное состояние: два пространства имён — два
 * экземпляра, и перепутать их нельзя (`draft` не вытесняет `final`, ADR-0006 §13).
 */
export class StageCache {
  private readonly projectRoot: string;
  private readonly address: CacheAddress;
  private readonly verify: boolean;

  constructor(projectRoot: string, address: CacheAddress, options: StageCacheOptions = {}) {
    this.projectRoot = projectRoot;
    this.address = address;
    // `voice` — всегда, остальные — по флагу. ADR-0006 §8: «пути восстановления нет».
    this.verify = address.stage === 'voice' ? true : (options.verify ?? false);
  }

  /** Запись манифеста по ключу либо `undefined`. Байтов не читает — это дёшево. */
  async lookup(key: string): Promise<CacheManifestEntry | undefined> {
    assertKeyShape(key, this.address);
    const manifest = await readManifest(this.projectRoot, this.address);
    return manifest.entries.find((entry) => entry.key === key);
  }

  /**
   * Байты значения по ключу либо `undefined` — попадание, неотличимое от пересчёта (**K3**).
   *
   * ТРИ ИСХОДА, И КАЖДЫЙ НАЗВАН:
   *   * записи нет — промах, `undefined`. Это нормальная работа кэша;
   *   * запись есть, файла значения нет — ПРОМАХ. Кэш инвалидируется по определению, и
   *     отсутствие байтов лечится пересчётом. Для `voice` пересчёт стоит денег, но и там это
   *     не ошибка кэша: гейт `--allow-tts` (ADR-0006 §9) стоит у вызывающего;
   *   * запись есть, файл есть, но размер или sha256 разошлись — ОШИБКА, а не промах. Молча
   *     пересчитать значило бы стереть след порчи, а порча по адресу ключа — это ровно
   *     «валидный по ключу, но неверный артефакт» из Context ADR-0006.
   */
  async get(key: string): Promise<Uint8Array | undefined> {
    const entry = await this.lookup(key);
    if (entry === undefined) return undefined;

    let bytes: Uint8Array;
    try {
      bytes = await readFile(cacheValuePath(this.projectRoot, this.address, key));
    } catch {
      return undefined;
    }

    if (bytes.length !== entry.size) {
      throw new CacheError(
        'ADR-0006 §8',
        `стадия \`${this.address.stage}\`, ключ \`${key}\`: манифест обещает ` +
          `${String(entry.size)} байт, на диске ${String(bytes.length)}. Усечённое значение по ` +
          'валидному ключу — это прерванная запись, отравившая кэш (ADR-0006 Context, дефект 5)',
      );
    }
    if (this.verify) {
      const actual = String(sha256Of(bytes));
      if (actual !== entry.sha256) {
        throw new CacheError(
          'ADR-0006 §8',
          `стадия \`${this.address.stage}\`, ключ \`${key}\`: sha256 значения \`${actual}\` ` +
            `не равен записанному \`${entry.sha256}\`. Байты по адресу ключа изменились — ` +
            'попадание перестало быть равным промаху (**K3**)',
        );
      }
    }
    return bytes;
  }

  /**
   * Кладёт значение под ключ: сначала байты, потом запись манифеста.
   *
   * ПОРЯДОК ЗНАЧИМ. Обрыв между шагами оставляет байты без записи — это промах, то есть
   * пересчёт. Обратный порядок оставил бы запись без байтов, и `get` пришлось бы учить
   * отличать «ещё не дописано» от «стёрто»; сегодня оба случая — просто промах.
   *
   * ПОВТОРНЫЙ `put` ТЕМ ЖЕ КЛЮЧОМ С ДРУГИМИ БАЙТАМИ — ОШИБКА. Ключ есть функция входов: два
   * разных значения под одним ключом означают, что вход неполон (что-то влияет на результат и
   * не входит в ключ) — тот самый класс, ради которого написан ADR-0006. Молчаливая
   * перезапись сделала бы кэш зависящим от порядка сборки.
   */
  async put(key: string, bytes: Uint8Array, meta: CachePutMeta = {}): Promise<void> {
    assertKeyShape(key, this.address);
    const sha = String(sha256Of(bytes));
    const manifest = await readManifest(this.projectRoot, this.address);
    const existing = manifest.entries.find((entry) => entry.key === key);
    if (existing !== undefined && existing.sha256 !== sha) {
      throw new CacheError(
        'K3',
        `стадия \`${this.address.stage}\`, ключ \`${key}\`: под ним уже лежит значение с ` +
          `sha256 \`${existing.sha256}\`, а кладётся \`${sha}\`. Ключ — функция ВХОДОВ; два ` +
          'разных выхода при одном ключе означают, что вход неполон, то есть какая-то величина ' +
          'влияет на результат и не входит в `cacheKeyView`',
      );
    }

    await writeAtomic(cacheValuePath(this.projectRoot, this.address, key), bytes);

    const entry: CacheManifestEntry =
      meta.frameCount === undefined
        ? { key, sha256: sha, size: bytes.length }
        : { key, sha256: sha, size: bytes.length, frameCount: meta.frameCount };
    const entries = [...manifest.entries.filter((item) => item.key !== key), entry];
    await writeManifest(this.projectRoot, this.address, { stage: this.address.stage, entries });
  }
}
