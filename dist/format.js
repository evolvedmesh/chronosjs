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
};
/** Turn delta times into milliseconds since the start of the replay. */
export function absoluteEvents(replay) {
    let t = 0;
    return replay.e.map((event) => {
        t += event[0];
        const copy = event.slice();
        copy[0] = t;
        return copy;
    });
}
/** Turn absolute (epoch) times into deltas. Returns the start time too. */
export function deltaEvents(events) {
    const ts = events.length ? events[0][0] : Date.now();
    let previous = ts;
    const e = events.map((event) => {
        const copy = event.slice();
        copy[0] = Math.max(0, Math.round(event[0] - previous));
        previous = event[0];
        return copy;
    });
    return { ts, e };
}
export function newReplayId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function isElement(node) {
    return Array.isArray(node);
}
/** The attributes object of a serialized element, if it has one. */
export function attrsOf(node) {
    const second = node[1];
    return second && typeof second === "object" && !Array.isArray(second) ? second : undefined;
}
/** The children of a serialized element. */
export function childrenOf(node) {
    return (attrsOf(node) ? node.slice(2) : node.slice(1));
}
//# sourceMappingURL=format.js.map