// Акустическая обрезка T7 (`V-04`): детектор границ речи и признак смены поведения провайдера.
// Публичная поверхность модуля.

export {
  LEAD_IN_RANGE_MS,
  assessEdgeDrift,
  type EdgeDrift,
  type EdgeDriftEntry,
} from './drift.js';

export {
  speechEdges,
  type SpeechEdgeMeasurement,
  type SpeechEdges,
  type SpeechEdgesParams,
} from './speech-edges.js';
