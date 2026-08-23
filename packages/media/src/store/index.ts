// CAS `.store` и `store.lock` (`M-01`). Публичная поверхность модуля.

export { writeAtomic } from './atomic.js';
export { StorePathError, blobPath, resolveStorePath, shardDir, type StorePathContext } from './layout.js';
export { LocalStore } from './local.js';
export {
  readStoreLock,
  renderStoreLock,
  upsertEntry,
  withLastVerifiedAt,
  writeStoreLock,
  type StoreLockEntry,
} from './lock.js';
export { MissingBlobsError, assertBlobKind, type Store } from './types.js';
