import React from 'react';
import {Composition} from 'remotion';
import {Short} from './Short';
import captions from './captions.json';

/**
 * Одна композиция 1080x1920, 10 секунд, 30 fps.
 * Числа взяты из fixtures/minimal/profiles/compile.yaml (fps 30, 1080x1920).
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="short"
      component={Short}
      durationInFrames={captions.durationInFrames}
      fps={captions.fps}
      width={1080}
      height={1920}
    />
  );
};
