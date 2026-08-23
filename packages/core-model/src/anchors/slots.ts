// Позиции якорей в разобранном исходнике: что вообще попадает в ledger и в каком порядке.
//
// ЧЕТЫРЕ ВИДА, И ВСЕ ЧЕТЫРЕ — ИЗ ADR-0004 §1: `sc:` (заголовок сцены), `w:` (токен исходника),
// `b:` (авторский бит `[beat:]`) и `b:img-…` (НЕЯВНЫЙ бит, который минтит компилятор на `[img:]`
// — §2a, M1). Пятое пространство `r:` (запись режиссуры) сюда не попадает: записи режиссуры
// живут в `direction/*.yaml`, а не в прозе.
//
// `ch:` В LEDGER НЕ ПИШЕТСЯ (решение владельца, `C-04`). Схема `anchors/1` требует непустой
// `sceneId` у каждой записи, а у якоря главы сцены нет; вписать туда первую сцену значило бы
// соврать в машинном файле. Ссылки на `ch:` (в фикстуре — `until: ch:main`) резолвятся по
// СТРУКТУРЕ AST, а не по ledger'у. Долг записан в `docs/DEBTS.md` с адресом `O-01`/`L-03`.
//
// ЧТО ТАКОЕ `surface` У НЕ-ТОКЕНА. У токена это его поверхностная форма (ADR-0004 §5). У
// `[beat: reveal]` — имя `reveal`, у `[img: harbour]` — alias `harbour`, у сцены — её id. То
// есть ровно то, что автор написал и что он же увидит в `vpe inspect`. Восстанавливать текст
// маркера (`[beat: reveal]`) здесь нечем и незачем: AST хранит имя, а не подстроку исходника.
//
// ЧТО ТАКОЕ `prev`/`next`. Поверхностные формы ближайших ТОКЕНОВ слева и справа — соседние
// СЛОВА, а не соседние якоря. Так требует смысл `boundTo` (§6: «правка соседнего слова у цели»)
// и так же говорит §10 про список исчезнувших битов «с контекстом ±5 слов»: контекст маркера —
// это слова вокруг него, а не другой маркер.
//
// ORDINAL — СКВОЗНОЙ СЧЁТЧИК ПОЗИЦИЙ ВНУТРИ СЦЕНЫ, 1-based. Сцена, а не файл: счётчик локален
// для сцены во всём проекте (`paragraphOrdinalInScene`, ADR-0010 §3a), иначе вставка абзаца в
// первую сцену переименовывала бы всё ниже по документу. Единый счётчик на все четыре вида —
// потому что `ordinal` участвует в `boundTo` как разделитель одинаковых контекстов, и ему нужен
// ровно один смысл: «какая по счёту позиция в сцене».

import type { Chunk, Paragraph, Scene, SourceDocument } from '../source/ast.js';

/** Откуда взялась позиция. `img` отличается от `beat` только тем, что бит неявный (§2a). */
export type SlotKind = 'scene' | 'token' | 'beat' | 'img';

/** Позиция якоря в исходнике — всё, что нужно, чтобы построить запись ledger'а. */
export interface AnchorSlot {
  readonly kind: SlotKind;
  /**
   * Имя якоря, если оно задано автором или выведено из его слов: `sc:<id>`, `b:<name>`,
   * `b:img-<alias>-<n>`. У токена — `null`: его id минтится (ADR-0004 §4).
   */
  readonly id: string | null;
  readonly surface: string;
  readonly chapterId: string;
  readonly sceneId: string;
  readonly ordinal: number;
  readonly prev: string | null;
  readonly next: string | null;
  /** `implicit` — только неявный бит `[img:]` (§2a); всё остальное — `token`. */
  readonly origin: 'token' | 'implicit';
  /** `[img:]`: alias картинки. Нужен разворачиванию в direction-запись (ADR-0002 §4). */
  readonly alias?: string;
}

/**
 * Имя неявного бита `[img:]` — **ADR-0002 §4 / ADR-0004 §2a**.
 *
 * СЧЁТ — ПО ALIAS И ПО ФАЙЛУ, 1-based (решение владельца, `C-04`; вопрос стоял в `docs/DEBTS.md`
 * №10). Обе «сценные» трактовки — «n-й `[img:]` в сцене» и «n-й `[img:]` с этим alias в сцене» —
 * дают ОДИНАКОВУЮ строку для одного alias в двух сценах (`b:img-sea-1` и `b:img-sea-1`), то есть
 * ломают **A3** на совершенно законном «одно фото в двух сценах»; счёт по всем `[img:]` вместо
 * счёта по alias вдобавок переименовывает чужие биты при вставке картинки выше. Расхождение с
 * буквой ADR («ordinalВСцене») записано в `docs/DEBTS.md` и правится при ревизии ADR.
 */
export function implicitBitId(alias: string, ordinal: number): string {
  return `b:img-${alias}-${String(ordinal)}`;
}

interface Draft {
  readonly kind: SlotKind;
  readonly id: string | null;
  readonly surface: string;
  readonly origin: 'token' | 'implicit';
  readonly alias?: string;
}

/** Позиции одной сцены в порядке исходника — до простановки `prev`/`next`. */
function draftsOfScene(scene: Scene, aliasCounts: Map<string, number>): Draft[] {
  const out: Draft[] = [{ kind: 'scene', id: scene.anchor, surface: scene.id, origin: 'token' }];
  for (const block of scene.blocks) {
    if (block.kind !== 'paragraph') continue;
    for (const part of (block as Paragraph).parts) {
      if (part.kind !== 'chunk') continue;
      for (const node of (part as Chunk).nodes) {
        if (node.kind === 'token') {
          out.push({ kind: 'token', id: null, surface: node.surface, origin: 'token' });
        } else if (node.kind === 'beat') {
          out.push({ kind: 'beat', id: node.anchor, surface: node.name, origin: 'token' });
        } else if (node.kind === 'img') {
          const seen = (aliasCounts.get(node.alias) ?? 0) + 1;
          aliasCounts.set(node.alias, seen);
          out.push({
            kind: 'img',
            id: implicitBitId(node.alias, seen),
            surface: node.alias,
            origin: 'implicit',
            alias: node.alias,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Все позиции якорей документа в порядке исходника.
 *
 * Счётчик alias — на весь документ (см. `implicitBitId`), поэтому он живёт снаружи цикла сцен.
 */
export function anchorSlots(document: SourceDocument): AnchorSlot[] {
  const aliasCounts = new Map<string, number>();
  const out: AnchorSlot[] = [];

  for (const chapter of document.chapters) {
    for (const scene of chapter.scenes) {
      const drafts = draftsOfScene(scene, aliasCounts);
      const tokenAt: (string | null)[] = drafts.map((d) => (d.kind === 'token' ? d.surface : null));

      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        if (draft === undefined) continue;
        let prev: string | null = null;
        for (let k = index - 1; k >= 0; k -= 1) {
          const surface = tokenAt[k];
          if (surface !== null && surface !== undefined) {
            prev = surface;
            break;
          }
        }
        let next: string | null = null;
        for (let k = index + 1; k < drafts.length; k += 1) {
          const surface = tokenAt[k];
          if (surface !== null && surface !== undefined) {
            next = surface;
            break;
          }
        }
        out.push({
          kind: draft.kind,
          id: draft.id,
          surface: draft.surface,
          chapterId: chapter.id,
          sceneId: scene.id,
          ordinal: index + 1,
          prev,
          next,
          origin: draft.origin,
          ...(draft.alias === undefined ? {} : { alias: draft.alias }),
        });
      }
    }
  }

  return out;
}
