import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {D, barBox, dotBox, lineAreaD, linePathD, morphPathD} from './shared';

const FONT_FAMILY = 'SP3Sans';

/** Шрифт — локальный ассет (V10, V9: сети в рендере нет). Кадр держится, пока он не готов. */
const useLocalFont = () => {
  const [handle] = useState(() => delayRender('font'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const face = new FontFace(FONT_FAMILY, `url(${staticFile('DejaVuSans-Bold.ttf')})`, {weight: '700'});
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        return document.fonts.ready;
      })
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        throw err;
      });
  }, [handle]);
  return ready;
};

const visible = (frame: number, w: {from: number; to: number}) => frame >= w.from && frame < w.to;

/** 1. Столбчатая диаграмма: 6 столбцов, spring с отскоком, сдвиг старта 4 кадра. */
const Bars: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!visible(frame, D.windows.bars)) return null;
  return (
    <>
      {D.bars.values.map((_, i) => {
        const box = barBox(i);
        const local = frame - D.windows.bars.from - i * D.bars.staggerFrames;
        const p = spring({frame: local, fps, config: {damping: 11, stiffness: 200, mass: 1}});
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: 'absolute',
                left: box.x,
                top: box.baselineY - box.fullH,
                width: box.w,
                height: box.fullH,
                backgroundColor: D.palette.bar,
                borderRadius: 10,
                transform: `scaleY(${p})`,
                transformOrigin: '50% 100%',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: box.x,
                top: box.baselineY + 18,
                width: box.w,
                textAlign: 'center',
                fontFamily: `${FONT_FAMILY}, sans-serif`,
                fontWeight: 700,
                fontSize: 34,
                color: D.palette.barLabel,
              }}
            >
              {D.bars.labels[i]}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

/** 2. Счётчик: 0 → 1793 за 2 с; каждая цифра в боксе фиксированной ширины (моноширинная раскладка). */
const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  if (!visible(frame, D.windows.counter)) return null;
  const p = interpolate(frame, [D.counter.startFrame, D.counter.startFrame + D.counter.frames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const value = Math.round(D.counter.target * p);
  const digits = String(value).split('');
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: D.counter.y,
        width: D.width,
        display: 'flex',
        justifyContent: 'center',
        fontFamily: `${FONT_FAMILY}, sans-serif`,
        fontWeight: 700,
        fontSize: D.counter.fontPx,
        color: D.palette.counter,
      }}
    >
      {digits.map((d, i) => (
        <span key={i} style={{display: 'inline-block', width: D.counter.digitWidthPx, textAlign: 'center'}}>
          {d}
        </span>
      ))}
    </div>
  );
};

/** 3. Линейный график: путь из 40 точек прорисовывается слева направо, под ним градиентная заливка. */
const LineChart: React.FC = () => {
  const frame = useCurrentFrame();
  if (!visible(frame, D.windows.line)) return null;
  const p = interpolate(frame, [D.windows.line.from, D.windows.line.from + D.line.drawFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <svg style={{position: 'absolute', left: 0, top: 0}} width={D.width} height={D.height}>
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={D.palette.lineFillTop} />
          <stop offset="100%" stopColor={D.palette.lineFillBottom} />
        </linearGradient>
        <clipPath id="lineClip">
          <rect x={D.line.x} y={D.line.y} width={D.line.width * p} height={D.line.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#lineClip)">
        <path d={lineAreaD()} fill="url(#lineFill)" />
      </g>
      <path
        d={linePathD()}
        fill="none"
        stroke={D.palette.line}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - p}
      />
    </svg>
  );
};

/** 4. Stagger-сетка: 200 кружков, волна по диагонали, затем одновременная смена цвета. */
const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!visible(frame, D.windows.grid)) return null;
  const recolored = frame >= D.grid.recolorFrame;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0}} width={D.width} height={D.height}>
      {Array.from({length: D.grid.count}, (_, i) => {
        const b = dotBox(i);
        const local = frame - D.windows.grid.from - b.delayFrames;
        const s = spring({frame: local, fps, config: {damping: 13, stiffness: 220, mass: 1}});
        return (
          <circle
            key={i}
            cx={b.cx}
            cy={b.cy}
            r={D.grid.radius}
            fill={recolored ? D.palette.dotB : D.palette.dotA}
            transform={`translate(${b.cx} ${b.cy}) scale(${s}) translate(${-b.cx} ${-b.cy})`}
          />
        );
      })}
    </svg>
  );
};

/** 5. SVG-морфинг: один путь, 10 узлов, круг(десятиугольник) → звезда → обратно. */
const Morph: React.FC = () => {
  const frame = useCurrentFrame();
  if (!visible(frame, D.windows.morph)) return null;
  const a = D.windows.morph.from;
  const b = a + D.morph.toStarFrames;
  const c = b + D.morph.backFrames;
  const p =
    frame < b
      ? interpolate(frame, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.ease)})
      : interpolate(frame, [b, c], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.ease)});
  return (
    <svg style={{position: 'absolute', left: 0, top: 0}} width={D.width} height={D.height}>
      <path d={morphPathD(p)} fill={D.palette.morph} />
    </svg>
  );
};

export const Motion: React.FC = () => {
  const fontReady = useLocalFont();
  return (
    <AbsoluteFill style={{backgroundColor: D.background}}>
      {fontReady ? (
        <>
          <Bars />
          <Counter />
          <LineChart />
          <Grid />
          <Morph />
        </>
      ) : null}
    </AbsoluteFill>
  );
};
