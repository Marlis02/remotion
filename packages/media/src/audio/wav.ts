// WAV — КОНТЕЙНЕР НА ГРАНИЦАХ, а не формат тракта (`M-03`, roadmap §4).
//
// Внутри тракта живёт сырой PCM (`pcm.ts`); WAV появляется ровно в двух местах: отладочная
// запись на диск и чтение того, что записано. Заголовок пишется и читается СВОИМ кодом —
// 44 байта канонической формы PCM, — и это решение, а не отсутствие библиотеки: сторонний
// парсер втащил бы зависимость ради четырёх десятков байт и вместе с ней собственное
// представление о том, что делать с нестандартным входом (обычно — «догадаться»), тогда как
// тракту нужен ОТКАЗ с названным правилом.
//
// ЧТО ЧИТАТЕЛЬ ПРИНИМАЕТ. Ровно `WAVE_FORMAT_PCM`, 16 бит, один канал. Частота при этом
// принимается ЛЮБАЯ и не является поводом для отказа здесь: дорожка с чужой частотой
// законно существует (это вход ingest), она просто не попадает в микс — там её встречает
// `assertProjectRate` (ADR-0010 §9: ресемплинг ровно один, на ingest). Решение владельца по
// вопросу «чтение WAV с чужим sampleRate», сессия `M-03`.
//
// ЧЕГО ЧИТАТЕЛЬ НЕ ДЕЛАЕТ. Не угадывает. `WAVE_FORMAT_EXTENSIBLE` (0xFFFE) отвергается
// отдельным сообщением, хотя `SubFormat`-GUID внутри вполне может оказаться тем же PCM:
// «вероятно, PCM» — это не формат тракта (решение владельца B, сессия `M-03`). Формы MPEG
// (0x0055/0x0050) отвергаются по **V6** — с сообщением про правило, а не про формат: это
// настоящий mp3 внутри RIFF-обёртки, который проверка магических байт в начале файла не
// видит, потому что там честно написано `RIFF`.
//
// ПОЛЕ РАЗМЕРА RIFF НЕ ЯВЛЯЕТСЯ ИСТИНОЙ. Обход чанков идёт по ФАКТИЧЕСКОЙ длине байтов:
// писатели, пишущие в поток (в том числе `ffmpeg` в pipe), ставят туда заглушку, и файл при
// этом корректен. Свой писатель заполняет поле правильно, и round-trip проверяет байты
// целиком — то есть заглушку мы не пишем, а чужую переживаем.

import { readFile } from 'node:fs/promises';

import { mulExact } from '@vpe/core-model';

import { writeAtomic } from '../store/atomic.js';
import { AudioError } from './errors.js';
import {
  PCM_BITS_PER_SAMPLE,
  PCM_BYTES_PER_SAMPLE,
  PCM_CHANNELS,
  bytesFromPcm,
  pcmFromBytes,
  type PcmS16,
} from './pcm.js';
import { assertNotMp3, mp3WaveFormatName } from './v6.js';

const FORMAT = 'M-03 формат тракта (INFERENCE)';

/** Канонический заголовок PCM-WAV: `RIFF`/`WAVE`/`fmt `(16)/`data` — ровно 44 байта. */
export const WAV_HEADER_BYTES = 44;

/** Единственный принимаемый тег формата. */
export const WAVE_FORMAT_PCM = 0x0001;

/** Формат «через GUID». Отвергается: тракт не угадывает, что внутри (решение владельца B). */
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Размер тела чанка `fmt ` канонической формы PCM. */
const FMT_CHUNK_BYTES = 16;

/** Длина идентификатора чанка и поля размера — по четыре байта у каждого. */
const TAG_BYTES = 4;
const SIZE_BYTES = 4;

function tagAt(bytes: Uint8Array, offset: number): string {
  let out = '';
  for (let i = 0; i < TAG_BYTES; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < TAG_BYTES; i += 1) view.setUint8(offset + i, tag.charCodeAt(i));
}

