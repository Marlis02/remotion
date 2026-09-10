# SP-VID — общие константы приборов. Источается всеми `a*.sh`.
#
# ЭНКОДЕР — ДОСЛОВНО КАНАЛЬНЫЙ. Строка собрана из ДВУХ мест движка, а не из одного:
#   видео — `packages/media/src/assemble/encode.ts` (`segmentEncodeArgs`, профиль `final`:
#           crf 18, preset medium, threads 4, rc-lookahead 40, aq-mode 1, psy 1, g/keyint 30,
#           sc_threshold 0, x264-params open-gop=0, fps_mode cfr, pix_fmt yuv420p,
#           colorspace/primaries/trc bt709, `-fflags +bitexact -flags:v +bitexact`);
#   аудио — `packages/media/src/assemble/concat.ts` (`concatMuxArgs`: aresample soxr
#           precision 28 → 48000, `-c:a aac -b:a 192k`, `-fflags +bitexact`, `-f mp4`).
# Задание называло `concat.ts:55–80` — там лежит СПИСОК ЗАПРЕЩЁННЫХ флагов конката
# (`FORBIDDEN_CONCAT_ARGS`), а не строка энкодера: в канале конкат идёт `-c:v copy`, и
# кодирует кадры `encode.ts`. Решение сессии, пересмотреть утром.

set -euo pipefail

FF=/usr/local/bin/ffmpeg
FP=/usr/local/bin/ffprobe

W=1080
H=1920
FPS=30

# Видео-энкодер канала (профиль `final`).
VENC=(-c:v libx264 -crf 18 -preset medium -threads 4 -rc-lookahead 40 -aq-mode 1 -psy 1
      -g 30 -keyint_min 30 -sc_threshold 0 -x264-params open-gop=0 -fps_mode cfr
      -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709
      -flags:v +bitexact)

# Аудио-энкодер канала (мукс финала).
AENC=(-c:a aac -b:a 192k)
ARESAMPLE="aresample=resampler=soxr:precision=28:out_sample_rate=48000"

# Общее для всех прогонов: тишина в логе, без stdin, без строки сборки в контейнере.
COMMON=(-hide_banner -nostdin -loglevel error -y)
BITEXACT=(-fflags +bitexact)

sha() { sha256sum "$1" | cut -d' ' -f1; }
