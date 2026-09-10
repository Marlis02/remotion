#!/usr/bin/env bash
# SP-VID A0 — СИНТЕТИЧЕСКИЕ ИСТОЧНИКИ. Ничего не скачивается: `testsrc2`, `sine`, `color`.
#
# Три файла, и каждый нужен своему пункту:
#   `src-video.mp4` — «нижний слой»: 20 с 1080×1920@30 с движением и звуком (бэд);
#   `voice.wav`     — «голос»: синус с двумя паузами, 48 кГц (вход duck'а, A2/A6);
#   `src-static.mp4` — 5 с НЕПОДВИЖНОГО кадра для A3: рывки зума меряются на статике,
#                      иначе межкадровая разность мерила бы движение источника.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

OUT="$HERE/src"
mkdir -p "$OUT"

echo "== A0: источники (synthetic, сеть не трогается) =="

# Нижний слой: testsrc2 даёт детерминированный узор с движением; звук — тон 220 Гц.
"$FF" "${COMMON[@]}" \
  -f lavfi -i "testsrc2=size=${W}x${H}:rate=${FPS}:duration=20" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=20" \
  -map 0:v -map 1:a "${VENC[@]}" "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/src-video.mp4"

# Голос: тон 300 Гц с ДВУМЯ паузами (3–5 с и 10–12 с) — под duck нужен именно перерыв.
"$FF" "${COMMON[@]}" \
  -f lavfi -i "sine=frequency=300:sample_rate=48000:duration=22" \
  -af "volume=0:enable='between(t,3,5)+between(t,10,12)'" \
  -c:a pcm_s16le -f wav "$OUT/voice.wav"

# Статика для A3: ОДИН кадр `testsrc2`, вынутый в PNG и растянутый на 5 с входом `-loop 1`.
#
# ПОЧЕМУ ЧЕРЕЗ PNG, А НЕ `select`+`loop` В ФИЛЬТРЕ. Измерено (03:17): цепочка
# `select=eq(n\,0),loop,trim,setpts` дала файл 25 fps / 126 кадров вместо 30/150 — частоту
# ffmpeg вывел сам, потому что после `loop` у кадров одинаковый PTS и `setpts` считает уже
# по своему `N`. Прибор A3 меряет РАЗНОСТЬ СОСЕДНИХ КАДРОВ, и «сколько их всего» — половина
# его смысла; вход `-loop 1 -framerate 30` не оставляет ffmpeg выбора.
"$FF" "${COMMON[@]}" -f lavfi -i "testsrc2=size=${W}x${H}:rate=${FPS}:duration=1" \
  -frames:v 1 "$OUT/static.png"
"$FF" "${COMMON[@]}" -loop 1 -framerate "${FPS}" -i "$OUT/static.png" -t 5 \
  -an "${VENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/src-static.mp4"

for f in src-video.mp4 voice.wav src-static.mp4; do
  printf '%-16s %s  %s\n' "$f" "$(sha "$OUT/$f")" "$("$FP" -v error -show_entries format=duration -of csv=p=0 "$OUT/$f")"
done
