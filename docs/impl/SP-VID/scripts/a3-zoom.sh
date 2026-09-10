#!/usr/bin/env bash
# SP-VID A3 — ЗУМ НА ХОДУ: три способа, объективное измерение рывков.
#
# ПОЧЕМУ НА СТАТИКЕ. Прибор — межкадровая разность яркости (`signalstats` `YDIF`). На
# движущемся источнике он мерил бы движение источника; на замороженном кадре ВСЯ разность
# между соседними кадрами есть результат зума.
#
# ПОЧЕМУ ИЗМЕРЕНИЕ ИДЁТ ПО БЕЗ ПОТЕРЬ, А ВЛАДЕЛЬЦУ ОСТАЮТСЯ ДРУГИЕ ФАЙЛЫ. `YDIF`, снятый с
# h264 crf 18, мерил бы СУММУ «шаг зума ⊕ решения энкодера». Поэтому те же фильтры пишутся
# ДВАЖДЫ: `zoom-{a,b,c,d}.mp4` канальным энкодером — на глаза владельцу, и `m-*.mkv` в
# `ffv1` — под прибор.
#
# ═══ НАЙДЕНО ИЗМЕРЕНИЕМ (03:18): `crop` НЕ УМЕЕТ ЗУМИРОВАТЬ ═══
# У фильтра `crop` выражения `w`/`h` вычисляются ОДИН РАЗ на конфигурации фильтра; по кадрам
# пересчитываются только `x`/`y`. Первый вариант прибора («`crop` с выражением по `n`, затем
# `scale`») поэтому не зумировал вовсе: окно оставалось 1080×1920, `scale` был тождественным,
# и `flags=lanczos` с `flags=bicubic` дали ПОБАЙТОВО РАВНЫЕ файлы — прибор мерил статику.
# Правильная форма «выражение по `n`» — у `scale` с `eval=frame`; кадрирует центр `crop` с
# постоянным размером. Она и стоит ниже.
#
# ГЛАВНОЕ ЧИСЛО — НЕ СРЕДНЕЕ, А «СКОЛЬКО КАДРОВ ВООБЩЕ СДВИНУЛОСЬ». Ровный зум двигает
# картинку КАЖДЫЙ кадр; целочисленный шаг — раз в несколько кадров, между ними изображение
# стоит. Это и есть рывок, и он виден долей кадров с `YDIF == 0`.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

SRC="$HERE/src/src-static.mp4"
OUT="$HERE"
N=150            # 5 с при 30 fps
Z="(1.0+0.2*n/${N})"

# ═══ ВТОРАЯ НАХОДКА ПРИБОРА (03:20): КАНОНИЧЕСКОЕ НАПИСАНИЕ `zoompan` НЕ ЗУМИРУЕТ ═══
# `z='min(zoom+шаг,1.2)'` — форма из всех рецептов в сети — при `d=1` даёт КОНСТАНТУ: `zoom`
# читает масштаб ПРЕДЫДУЩЕГО кадра, а при одном выходном кадре на входной он сбрасывается в 1,
# и выражение каждый раз возвращает `1+шаг`. Измерено: среднее `YDIF` 0.00081 против 1.25 у
# зума через `scale` — то есть картинка практически стоит. Рабочая форма ведёт масштаб от
# номера ВЫХОДНОГО кадра (`on`), и ниже стоит она; сломанная оставлена рядом как измеренная.
ZOOMPAN_BROKEN="zoompan=z='min(zoom+0.0013333,1.2)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}"
ZOOMPAN="zoompan=z='1+0.2*on/${N}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}"
scale_zoom() { echo "scale=w='trunc(iw*${Z}/2)*2':h='trunc(ih*${Z}/2)*2':eval=frame:flags=$1,crop=${W}:${H}"; }
# Четвёртый вариант — СУПЕРСЭМПЛИНГ: источник разворачивается ×2 один раз, зум идёт по
# удвоенной сетке, и целочисленный шаг стоит вдвое меньше кадра выхода.
SUPER="scale=${W}*2:${H}*2:flags=lanczos,scale=w='trunc(iw*${Z}/2)*2':h='trunc(ih*${Z}/2)*2':eval=frame:flags=lanczos,crop=${W}*2:${H}*2,scale=${W}:${H}:flags=lanczos"

