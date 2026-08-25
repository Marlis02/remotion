// Связка «токен исходника ↔ якорь» — то, ЧТО стадия `bind` получает на вход (`V-05`).
//
// BIND НЕ МИНТИТ ЯКОРЕЙ. Обе половины связки существуют ДО неё и приходят готовыми:
//   * токены — `C-02` (`TokenNode` в AST: `surface`, `spoken`, `spokenStart`);
//   * якоря — `C-04` (`syncLedger` → `AnchorBinding[]`, минт в `anchors/mint.ts`, 128 бит
//     CSPRNG, единственный законный недетерминизм модели).
// Здесь они только СОЕДИНЯЮТСЯ. Охранник — греп по каталогу (`bind/**` не знает ни
// `mintAnchorId`, ни `node:crypto`, ни как построить идентификатор якоря).
//
// ПОЧЕМУ СОЕДИНЕНИЕ — ZIP ПО ПОРЯДКУ, А НЕ ПОИСК ПО `surface`. Поиск по поверхностной форме
// сматчил бы первое одинаковое слово («the» в абзаце встречается пять раз), то есть был бы
// не связкой, а лотереей. Порядок же у двух списков ОДИН ПО ПОСТРОЕНИЮ: `anchorSlots`
// (`C-04`) и `tokensIn` (`C-02`) обходят дерево одинаково — главы → сцены → блоки-абзацы →
// чанки → узлы, — и `anchorSlots` кладёт `surface: node.surface` того же самого узла.
// Совпадение проверяется ДВАЖДЫ: длиной списков и поверхностной формой на каждом индексе;
// расхождение — жёсткая ошибка с длинами и местом, а не «взять сколько есть».
//
// ПОЧЕМУ РАЗДАЧА ПО ЧАНКАМ ЗОВЁТ `splitChunkText`, А НЕ ПОВТОРЯЕТ ЕГО. Части абзаца должны
// получиться ТЕ ЖЕ, что получил `speechPlan` (`V-03`): вторая копия раскроя разъехалась бы с
// первой при первой же правке предела, и токены уехали бы в соседний чанк молча. Прецедент
// решения — `isSentenceEnd` из `C-02`, который `V-03` по решению владельца ВЫЗЫВАЕТ, а не
// копирует. Сверх того порядок частей сверяется с планом дословно: текст части обязан быть
// равен `spokenChunkText` планового чанка на каждом индексе.

import { chunksOf, pointLength, type AnchorBinding, type SourceDocument, type TokenNode } from '@vpe/core-model';

import { VoiceError } from '../errors.js';
import { splitChunkText } from '../plan/split.js';
import type { PlannedChunk, SpeechPlan } from '../plan/speech-plan.js';

import type { SourceTokenRef } from './types.js';

/**
 * Какой якорь достался какому токену.
 *
 * Ключ карты — САМ УЗЕЛ AST (сравнение по ссылке), а не его поверхностная форма и не индекс:
 * `tokensIn` и обход внутри чанка возвращают одни и те же объекты, поэтому связка не может
 * «съехать» на одинаковом слове.
 *
 * @throws {VoiceError} `ADR-0004 §4` — списки разошлись длиной или поверхностной формой.
 *   Это значит, что ledger синхронизирован НЕ С ЭТИМ разбором исходника, и молча взять
 *   пересечение нельзя: привязки уехали бы на чужие слова.
 */
export function anchorIdByToken(
  document: SourceDocument,
  anchors: readonly AnchorBinding[],
): ReadonlyMap<TokenNode, string> {
  const tokens = tokensOfDocument(document);
  const slots = anchors.filter((binding) => binding.slot.kind === 'token');

  if (slots.length !== tokens.length) {
    throw new VoiceError(
      'ADR-0004 §4',
      `ledger описывает ${String(slots.length)} токен(ов), а разбор исходника ` +
        `${String(document.file)} даёт ${String(tokens.length)}. Списки обязаны совпасть ` +
        'длиной: стадия `bind` якорей не минтит, она их связывает, и лишний токен остался бы ' +
        'без якоря, а лишний якорь — привязанным к чужому слову. Вероятная причина: ledger ' +
        'синхронизирован не с этим разбором (`syncLedger` не позван после правки текста).',
    );
  }

  const out = new Map<TokenNode, string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const binding = slots[i];
    if (token === undefined || binding === undefined) continue;
    if (binding.slot.surface !== token.surface) {
      throw new VoiceError(
        'ADR-0004 §4',
        `токен №${String(i + 1)} разбора и якорь №${String(i + 1)} ledger'а описывают разные ` +
          `слова: у токена поверхностная форма \`${token.surface}\`, у якоря — ` +
          `\`${binding.slot.surface}\` (сцена \`${binding.slot.sceneId}\`, позиция ` +
          `${String(binding.slot.ordinal)}). Порядок двух обходов совпадает по построению, ` +
          'значит разошлись сами входы — ledger синхронизирован не с этим разбором.',
      );
    }
    out.set(token, binding.id);
  }
  return out;
}