/**
 * Дорожка → байты канонического WAV. Длина результата — `44 + 2·N` ровно: ни `LIST`, ни
 * `INFO`, ни выравнивающего байта (тело `data` всегда чётной длины при 16 битах).
 */
export function encodeWav(pcm: PcmS16): Uint8Array {
  const payload = bytesFromPcm(pcm);
  const blockAlign = mulExact(PCM_CHANNELS, PCM_BYTES_PER_SAMPLE, 'blockAlign');
  const byteRate = mulExact(pcm.sampleRate, blockAlign, 'byteRate');

  const bytes = new Uint8Array(WAV_HEADER_BYTES + payload.length);
  const view = new DataView(bytes.buffer);

  writeTag(view, 0, 'RIFF');
  // Размер RIFF считается от девятого байта: 4 (`WAVE`) + 8 + 16 (`fmt `) + 8 + тело.
  view.setUint32(4, WAV_HEADER_BYTES - 8 + payload.length, true);
  writeTag(view, 8, 'WAVE');

  writeTag(view, 12, 'fmt ');
  view.setUint32(16, FMT_CHUNK_BYTES, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, PCM_CHANNELS, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, PCM_BITS_PER_SAMPLE, true);

  writeTag(view, 36, 'data');
  view.setUint32(40, payload.length, true);
  bytes.set(payload, WAV_HEADER_BYTES);

  return bytes;
}

interface FoundChunk {
  readonly offset: number;
  readonly size: number;
}

/**
 * Обход списка чанков от двенадцатого байта. Неизвестные чанки ПРОПУСКАЮТСЯ (вход бывает не
 * от нас), тело каждого выровнено до чётной длины — правило RIFF, а не наше удобство.
 */
function findChunks(bytes: Uint8Array, where: string): Map<string, FoundChunk> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = new Map<string, FoundChunk>();
  let cursor = 12;
  while (cursor + TAG_BYTES + SIZE_BYTES <= bytes.length) {
    const tag = tagAt(bytes, cursor);
    const size = view.getUint32(cursor + TAG_BYTES, true);
    const body = cursor + TAG_BYTES + SIZE_BYTES;
    if (body + size > bytes.length) {
      throw new AudioError(
        FORMAT,
        `${where}: чанк \`${tag}\` объявил ${String(size)} Б, а до конца файла ` +
          `${String(bytes.length - body)} Б — файл обрезан.`,
      );
    }
    if (!found.has(tag)) found.set(tag, { offset: body, size });
    cursor = body + size + (size % 2);
  }
  return found;
}

