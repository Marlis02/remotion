/** SP-3f: окружение спайка. CLI HyperFrames, статические ffmpeg/ffprobe и приборы — из SP-3/SP-3c/SP-3e. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SP3 = path.resolve(ROOT, '../sp3');
export const SP3C = path.resolve(ROOT, '../sp3c');
export const SP3E = path.resolve(ROOT, '../sp3e');
export const BIN = path.join(SP3C, 'bin');
export const HF_CLI = path.join(SP3C, 'node_modules/.bin/hyperframes');

export const childEnv = (extra = {}) => ({
  ...process.env,
  PATH: `${BIN}:${process.env.PATH}`,
  TZ: 'UTC',
  LC_ALL: 'C',
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
  HYPERFRAMES_NO_FEEDBACK: '1',
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_FFMPEG_PATH: path.join(BIN, 'ffmpeg'),
  HYPERFRAMES_FFPROBE_PATH: path.join(BIN, 'ffprobe'),
  ...extra,
});
