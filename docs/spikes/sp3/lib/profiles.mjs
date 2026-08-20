/**
 * SP-3: два профиля пикселей. Числа согласованы с
 * fixtures/minimal/profiles/render.final.yaml; draft — то, что предполагается
 * ADR-0008 (отложен «до SP-3»): crf 28, scale 0.5.
 * Различие между профилями — только crf и scale, всё остальное общее,
 * иначе разница во времени не приписывается ни одному фактору.
 */
export const PROFILES = {
  final: {
    profileId: 'final',
    crf: 18,
    scale: 1,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    x264Preset: 'medium',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    encoderThreads: 4,
    gopSize: 30,
    disallowParallelEncoding: false,
    offthreadVideoCacheSizeInBytes: 536870912,
  },
  draft: {
    profileId: 'draft',
    crf: 28,
    scale: 0.5,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    x264Preset: 'medium',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    encoderThreads: 4,
    gopSize: 30,
    disallowParallelEncoding: false,
    offthreadVideoCacheSizeInBytes: 536870912,
  },
  /** Профиль детерминизма (render.ac4.yaml): однопоточный энкод, PNG, без параллельного энкодинга. */
  ac4: {
    profileId: 'ac4',
    crf: 18,
    scale: 0.25, // 270x480 — ровно как в fixtures/minimal/profiles/render.ac4.yaml
    imageFormat: 'png',
    x264Preset: 'medium',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    encoderThreads: 1,
    gopSize: 30,
    disallowParallelEncoding: true,
    offthreadVideoCacheSizeInBytes: 134217728,
  },
};

/**
 * Флаги энкодера, которых нет в Node-API Remotion (gopSize, threads, bitexact):
 * добавляются через ffmpegOverride как output-опции, перед именем выходного файла.
 */
export const encoderExtraArgs = (profile) => [
  '-g',
  String(profile.gopSize),
  '-threads',
  String(profile.encoderThreads),
  '-fflags',
  '+bitexact',
  '-flags:v',
  '+bitexact',
];
