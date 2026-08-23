// `M-02` — каталог ассетов: алиасы, записи provenance, лицензия по ссылке.

export {
  AssetCatalogError,
  buildAssetCatalog,
  resolveAlias,
  resolveEffectiveLicense,
  type AssetCatalog,
  type AssetCatalogInput,
  type AssetCatalogProblem,
  type AssetCatalogProblemKind,
  type AssetRecordFile,
  type EffectiveLicense,
} from './catalog.js';
export { AssetPathError, readAssetCatalog, type AssetCatalogPaths } from './load.js';
