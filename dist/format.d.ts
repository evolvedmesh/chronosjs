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
export declare const FORMAT_VERSION = 1;
/** Event type codes. Append only: a replay written today must play later. */
export declare const E: {
    /**
     * `[href, width, height, env?]`: the page and viewport a snapshot belongs to.
     * `env` lists what the user's browser preferred, as letters (absent when
     * none): `d` dark colour scheme, `m` reduced motion, `c` coarse pointer,
     * `n` no hover. The player applies them to the page's media queries.
     */
    readonly Meta: 0;
    /** `[tree, scrollX, scrollY]`: the whole document; node ids restart at 1. */
    readonly Snapshot: 1;
    /** `[firstNewId, removes, adds, attrs, texts]`, trailing empties omitted. */
    readonly Mutation: 2;
    /** `[id, x?, y?]`: viewport coordinates, absent for keyboard clicks. */
    readonly Click: 3;
    /** `[id, value]`: the text, 1/0 for checked, or a select's selected index. */
    readonly Input: 4;
    /** `[id, x, y]`: id 0 is the document. */
    readonly Scroll: 5;
    /** `[width, height]` */
    readonly Resize: 6;
    /** `[path]`: a client-side navigation (history API). */
    readonly Nav: 7;
    /** `[kind, message, stack?]`: what triggered the replay, or happened after. */
    readonly Error: 8;
    /** `[styleId, index, rule]` inserts a CSSOM rule, `[styleId, index]` deletes one. */
    readonly CssRule: 9;
    /** `[method, path, status, ms]`: a fetch or XHR (status 0: network error). */
    readonly Http: 10;
    /** `[id, key]`: Enter, Escape or Tab. */
    readonly Key: 11;
    /** `[hidden]`: 1 when the tab was hidden, 0 when shown again. */
    readonly Visibility: 12;
    /** `[id, visible]`: the focused element (0: none); visible is 1 when `:focus-visible` matched. */
    readonly Focus: 13;
    /**
     * `[x, y]`: where the mouse was, recorded when it comes to rest and when it
     * starts moving again (never while it moves). The player draws the path in between.
     */
    readonly Pointer: 14;
};
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
    reason?: {
        kind: string;
        message: string;
    };
    /** Inlined stylesheets by URL, when `inlineStylesheets` is on. */
    assets?: Record<string, string>;
    /** Events with delta times. Use `absoluteEvents()` to read them. */
    e: ReplayEvent[];
}
/** Turn delta times into milliseconds since the start of the replay. */
export declare function absoluteEvents(replay: Replay): ReplayEvent[];
/** Turn absolute (epoch) times into deltas. Returns the start time too. */
export declare function deltaEvents(events: ReplayEvent[]): {
    ts: number;
    e: ReplayEvent[];
};
export declare function newReplayId(): string;
export declare function isElement(node: SNode): node is SElement;
/** The attributes object of a serialized element, if it has one. */
export declare function attrsOf(node: SElement): SAttrs | undefined;
/** The children of a serialized element. */
export declare function childrenOf(node: SElement): SNode[];
