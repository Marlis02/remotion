import data from '../../data.json';

/**
 * Геометрия, общая для обоих рендереров: и Remotion, и HTML считают её
 * по одним и тем же формулам от одних и тех же констант data.json.
 * Здесь только чистая арифметика — никаких кривых движения:
 * кривые у каждого рендерера свои, идиоматичные (см. decisions.md).
 */
export const D = data;

/** Точки линейного графика в координатах экрана. */
export const linePoints = (): {x: number; y: number}[] => {
  const {x, y, width, height, points} = D.line;
  const n = points.length;
  return points.map((v, i) => ({
    x: x + (width * i) / (n - 1),
    y: y + height - height * v,
  }));
};

export const linePathD = (): string =>
  linePoints()
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
    .join(' ');

export const lineAreaD = (): string => {
  const pts = linePoints();
  const base = D.line.y + D.line.height;
  return `${linePathD()} L${pts[pts.length - 1].x.toFixed(3)} ${base} L${pts[0].x.toFixed(3)} ${base} Z`;
};

/**
 * Путь морфинга: ОДИН путь, 10 узлов, равное число узлов в обоих состояниях.
 * p=0 — правильный десятиугольник (все радиусы внешние), p=1 — пятиконечная звезда
 * (нечётные узлы уходят на внутренний радиус). Промежуточные p — линейная
 * интерполяция радиуса, то есть узлы не появляются и не исчезают.
 */
export const morphPathD = (p: number): string => {
  const {cx, cy, outerR, innerR, nodes} = D.morph;
  const parts: string[] = [];
  for (let i = 0; i < nodes; i++) {
    const a = (-90 + (i * 360) / nodes) * (Math.PI / 180);
    const r = i % 2 === 0 ? outerR : outerR + (innerR - outerR) * p;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  return `${parts.join(' ')} Z`;
};

/** Геометрия одного столбца диаграммы. */
export const barBox = (i: number) => {
  const b = D.bars;
  const w = (b.width - b.gap * (b.values.length - 1)) / b.values.length;
  return {
    x: b.x + i * (w + b.gap),
    w,
    fullH: b.maxHeight * b.values[i],
    baselineY: b.baselineY,
  };
};

/** Геометрия одного кружка stagger-сетки; delayFrames — волна по диагонали. */
export const dotBox = (i: number) => {
  const g = D.grid;
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return {
    col,
    row,
    cx: g.x + col * g.cellW + g.cellW / 2,
    cy: g.y + row * g.cellH + g.cellH / 2,
    delayFrames: (col + row) * g.waveDelayFrames,
  };
};
