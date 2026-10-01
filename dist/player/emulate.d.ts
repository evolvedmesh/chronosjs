/**
 * What the DOM doesn't hold but the user saw: hover, press and focus states,
 * and media queries that answered for the user's browser (dark mode, reduced
 * motion, touch). The player's iframe can't be hovered or focused and asks
 * the viewer's browser for its preferences, so the page's CSS is adapted:
 *
 * - each rule using `:hover`, `:active`, `:focus`, `:focus-visible` or
 *   `:focus-within` also gets a selector where the pseudo-class is a
 *   `[data-chronos-…]` attribute, and the player sets those attributes on the
 *   elements that were in that state. The rule keeps its place, so the cascade
 *   is unchanged;
 * - media queries on the user's preferences are rewritten to always or never
 *   match, as they did for the user.
 *
 * Only stylesheets the viewer may read are adapted: inline styles, CSS-in-JS
 * rules, inlined stylesheets and same-origin (or CORS-enabled) files.
 */
export interface PageEnv {
    dark: boolean;
    reducedMotion: boolean;
    coarse: boolean;
    noHover: boolean;
}
export type State = "hover" | "active" | "focus" | "focus-visible" | "focus-within";
export declare const STATE_ATTRIBUTE = "data-chronos-";
export declare function parseEnv(flags: unknown): PageEnv;
/** A media query as it answered in the user's browser. */
export declare function rewriteMedia(media: string, env: PageEnv): string;
/** The selector list plus a copy where state pseudo-classes are attributes. */
export declare function rewriteSelector(selector: string): string | undefined;
export declare class Emulator {
    private readonly doc;
    private seen;
    private states;
    private env;
    private override?;
    /** Set when the page's styles may have changed; `refresh()` clears it. */
    dirty: boolean;
    constructor(doc: Document);
    /** A new snapshot: new nodes and stylesheets, maybe another browser. */
    reset(env: PageEnv): void;
    /** Adapt stylesheets the page gained since the last call. */
    refresh(): void;
    /** Put a state on these elements (and take it off the others). */
    set(state: State, elements: Element[]): void;
    private rules;
    private media;
    /**
     * A page that declares `color-scheme: light dark` renders in the scheme the
     * browser prefers: give it the user's, not the viewer's.
     */
    private colorScheme;
}
/** The element and its ancestors, as `:hover`, `:active` and `:focus-within` apply. */
export declare function withAncestors(el: Element | null): Element[];
