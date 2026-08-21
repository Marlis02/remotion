/**
 * SP-3c: профили пикселей для HyperFrames, приведённые к профилям SP-3.
 *
 * `final` совпадает с SP-3 final по энкодеру дословно: ENCODER_PRESETS.standard
 * у HyperFrames — это libx264 preset medium, crf 18 (chunkEncoder.js:19).
 * `draft` у SP-3 — crf 28 при preset medium и scale 0.5. У HyperFrames quality=draft
 * это preset **ultrafast**, а не medium, поэтому вместо него берётся
 * quality=standard + --crf 28: так меняется ровно одна величина, как в SP-3.
 * Масштаб 0.5 через CLI не выражается (deviceScaleFactor < 1 нет), поэтому
 * `draft` идёт в полном разрешении, а половинный вариант вынесен в отдельный
 * профиль `draftHalf` на отдельной композиции (см. decisions).
 */
export const HF_PROFILES = {
  final: {
    profileId: 'final',
    project: 'src',
    format: 'mp4',
    quality: 'standard',
    crf: null, // из quality: 18
    expect: {width: 1080, height: 1920, crf: 18, preset: 'medium'},
  },
  draft: {
    profileId: 'draft',
    project: 'src',
    format: 'mp4',
    quality: 'standard',
    crf: 28,
    expect: {width: 1080, height: 1920, crf: 28, preset: 'medium'},
  },
  draftHalf: {
    profileId: 'draftHalf',
    project: 'src-draft',
    format: 'mp4',
    quality: 'standard',
    crf: 28,
    expect: {width: 540, height: 960, crf: 28, preset: 'medium'},
  },
  pngseq: {
    profileId: 'pngseq',
    project: 'src',
    format: 'png-sequence',
    quality: 'standard',
    crf: null,
    expect: {width: 1080, height: 1920},
  },
};

/** Аргументы CLI для профиля + режима GPU. */
export const hfArgs = ({profile, workers, gpu, outputPath, project}) => {
  const p = HF_PROFILES[profile];
  const args = [
    'render',
    project ?? p.project,
    '-o',
    outputPath,
    '--workers',
    String(workers),
    '--quality',
    p.quality,
    '--format',
    p.format,
    '--fps',
    '30',
  ];
  if (p.crf !== null) args.push('--crf', String(p.crf));
  // gpu: 'gpu' — путь по умолчанию (auto → аппаратный, аналог remotion gl=angle);
  //      'sw'  — SwiftShader (аналог remotion gl=swangle).
  if (gpu === 'sw') args.push('--no-browser-gpu');
  else if (gpu === 'gpu') args.push('--browser-gpu');
  args.push('--quiet');
  return args;
};