viewable() { "$FF" "${COMMON[@]}" -i "$SRC" -vf "$1" -an "${VENC[@]}" "${BITEXACT[@]}" -f mp4 "$2"; }
lossless() { "$FF" "${COMMON[@]}" -i "$SRC" -vf "$1" -an -c:v ffv1 -level 3 -threads 4 "${BITEXACT[@]}" -f matroska "$2"; }

viewable "$ZOOMPAN"           "$OUT/zoom-a.mp4"; lossless "$ZOOMPAN"           "$OUT/m-a.mkv"
lossless "$ZOOMPAN_BROKEN" "$OUT/m-a0.mkv"
viewable "$(scale_zoom lanczos)" "$OUT/zoom-b.mp4"; lossless "$(scale_zoom lanczos)" "$OUT/m-b.mkv"
viewable "$(scale_zoom bicubic)" "$OUT/zoom-c.mp4"; lossless "$(scale_zoom bicubic)" "$OUT/m-c.mkv"
viewable "$SUPER"             "$OUT/zoom-d.mp4"; lossless "$SUPER"             "$OUT/m-d.mkv"

ydif() {
  "$FF" -hide_banner -nostdin -loglevel info -i "$1" -vf signalstats,metadata=print:key=lavfi.signalstats.YDIF -f null - 2>&1 |
    sed -n 's/.*lavfi.signalstats.YDIF=//p' |
    awk -v tag="$2" 'NR>1{v[n++]=$1; s+=$1; ss+=$1*$1; if($1==0) z++; if($1>mx)mx=$1}
      END{m=s/n; printf "%-16s кадров %3d  YDIF среднее %.5f  σ %.5f  макс %.5f  НУЛЕВЫХ (кадр не сдвинулся) %d (%.1f %%)\n",
          tag, n, m, sqrt(ss/n-m*m), mx, z, 100*z/n}'
}

echo "== A3: зум, межкадровая разность на статике (измерение по ffv1, без потерь) =="
ydif "$OUT/m-a.mkv" "zoompan (on)"
ydif "$OUT/m-a0.mkv" "zoompan (zoom+)"
ydif "$OUT/m-b.mkv" "scale+lanczos"
ydif "$OUT/m-c.mkv" "scale+bicubic"
ydif "$OUT/m-d.mkv" "супер ×2 lanczos"

echo
echo "== то же по канальному h264 crf 18 (файлы, которые смотрит владелец) =="
ydif "$OUT/zoom-a.mp4" "zoompan"
ydif "$OUT/zoom-b.mp4" "scale+lanczos"
ydif "$OUT/zoom-c.mp4" "scale+bicubic"
ydif "$OUT/zoom-d.mp4" "супер ×2 lanczos"

echo
echo "== четыре ли это РАЗНЫХ файла =="
for f in a b c d; do printf '%-8s %s  %s Б\n' "m-$f" "$(sha "$OUT/m-$f.mkv")" "$(stat -c%s "$OUT/m-$f.mkv")"; done

echo
echo "== цена каждого способа (одна и та же длина, канальный энкодер) =="
for pair in "a $ZOOMPAN" ; do :; done
for f in a b c d; do
  case $f in a) F="$ZOOMPAN";; b) F="$(scale_zoom lanczos)";; c) F="$(scale_zoom bicubic)";; d) F="$SUPER";; esac
  t0=$(date +%s.%N); viewable "$F" "$OUT/zoom-$f.mp4"; t1=$(date +%s.%N)
  printf 'zoom-%s  %6.2f с на 5 с ролика\n' "$f" "$(echo "$t1 - $t0" | bc -l)"
done
