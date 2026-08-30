// Реализация `still@1` — статичная картинка. Спек: `templates-spec/src/templates/still@1.ts`.
//
// ЧТО ЭТОТ ФАЙЛ ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Здесь только текст функции монтирования — тот, что
// материализация кладёт в композицию (`RendererTemplate.mountSource`). Схемы `params` здесь
// нет и быть не может: её держит спек, и второй разбор означал бы второй контракт. `params`
// приезжают УЖЕ прогнанными через `paramsSchema` компилятором (`CP-07`) — проверять их здесь
// значило бы проверять дважды и разойтись на второй правке.
//
// УМОЛЧАНИЕ `fit` ЖИВЁТ ЗДЕСЬ, А НЕ В СХЕМЕ, И ЭТО ДОСЛОВНО ТРЕБОВАНИЕ СПЕКА: «Значение по
// умолчанию принадлежит коду шаблона (`E-*`/`H-06`), а не схеме: умолчание в схеме — это
// число, которое видит валидатор и не видит автор». Порождённая запись `[img:]`
// (`core-model/src/anchors/img.ts`) `fit` не несёт вовсе — восемь записей из восьми на ролике
// AC1, — и без умолчания здесь они бы не отрисовались.
//
// АССЕТ ИЩЕТСЯ ПО РОЛИ, А НЕ ПО ПОРЯДКУ. Роль — `'asset'`, ровно та строка, что объявлена
// `declaredAssets` спека и лежит в IR (`compile/src/compile-ir.ts`). Индекс `[0]` работал бы
// ровно до первого шаблона с двумя ассетами и сломался бы молча.
//
// ОТСУТСТВИЕ АССЕТА — ОТКАЗ, А НЕ ПУСТОЙ КАДР. `declareAssets` возвращает ссылку всегда,
// значит пустой список означает разъехавшийся вход, а не «картинки не просили». Пустой слой
// дал бы собравшийся ролик, выглядящий не так; отказ дешевле ровно на стоимость просмотра
// (то же рассуждение, что у `resolveTemplate`).

import { canonicalJson } from '@vpe/core-model';

import type { RendererTemplate } from './index.js';

/**
 * Раскладка картинки в кадре — значение по умолчанию.
 *
 * Список спека состоит из одного элемента (`FITS = ['cover']`), и умолчание совпадает с ним:
 * иного значения ни один документ проекта не называл. Расширение списка — правка спека И
 * этой строки, и они обязаны ехать вместе.
 */
const DEFAULT_FIT = 'cover';

const STILL_MOUNT = `function (host, ctx) {
        var ref = null;
        for (var i = 0; i < ctx.assets.length; i++) {
          if (ctx.assets[i].role === 'asset') { ref = ctx.assets[i]; break; }
        }
        if (ref === null) {
          throw new Error(
            'still@1: в клипе нет ассета с ролью \\'asset\\'. Спек объявляет его всегда ' +
            '(declareAssets возвращает ссылку на любых params), поэтому пустой список — это ' +
            'разъехавшийся вход, а не «картинки не просили». Пустой слой дал бы собравшийся ' +
            'ролик, выглядящий не так'
          );
        }
        var img = document.createElement('img');
        img.className = 'still-image';
        img.src = ctx.assetUrl(ref.sha256);
        img.style.position = 'absolute';
        img.style.inset = '0';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = ctx.params.fit === undefined ? ${canonicalJson(DEFAULT_FIT)} : String(ctx.params.fit);
        img.style.objectPosition = '50% 50%';
        host.appendChild(img);
        host.style.opacity = '0';
        ctx.timeline.set(host, {opacity: 1}, ctx.toSeconds(ctx.frames.frameStart));
        ctx.timeline.set(host, {opacity: 0}, ctx.toSeconds(ctx.frames.frameEnd));
      }`;

/** `still@1` — реализация шаблона фикстуры; цель разворота `[img: alias]`. */
export const still1Impl: RendererTemplate = Object.freeze({
  templateId: 'still',
  templateVersion: 1,
  mountSource: STILL_MOUNT,
});
