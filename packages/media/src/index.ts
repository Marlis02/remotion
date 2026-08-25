// Публичная поверхность `@vpe/media` (карта ADR-0009: CAS-store, ассеты, кэш, PCM, ffmpeg).

// `M-01` — CAS `.store` и `store.lock`.
export * from './store/index.js';

// `M-02` — каталог ассетов, алиасы, provenance, лицензия по ссылке.
export * from './assets/index.js';

// `M-03` — PCM-тракт: формат s16le моно, WAV I/O, микс, микрофейд, ресемплинг, V6.
export * from './audio/index.js';

// `M-04` — сборка: сегменты h264/MPEG-TS без аудио, конкат `-c copy`, единственный энкод
// аудио при муксе, измеренный `StreamFingerprint`, `framemd5` под флагом.
export * from './assemble/index.js';

// `M-05` — кэш трёх стадий, ключи `composeKey`/`segmentKey`, `cacheKeyView` данными,
// инъективная каноническая форма входа ключей (её потребляет и `voiceKey` из `@vpe/voice`).
export * from './cache/index.js';
