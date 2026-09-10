#!/usr/bin/env bash
# SP-VID A5 — СКОРОСТЬ: секунды ffmpeg на 60 с 1080×1920@30 по стадиям.
#
# Три числа, и каждое — своя стадия гипотезы «(а)»:
#   (1) наложение графики без зума  — `overlay` поверх видео, канальный энкодер;
#   (2) то же С зумом               — добавлен `zoompan`;
#   (3) рендер Chrome 60 с графики  — меряется скриптом `a5-chrome.mjs` (одноразовая
#       композиция, как в A1), потому что фикстура закрыта заданием.
# Итог приводится к «мс на секунду ролика»: 60 с ролика — общий знаменатель для всех трёх.
#
# Каждое измерение — ТРИ прогона, берётся медиана: одиночный замер на ноуте под фоновой
# нагрузкой не измерение, а анекдот.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

SRC="$HERE/src"
FRAMES="${1:-$HERE/a1/frames-clear}"
OUT="$HERE/a5"
mkdir -p "$OUT"
SECONDS_OF_VIDEO=60

NF=$(ls "$FRAMES"/*.png 2>/dev/null | wc -l)
if [ "$NF" -eq 0 ]; then echo "A5: нет кадров в $FRAMES — сначала A1" >&2; exit 2; fi

# Источник на 60 с: тот же `testsrc2`, длиннее. Кодируется ОДИН раз и в замер не входит.
if [ ! -f "$OUT/src-60.mp4" ]; then
  "$FF" "${COMMON[@]}" -f lavfi -i "testsrc2=size=${W}x${H}:rate=${FPS}:duration=60" \
    -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=60" \
    -map 0:v -map 1:a "${VENC[@]}" "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/src-60.mp4"
fi

median3() { printf '%s\n%s\n%s\n' "$1" "$2" "$3" | sort -n | sed -n 2p; }

stage() {
  local name="$1" filter="$2" out="$3"
  local t=()
  for i in 1 2 3; do
    local t0 t1
    t0=$(date +%s.%N)
    "$FF" "${COMMON[@]}" -i "$OUT/src-60.mp4" -framerate "$FPS" -i "$FRAMES/frame_%06d.png" \
      -filter_complex "$filter" -map '[vout]' -map 0:a \
      "${VENC[@]}" "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$out"
    t1=$(date +%s.%N)
    t+=("$(echo "$t1 - $t0" | bc -l)")
  done
  local m
  m=$(median3 "${t[@]}")
  printf '%-24s медиана %7.2f с  → %7.1f мс на секунду ролика  (прогоны: %.2f %.2f %.2f)\n' \
    "$name" "$m" "$(echo "$m * 1000 / $SECONDS_OF_VIDEO" | bc -l)" "${t[0]}" "${t[1]}" "${t[2]}"
}

# ГРАФИКА ОБЯЗАНА БЫТЬ КОНЕЧНОЙ, а `overlay` — `shortest=1`: бесконечный вход при
# `eof_action=repeat` даёт бесконечный выход (измерено 03:14 и повторно 03:37 — 422 МБ за
# 11 минут). Оба лечения, а не одно: первое убирает причину, второе не даёт ей вернуться.
GFX="[1:v]loop=loop=-1:size=${NF}:start=0,trim=duration=${SECONDS_OF_VIDEO},setpts=N/${FPS}/TB,format=rgba[gfx]"

echo "== A5: ffmpeg на 60 с 1080×1920@30 =="
stage "overlay без зума" \
  "${GFX};[0:v][gfx]overlay=0:0:format=auto:shortest=1,format=yuv420p[vout]" \
  "$OUT/speed-plain.mp4"
stage "overlay + zoompan" \
  "${GFX};[0:v]zoompan=z='1+0.2*on/1800':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}[bg];[bg][gfx]overlay=0:0:format=auto:shortest=1,format=yuv420p[vout]" \
  "$OUT/speed-zoom.mp4"
# Форма зума — та, что РАБОТАЕТ (A3): у `crop` `w`/`h` считаются один раз, поэтому окно ведёт
# `scale` с `eval=frame`, а центр берёт `crop` постоянного размера.
stage "overlay + scale-зум" \
  "${GFX};[0:v]scale=w='trunc(iw*(1+0.2*n/1800)/2)*2':h='trunc(ih*(1+0.2*n/1800)/2)*2':eval=frame:flags=lanczos,crop=${W}:${H}[bg];[bg][gfx]overlay=0:0:format=auto:shortest=1,format=yuv420p[vout]" \
  "$OUT/speed-scalezoom.mp4"

echo "-- перекодирование БЕЗ композиции (нижняя граница цены энкодера) --"
t=()
for i in 1 2 3; do
  t0=$(date +%s.%N)
  "$FF" "${COMMON[@]}" -i "$OUT/src-60.mp4" -map 0:v -map 0:a "${VENC[@]}" "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/speed-bare.mp4"
  t1=$(date +%s.%N)
  t+=("$(echo "$t1 - $t0" | bc -l)")
done
m=$(median3 "${t[@]}")
printf '%-24s медиана %7.2f с  → %7.1f мс на секунду ролика\n' "только энкодер" "$m" "$(echo "$m * 1000 / $SECONDS_OF_VIDEO" | bc -l)"