/** Байты WAV → дорожка. `where` — адрес байтов для сообщений об отказе. */
export function decodeWav(bytes: Uint8Array, where: string): PcmS16 {
  assertNotMp3(bytes, where);

  if (bytes.length < WAV_HEADER_BYTES) {
    throw new AudioError(
      FORMAT,
      `${where}: ${String(bytes.length)} Б — короче канонического заголовка ` +
        `(${String(WAV_HEADER_BYTES)} Б).`,
    );
  }
  if (tagAt(bytes, 0) !== 'RIFF' || tagAt(bytes, 8) !== 'WAVE') {
    throw new AudioError(
      FORMAT,
      `${where}: не RIFF/WAVE (первые байты \`${tagAt(bytes, 0)}\`, тип \`${tagAt(bytes, 8)}\`).`,
    );
  }

  const chunks = findChunks(bytes, where);
  const fmt = chunks.get('fmt ');
  const data = chunks.get('data');
  if (fmt === undefined || data === undefined) {
    throw new AudioError(
      FORMAT,
      `${where}: в файле нет чанка \`${fmt === undefined ? 'fmt ' : 'data'}\`.`,
    );
  }
  if (fmt.size < FMT_CHUNK_BYTES) {
    throw new AudioError(
      FORMAT,
      `${where}: тело \`fmt \` — ${String(fmt.size)} Б, канонические ${String(FMT_CHUNK_BYTES)} Б не помещаются.`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const audioFormat = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const byteRate = view.getUint32(fmt.offset + 8, true);
  const blockAlign = view.getUint16(fmt.offset + 12, true);
  const bitsPerSample = view.getUint16(fmt.offset + 14, true);

  const mpeg = mp3WaveFormatName(audioFormat);
  if (mpeg !== null) {
    throw new AudioError(
      'ADR-0010 §9 (V6)',
      `${where}: \`audioFormat\` = 0x${audioFormat.toString(16).padStart(4, '0')} — ${mpeg}. ` +
        'Расширение файла и магические байты в этом случае говорят RIFF, а поток внутри — ' +
        'сжатый; внутри пайплайна такого нет ни на одном шаге. Приведите вход к PCM снаружи.',
    );
  }
  if (audioFormat === WAVE_FORMAT_EXTENSIBLE) {
    throw new AudioError(
      FORMAT,
      `${where}: \`WAVE_FORMAT_EXTENSIBLE\` (0xfffe) — формат объявлен GUID'ом в поле ` +
        '`SubFormat`. Тракт читает только `WAVE_FORMAT_PCM` (0x0001) и не угадывает, что ' +
        'внутри GUID, даже когда там тот же PCM: «вероятно, PCM» не является форматом ' +
        'тракта. Пересоберите вход в s16le моно.',
    );
  }
  if (audioFormat !== WAVE_FORMAT_PCM) {
    throw new AudioError(
      FORMAT,
      `${where}: \`audioFormat\` = 0x${audioFormat.toString(16).padStart(4, '0')}, ожидался ` +
        '`WAVE_FORMAT_PCM` (0x0001).',
    );
  }
  if (bitsPerSample !== PCM_BITS_PER_SAMPLE) {
    throw new AudioError(
      FORMAT,
      `${where}: ${String(bitsPerSample)} бит на сэмпл, формат тракта — ${String(PCM_BITS_PER_SAMPLE)}.`,
    );
  }
  if (channels !== PCM_CHANNELS) {
    throw new AudioError(
      FORMAT,
      `${where}: каналов ${String(channels)}, формат тракта — моно. Сведение каналов ` +
        'происходит на ingest вместе с ресемплингом (ADR-0010 §9), а не при чтении.',
    );
  }

  // Согласованность полей — не педантизм: расхождение означает либо порчу файла, либо
  // писателя, который считал сэмплы иначе, чем мы собираемся их читать.
  const expectedBlockAlign = mulExact(channels, PCM_BYTES_PER_SAMPLE, 'blockAlign');
  if (blockAlign !== expectedBlockAlign) {
    throw new AudioError(
      FORMAT,
      `${where}: \`blockAlign\` = ${String(blockAlign)}, ожидался ${String(expectedBlockAlign)}.`,
    );
  }
  const expectedByteRate = mulExact(sampleRate, blockAlign, 'byteRate');
  if (byteRate !== expectedByteRate) {
    throw new AudioError(
      FORMAT,
      `${where}: \`byteRate\` = ${String(byteRate)}, ожидался ${String(expectedByteRate)}.`,
    );
  }
  if (data.size % expectedBlockAlign !== 0) {
    throw new AudioError(
      FORMAT,
      `${where}: тело \`data\` — ${String(data.size)} Б, не кратно ${String(expectedBlockAlign)} Б.`,
    );
  }

  return pcmFromBytes(sampleRate, bytes.subarray(data.offset, data.offset + data.size));
}

/** Чтение WAV с диска. Проверка **V6** стоит на байтах файла, до разбора заголовка. */
export async function readWavFile(filePath: string): Promise<PcmS16> {
  const bytes = new Uint8Array(await readFile(filePath));
  return decodeWav(bytes, filePath);
}

/**
 * Запись WAV на диск — атомарная (`writeAtomic`, K7): половины файла по адресу не бывает.
 * Проверка **V6** стоит на байтах, которые уходят на диск: тракт применяет охранник и к
 * своим выходам, а не только к чужим входам.
 */
export async function writeWavFile(filePath: string, pcm: PcmS16): Promise<void> {
  const bytes = encodeWav(pcm);
  assertNotMp3(bytes, filePath);
  await writeAtomic(filePath, bytes);
}
