/**
 * The Chronos replay format, version 1.
 *
 * A replay is like a game replay file: one starting state (a snapshot of the
 * page) followed by everything that changed it, so a player can rebuild the
 * page frame by frame. It is kept small on purpose:
 *
 * - events are arrays, not objects, and their type is a small number;
 * - times are deltas from the previous event, in milliseconds;
 * - node ids are never written in a snapshot: both sides number nodes in
 *   document order, so the player derives the same ids;
 * - mouse movement is not recorded: the player draws a cursor that glides
 *   between the recorded clicks;
 * - scripts, event handler attributes and head-only metadata are dropped;
 * - the encoded file is JSON compressed with deflate-raw.
 */

export const FORMAT_VERSION = 1;

/** Event type codes. Append only: a replay written today must play later. */
export const E = {
  /**
   * `[href, width, height, env?]`: the page and viewport a snapshot belongs to.
   * `env` lists what the user's browser preferred, as letters (absent when
   * none): `d` dark colour scheme, `m` reduced motion, `c` coarse pointer,
   * `n` no hover. The player applies them to the page's media queries.
   */
  Meta: 0,
  /** `[tree, scrollX, scrollY]`: the whole document; node ids restart at 1. */
  Snapshot: 1,
  /** `[firstNewId, removes, adds, attrs, texts]`, trailing empties omitted. */
  Mutation: 2,
  /** `[id, x?, y?]`: viewport coordinates, absent for keyboard clicks. */
  Click: 3,
  /** `[id, value]`: the text, 1/0 for checked, or a select's selected index. */
  Input: 4,
  /** `[id, x, y]`: id 0 is the document. */
  Scroll: 5,
  /** `[width, height]` */
  Resize: 6,
  /** `[path]`: a client-side navigation (history API). */
  Nav: 7,
  /** `[kind, message, stack?]`: what triggered the replay, or happened after. */
  Error: 8,
  /** `[styleId, index, rule]` inserts a CSSOM rule, `[styleId, index]` deletes one. */
  CssRule: 9,
  /** `[method, path, status, ms]`: a fetch or XHR (status 0: network error). */
  Http: 10,
  /** `[id, key]`: Enter, Escape or Tab. */
  Key: 11,
  /** `[hidden]`: 1 when the tab was hidden, 0 when shown again. */
  Visibility: 12,
  /** `[id, visible]`: the focused element (0: none); visible is 1 when `:focus-visible` matched. */
  Focus: 13,
  /**
   * `[x, y]`: where the mouse was, recorded when it comes to rest and when it
   * starts moving again (never while it moves). The player draws the path in between.
   */
  Pointer: 14,
} as const;

export type EventType = (typeof E)[keyof typeof E];

/**
 * A serialized node:
 * - a string is a text node;
 * - `0` is a comment (its text is never needed);
 * - an array is an element: `[tag, attrs?, ...children]`, where `attrs` is a
 *   plain object (absent when the element has none).
 *
 * Attribute keys starting with `$` are Chronos state, not HTML attributes:
 * `$v` value (a select's selected index), `$c` checked, `$css` CSSOM rules of a `<style>`, `$sx`/`$sy`
 * element scroll, `$w`/`$h` size of a blocked element, `$ns` the namespace
 * (`s` SVG, `h` HTML) when the parent doesn't imply it.
 */
export type SNode = string | 0 | SElement;
export type SElement = [string, ...(SAttrs | SNode)[]];
export type SAttrs = Record<string, string | number | string[] | null>;

/** `[parentId, previousSiblingId (0: first child), node]` */
export type SAdd = [number, number, SNode];
/** `[id, { name: value | null }]`, null removes the attribute. */
export type SAttrChange = [number, SAttrs];
/** `[id, text]` */
export type STextChange = [number, string];

/** `[time, type, ...payload]`; time is absolute in memory, a delta on disk. */
export type ReplayEvent = [number, number, ...unknown[]];

export interface ReplayMeta {
  /** App or role name, as the host app configured it. */
  app?: string;
  release?: string;
  sessionId?: string;
  userId?: string;
  userAgent?: string;
  /** Anything else the host app wants to attach (strings only). */
  tags?: Record<string, string>;
}

export interface Replay {
  v: typeof FORMAT_VERSION;
  /** Replay id (32 hex characters). */
  id: string;
  /** Epoch milliseconds of the first event. */
  ts: number;
  meta: ReplayMeta;
  /** The error that triggered the replay, for listings. */
  reason?: { kind: string; message: string };
  /** Inlined stylesheets by URL, when `inlineStylesheets` is on. */
  assets?: Record<string, string>;
  /** Events with delta times. Use `absoluteEvents()` to read them. */
  e: ReplayEvent[];
}

/** Turn delta times into milliseconds since the start of the replay. */
export function absoluteEvents(replay: Replay): ReplayEvent[] {
  let t = 0;
  return replay.e.map((event) => {
    t += event[0];
    const copy = event.slice() as ReplayEvent;
    copy[0] = t;
    return copy;
  });
}

/** Turn absolute (epoch) times into deltas. Returns the start time too. */
export function deltaEvents(events: ReplayEvent[]): { ts: number; e: ReplayEvent[] } {
  const ts = events.length ? events[0][0] : Date.now();
  let previous = ts;
  const e = events.map((event) => {
    const copy = event.slice() as ReplayEvent;
    copy[0] = Math.max(0, Math.round(event[0] - previous));
    previous = event[0];
    return copy;
  });
  return { ts, e };
}

export function newReplayId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isElement(node: SNode): node is SElement {
  return Array.isArray(node);
}

/** The attributes object of a serialized element, if it has one. */
export function attrsOf(node: SElement): SAttrs | undefined {
  const second = node[1];
  return second && typeof second === "object" && !Array.isArray(second) ? (second as SAttrs) : undefined;
}

/** The children of a serialized element. */
export function childrenOf(node: SElement): SNode[] {
  return (attrsOf(node) ? node.slice(2) : node.slice(1)) as SNode[];
}
