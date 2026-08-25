// Раскладка кэша стадий на диске (`M-05`; ADR-0005 §1, ADR-0006 §8, §13).
//
// ADR-0005 §1 дословно: «`.cache/<stage>/`  ign.  CAS по ключам + manifest.json».
// ADR-0006 §13 дословно: «Профили (`draft`/`final`/`ac4`) живут в РАЗНЫХ ПРОСТРАНСТВАХ ИМЁН
// по `profileId` и не вытесняют друг друга».
//
// У `voice` И `compose` `profileId` НЕ ПРИМЕНИМ — ОДНО ПРОСТРАНСТВО (решение владельца
// 2026-08-25, дополнение к шагу 1). Следующий читатель не должен гадать, почему у `voice` нет
// `draft`/`final`, поэтому причина записана здесь, а не подразумевается:
//
//   * `voiceKey` (ADR-0006 §2) не содержит ни одного поля профиля рендера — он собран из
//     текста, провайдера, модели, голоса, seed'а, `providerOpts`, `roleDigest` и версии
//     тракта. Черновой рендер и финальный слушают ОДИН И ТОТ ЖЕ оплаченный дубль; завести им
//     разные пространства значило бы заплатить за второй экземпляр того же звука;
//   * `composeKey` собран из хэшей исходников, строк lockfile и версии компилятора — профиля
//     в нём тоже нет ни одним полем;
//   * `segmentKey` содержит `pixelProfile` целиком, и вот ЕМУ пространство имён нужно: `draft`
//     и `final` дают разные пиксели при одном содержимом, и вытеснять друг друга они не имеют
//     права (ADR-0006 §13, и там же — «прогрев финального кэша черновыми прогонами невозможен
//     by design»).
//
// Форма адреса это ИСПОЛНЯЕТ, а не описывает: `CacheAddress` — размеченное объединение, и
// `{ stage: 'voice', profileId: 'final' }` не типизируется вовсе.
//
// GC ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ УПУЩЕНИЕ (владелец, `M-05` вопрос 5). ADR-0006 §13:
// «Сама реализация GC/сжатия `.cache` отложена… пустой каталог удаляется руками». Пометка
// **K10** из `M-01` («`media/src/cache/**` под правило „нет удаления“ не подпадает, кэш
// инвалидируется по определению») адресата в этой задаче НЕ ПОЛУЧИЛА: удаления здесь нет ни
// одного, кроме уборки tmp внутри `writeAtomic`.

import path from 'node:path';

import { SHARD_LENGTH } from '../store/layout.js';

import { CacheError } from './errors.js';

/** Корень кэша внутри дерева проекта. `.cache` игнорируется git (ADR-0005 §1). */
export const CACHE_DIR = '.cache';

/** Имя манифеста стадии — ADR-0005 §1 называет его дословно. */
export const MANIFEST_NAME = 'manifest.json';

/**
 * Адрес пространства имён кэша.
 *
 * Размеченное объединение, а не «стадия плюс необязательный профиль»: у `voice` и `compose`
 * профиля нет по построению (см. шапку), и выразить его нельзя.
 */
export type CacheAddress =
  | { readonly stage: 'voice' }
  | { readonly stage: 'compose' }
  | { readonly stage: 'segment'; readonly profileId: string };

/** Стадии, у которых пространство имён одно. Список исчерпывающий для компилятора. */
export function isProfileScoped(address: CacheAddress): address is { stage: 'segment'; profileId: string } {
  return address.stage === 'segment';
}

/**
 * Каталог пространства имён: `.cache/voice`, `.cache/compose`, `.cache/segment/<profileId>`.
 *
 * `projectRoot` приходит ПАРАМЕТРОМ — тем же приёмом, что в `store/layout.ts`: ни один тест
 * не может случайно записать в настоящий `.cache` проекта, он физически не знает, где тот.
 */
export function cacheNamespaceDir(projectRoot: string, address: CacheAddress): string {
  const base = path.join(projectRoot, CACHE_DIR, address.stage);
  if (!isProfileScoped(address)) return base;
  if (address.profileId === '' || address.profileId.includes(path.sep) || address.profileId.includes('..')) {
    throw new CacheError(
      'ADR-0006 §13',
      `profileId \`${address.profileId}\` не является именем пространства имён кэша: оно ` +
        'становится ИМЕНЕМ КАТАЛОГА, и пустое значение либо разделитель пути вывели бы запись ' +
        'за пределы своего пространства — то есть `draft` вытеснил бы `final`',
    );
  }
  return path.join(base, address.profileId);
}

/** Манифест пространства имён. */
export function cacheManifestPath(projectRoot: string, address: CacheAddress): string {
  return path.join(cacheNamespaceDir(projectRoot, address), MANIFEST_NAME);
}

/** Ключ как имя файла: та же двухуровневая раскладка, что у CAS (`SHARD_LENGTH`, ADR-0005 §1). */
export function cacheValuePath(projectRoot: string, address: CacheAddress, key: string): string {
  assertKeyShape(key, address);
  return path.join(
    cacheNamespaceDir(projectRoot, address),
    key.slice(0, SHARD_LENGTH),
    key.slice(SHARD_LENGTH, SHARD_LENGTH * 2),
    key,
  );
}

/**
 * Ключ обязан быть именем файла и ничем больше.
 *
 * Все три ключа — `blake3` в hex (ADR-0006 §2), то есть 64 строчных hex-символа. Проверка
 * стоит здесь, а не в вызывающем: ключ приходит ЗНАЧЕНИЕМ (у `voiceKey` — из другого пакета),
 * и путь, собранный из непроверенной строки, — это запись мимо своего пространства имён.
 */
export function assertKeyShape(key: string, address: CacheAddress): void {
  if (!/^[0-9a-f]{64}$/u.test(key)) {
    throw new CacheError(
      'ADR-0006 §2',
      `ключ стадии \`${address.stage}\` = \`${key}\` — не blake3 в hex (64 строчных hex). ` +
        'Ключ становится именем файла в пространстве имён кэша; произвольная строка адресует ' +
        'запись мимо него',
    );
  }
}
