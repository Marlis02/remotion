// **V6** — «внутри пайплайна нет mp3 ни на одном шаге» (ADR-0010 §9, реестр инвариантов).
//
// ЭТО ЕДИНСТВЕННЫЙ ФАЙЛ ПАКЕТА, КОТОРОМУ РАЗРЕШЕНО ЗНАТЬ ПРО mp3. Ровно то же решение, по
// которому уборка tmp живёт только в `store/atomic.ts` (K10) и `JSON.stringify` — только в
// `canonical/json.ts` (`S-01`): у правила обязано быть одно названное место-исключение,
// иначе оно декларативно. Репозиторный охранник — `tests/lints/v6-no-mp3-in-media.test.ts`:
// в `packages/media/src/**` нет ни одного упоминания mp3-энкодеров/декодеров и расширения
// файла, кроме этого файла, и исключение проверяется на «не мёртвое» и «узкое».
//
// ЧТО ЭТОТ ДЕТЕКТОР МОЖЕТ. Сказать про **байты файла**: это mp3. Две формы, которыми
// начинается практически всякий mp3 в природе, — тег `ID3v2` и заголовок кадра MPEG Audio.
//
// ЧЕГО ОН НЕ МОЖЕТ, И ЭТО ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО. Его НЕЛЬЗЯ применять к сырому потоку
// PCM. Синхрослово кадра — одиннадцать единиц подряд (`0xFF 0xE?`), а два соседних сэмпла
// громкой речи дают ровно такие байты: сэмпл −1281 в s16le — это `FF FA`, то есть «MPEG-1
// Layer III» по всем полям заголовка. Поэтому `assertNotMp3` вызывается на ГРАНИЦАХ, где
// байты являются файлом (вход ingest, записываемый WAV), и не вызывается на полезной
// нагрузке. Тест, фиксирующий этот предел, лежит рядом с остальными и назван вслух.
//
// ВТОРАЯ ПОЛОВИНА ПРАВИЛА — mp3 ВНУТРИ RIFF. Файл с расширением `.wav` и полем `audioFormat`
// = 0x0055 содержит mp3-поток в WAV-обёртке; магические байты в начале файла при этом
// говорят `RIFF`, и проверка выше его не увидит. Поэтому теги формата живут здесь же, а
// `wav.ts` спрашивает у этого файла имя формата, а не сравнивает числа сам.

import { AudioError } from './errors.js';

/** Длина заголовка кадра MPEG Audio, байт. Читаются первые три. */
const FRAME_HEADER_BYTES = 4;

/** `WAVE_FORMAT_MPEGLAYER3` — mp3-поток в RIFF-обёртке (RFC 3003, `audio/mpeg`). */
export const WAVE_FORMAT_MPEGLAYER3 = 0x0055;

/** `WAVE_FORMAT_MPEG` — MPEG-1 Layer I/II в той же обёртке. Отвергается тем же правилом. */
export const WAVE_FORMAT_MPEG = 0x0050;

/**
 * Имя MPEG-формата RIFF по числу тега, либо `null`, если тег не MPEG-аудио.
 *
 * Вызывающий (`wav.ts`) не сравнивает числа сам — иначе знание про mp3 расползлось бы по
 * второму файлу, и охранник V6 пришлось бы ослаблять исключением на каждый такой файл.
 */
export function mp3WaveFormatName(audioFormat: number): string | null {
  if (audioFormat === WAVE_FORMAT_MPEGLAYER3) return 'WAVE_FORMAT_MPEGLAYER3 (mp3 в RIFF-обёртке)';
  if (audioFormat === WAVE_FORMAT_MPEG) return 'WAVE_FORMAT_MPEG (MPEG-1 Layer I/II в RIFF-обёртке)';
  return null;
}

/** Тег `ID3v2` в начале файла: три буквы плюс байт версии, который не бывает 0xFF. */
function hasId3v2(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes[3] !== 0xff;
}

/**
 * Заголовок кадра MPEG Audio в начале файла.
 *
 * Проверяются не только одиннадцать бит синхрослова, но и поля, у которых есть запрещённые
 * значения, — иначе детектор путал бы mp3 с ADTS-AAC (`0xFF 0xF1`), а AAC в пайплайне
 * законен: именно им кодируется финал при муксе (`audioProfile.codec: aac`, ADR-0008).
 * У ADTS поле «слой» равно `0b00` — зарезервированному значению MPEG Audio, и именно это
 * отличает один поток от другого.
 */
function hasFrameSync(bytes: Uint8Array): boolean {
  if (bytes.length < FRAME_HEADER_BYTES) return false;
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  if (b0 !== 0xff) return false;
  if ((b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0b11;
  const layer = (b1 >> 1) & 0b11;
  if (version === 0b01 || layer === 0b00) return false;
  const bitrateIndex = (b2 >> 4) & 0b1111;
  const sampleRateIndex = (b2 >> 2) & 0b11;
  return bitrateIndex !== 0b1111 && sampleRateIndex !== 0b11;
}

/**
 * Являются ли байты **файла** mp3. Смотрит ровно на начало файла и никуда не сканирует:
 * задача — узнать контейнер, а не найти кадр в потоке.
 */
export function isMp3Bytes(bytes: Uint8Array): boolean {
  return hasId3v2(bytes) || hasFrameSync(bytes);
}

/**
 * Охранник V6 на границе тракта. `where` — человеческий адрес байтов (путь файла либо имя
 * шага), он попадает в сообщение: «отказ» без адреса не лечится.
 */
export function assertNotMp3(bytes: Uint8Array, where: string): void {
  if (!isMp3Bytes(bytes)) return;
  const form = hasId3v2(bytes) ? 'тег ID3v2 в начале файла' : 'заголовок кадра MPEG Audio';
  throw new AudioError(
    'ADR-0010 §9 (V6)',
    `${where}: ${form} — байты являются mp3 (audio/mpeg, обычно расширение .mp3). ` +
      'Внутри пайплайна mp3 нет ни на одном шаге: речь запрашивается в pcm_*, ' +
      'музыка приводится к projectSampleRate один раз на ingest, финал кодируется один ' +
      'раз при муксе. Приведите вход к PCM снаружи пайплайна.',
  );
}