/** Токены документа в порядке исходника. Обход тот же, что у `anchorSlots` (`C-04`). */
function tokensOfDocument(document: SourceDocument): readonly TokenNode[] {
  const out: TokenNode[] = [];
  for (const chapter of document.chapters) {
    for (const scene of chapter.scenes) {
      for (const block of scene.blocks) {
        if (block.kind !== 'paragraph') continue;
        for (const chunk of chunksOf(block)) {
          for (const node of chunk.nodes) {
            if (node.kind === 'token') out.push(node);
          }
        }
      }
    }
  }
  return out;
}

/** Вход раздачи токенов по чанкам плана. Все величины уже есть у того, кто строил план. */
export interface PlanTokensInput {
  readonly plan: SpeechPlan;
  readonly document: SourceDocument;
  /** `audio-profile/1 → maxChunkChars`. Тот же, с которым строился план (`V-03`). */
  readonly maxChunkChars: number;
  /** `SyncResult.bindings` — кто какой якорь получил (`C-04`). */
  readonly anchors: readonly AnchorBinding[];
}

/**
 * Токены исходника, разложенные по чанкам плана: `chunkKey → SourceTokenRef[]`.
 *
 * `spokenStart` каждой ссылки ПЕРЕСЧИТАН на начало своей части: биндер видит только тот
 * `spokenText`, который ушёл провайдеру, и другой системы отсчёта у него нет.
 *
 * @throws {VoiceError} `ADR-0010 §3` — обход документа разошёлся с планом (иное число частей
 *   либо иной текст части). Значит, план построен с другим `maxChunkChars` или с другим
 *   разбором, и раздача токенов по чанкам была бы раздачей по чужим адресам.
 */
export function tokensOfPlan(input: PlanTokensInput): ReadonlyMap<string, readonly SourceTokenRef[]> {
  const byToken = anchorIdByToken(input.document, input.anchors);
  const out = new Map<string, readonly SourceTokenRef[]>();
  let index = 0;

  for (const chapter of input.document.chapters) {
    for (const scene of chapter.scenes) {
      for (const block of scene.blocks) {
        if (block.kind !== 'paragraph') continue;
        for (const chunk of chunksOf(block)) {
          const tokens = chunk.nodes.filter((node): node is TokenNode => node.kind === 'token');
          for (const part of splitChunkText(chunk.spoken, input.maxChunkChars)) {
            const planned = input.plan.chunks[index];
            assertSamePart(planned, part, index, input.plan.chunks.length);
            const from = part.spokenStart;
            const to = from + pointLength(part.spoken);
            out.set(
              planned.chunkKey,
              tokens
                .filter((token) => token.spokenStart >= from && token.spokenStart < to)
                .map((token) => ({
                  anchorId: anchorOf(byToken, token),
                  surface: token.surface,
                  spoken: token.spoken,
                  spokenStart: token.spokenStart - from,
                })),
            );
            index += 1;
          }
        }
      }
    }
  }

  if (index !== input.plan.chunks.length) {
    throw new VoiceError(
      'ADR-0010 §3',
      `обход исходника дал ${String(index)} част(ей) абзацев, а план содержит ` +
        `${String(input.plan.chunks.length)} чанк(ов). Раздача токенов идёт тем же обходом, ` +
        'что и построение плана, поэтому расхождение означает разные входы: другой ' +
        '`maxChunkChars` либо другой разбор исходника.',
    );
  }
  return out;
}

/**
 * Якорь токена или отказ. `??`-заглушки здесь нет намеренно: токен без якоря — это привязка
 * к пустому адресу, то есть ровно то, что стадия обязана делать невозможным.
 */
function anchorOf(byToken: ReadonlyMap<TokenNode, string>, token: TokenNode): string {
  const id = byToken.get(token);
  if (id === undefined) {
    throw new VoiceError(
      'ADR-0004 §4',
      `токену \`${token.surface}\` не досталось якоря: он найден обходом чанков, но не найден ` +
        'обходом документа. Оба обхода в этом файле одни и те же, поэтому расхождение ' +
        'означает дефект связки, а не входа.',
    );
  }
  return id;
}

/** Часть обхода обязана быть тем же чанком плана — иначе токены уедут по чужим адресам. */
function assertSamePart(
  planned: PlannedChunk | undefined,
  part: { readonly spoken: string; readonly spokenStart: number },
  index: number,
  total: number,
): asserts planned is PlannedChunk {
  if (planned === undefined) {
    throw new VoiceError(
      'ADR-0010 §3',
      `обход исходника дошёл до части №${String(index + 1)}, а план содержит только ` +
        `${String(total)} чанк(ов). План и обход обязаны идти по одному раскрою.`,
    );
  }
  if (planned.spokenChunkText !== part.spoken || planned.spokenStart !== part.spokenStart) {
    throw new VoiceError(
      'ADR-0010 §3',
      `часть №${String(index + 1)} обхода не совпала с чанком плана \`${planned.chunkKey}\`: ` +
        `у части ${String(pointLength(part.spoken))} code point(ов) от смещения ` +
        `${String(part.spokenStart)}, у чанка — ${String(pointLength(planned.spokenChunkText))} ` +
        `от ${String(planned.spokenStart)}. Раскрой обязан быть тем же: токены раздаются по ` +
        'адресам плана, и разошедшийся раскрой отдал бы их соседнему чанку молча.',
    );
  }
}
