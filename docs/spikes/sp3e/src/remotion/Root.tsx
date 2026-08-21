import React from 'react';
import {Composition} from 'remotion';
import {Motion} from './Motion';
import data from '../../data.json';

/** Одна композиция: 1080x1920, 30 fps, 300 кадров. Числа — из общего data.json. */
export const MotionRoot: React.FC = () => (
  <Composition
    id="motion"
    component={Motion}
    durationInFrames={data.durationInFrames}
    fps={data.fps}
    width={data.width}
    height={data.height}
  />
);
