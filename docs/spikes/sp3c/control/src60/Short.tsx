import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import captions from './captions.json';

/** Безопасные зоны YouTube Shorts — из fixtures/minimal/profiles/compile.yaml. */
const SAFE_BOTTOM = 320;
const SAFE_SIDE = 60;

const FONT_FAMILY = 'SP3Sans';

/**
 * Шрифт — ассет (V10). Грузится с диска через publicDir, сети нет.
 * delayRender держит кадр, пока шрифт не готов: иначе первые кадры
 * отрисовались бы фолбэком и дали ложное расхождение framemd5.
 */
const useLocalFont = () => {
  const [handle] = useState(() => delayRender('font'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const face = new FontFace(FONT_FAMILY, `url(${staticFile('DejaVuSans-Bold.ttf')})`, {
      weight: '700',
    });
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
        // Падаем громко: молчаливый фолбэк на другой шрифт — это тихо неверный кадр.
        throw err;
      });
  }, [handle]);
  return ready;
};

/** Ken Burns: наезд 1.0 → 1.15 плюс небольшой снос кадра. */
const KenBurnsBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const last = durationInFrames - 1;

  const scale = interpolate(frame, [0, last], [1.0, 1.15], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateX = interpolate(frame, [0, last], [0, -36], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, last], [0, 28], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#000'}}>
      <Img
        src={staticFile('backdrop.jpg')}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          transformOrigin: '52% 46%',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Затемнение: (1) скрим снизу под субтитры, (2) виньетка,
 * (3) появление из чёрного и уход в чёрное на краях ролика.
 */
const Darkening: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const fade = interpolate(
    frame,
    [0, 15, durationInFrames - 16, durationInFrames - 1],
    [1, 0, 0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 26%, rgba(0,0,0,0.12) 52%, rgba(0,0,0,0.28) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      <AbsoluteFill style={{backgroundColor: '#000', opacity: fade}} />
    </>
  );
};

/** Субтитры по словам: страница 2–4 токена, активный токен подсвечен. */
const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const page = captions.pages.find((p) => frame >= p.startFrame && frame < p.endFrame);
  if (!page) return null;

  // Появление страницы: 4 кадра. Значения чистые функции кадра (V8).
  const appear = interpolate(frame, [page.startFrame, page.startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: SAFE_BOTTOM,
        paddingLeft: SAFE_SIDE,
        paddingRight: SAFE_SIDE,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 22px',
          opacity: appear,
          transform: `translateY(${(1 - appear) * 26}px)`,
          fontFamily: `${FONT_FAMILY}, sans-serif`,
          fontWeight: 700,
          fontSize: 82,
          lineHeight: 1.18,
          textAlign: 'center',
        }}
      >
        {page.tokens.map((token) => {
          const active = frame >= token.startFrame && frame < token.endFrame;
          return (
            <span
              key={token.index}
              style={{
                color: active ? '#ffd166' : 'rgba(255,255,255,0.86)',
                transform: `scale(${active ? 1.07 : 1})`,
                display: 'inline-block',
                textShadow: active
                  ? '0 6px 26px rgba(0,0,0,0.85), 0 0 14px rgba(255,209,102,0.45)'
                  : '0 6px 22px rgba(0,0,0,0.85)',
                WebkitTextStroke: active ? '2px rgba(0,0,0,0.35)' : '0px transparent',
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Short: React.FC = () => {
  const fontReady = useLocalFont();
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <KenBurnsBackdrop />
      <Darkening />
      {fontReady ? <Captions /> : null}
    </AbsoluteFill>
  );
};
