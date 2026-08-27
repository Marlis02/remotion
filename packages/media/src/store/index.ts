// CAS `.store` и `store.lock` (`M-01`). Публичная поверхность модуля.

export { writeAtomic } from './atomic.js';
export { StorePathError, blobPath, resolveStorePath, shardDir, type StorePathContext } from './layout.js';
// `sha256Of` реэкспортирован `CP-05` (2026-08-27, решение владельца, вариант «а»): адрес блоба
// в CAS — `sha256` по байтам, и `AudioTrackRef.sha256` обязан считаться ТОЙ ЖЕ функцией, иначе
// поле манифеста и адрес в сторе разойдутся. Второй реализации sha256 в репозитории быть не
// должно по той же причине, по которой её нет у `msToSamples` (ADR-0003 T1).
export { LocalStore, sha256Of } from './local.js';
export {
  readStoreLock,
  renderStoreLock,
  upsertEntry,
  withLastVerifiedAt,
  writeStoreLock,
  type StoreLockEntry,
} from './lock.js';
export { MissingBlobsError, asBlobSha, assertBlobKind, type Store } from './types.js';
