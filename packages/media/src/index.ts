// Публичная поверхность `@vpe/media` (карта ADR-0009: CAS-store, ассеты, кэш, PCM, ffmpeg).

// `M-01` — CAS `.store` и `store.lock`.
export * from './store/index.js';

// `M-02` — каталог ассетов, алиасы, provenance, лицензия по ссылке.
export * from './assets/index.js';
