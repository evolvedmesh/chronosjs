import { type SAdd, type SAttrChange, type SElement, type STextChange } from "../format.js";
export interface BuilderOptions {
    /** Inlined stylesheets from the replay, by URL. */
    assets?: Record<string, string>;
    /**
     * A document that renders (the player's iframe): CSSOM rules and scroll
     * positions are applied. Off for the detached document used to label actions.
     */
    live: boolean;
    /**
     * Where to load an address of the recorded page from (images, stylesheets,
     * fonts, backgrounds). Gets the absolute URL; return another (a proxy on
     * your own origin, say). Default: the URL itself.
     */
    resolveUrl?: (url: string) => string | null;
    /** Nodes one snapshot and its changes may create, at most. Default 500,000. */
    maxNodes?: number;
}
/**
 * Rebuilds a recorded page in a document. Node ids are assigned in the same
 * order the recorder assigned them: document order within a snapshot, then
 * counting up from `firstNewId` for each mutation.
 */
export declare class DomBuilder {
    readonly doc: Document;
    readonly options: BuilderOptions;
    nodes: (Node | undefined)[];
    private next;
    private deferred;
    /** The document scroll position last applied, re-applied when stylesheets load. */
    private docScroll;
    /** The recorded page's address, which relative addresses resolve against. */
    private base;
    constructor(doc: Document, options: BuilderOptions);
    /** Replace the document's content with a snapshot of the page at `href`. */
    snapshot(tree: SElement, href: string, scrollX?: number, scrollY?: number): void;
    mutate(firstNewId: number, removes?: number[], adds?: SAdd[], attrs?: SAttrChange[], texts?: STextChange[]): void;
    input(id: number, value: string | number): void;
    scroll(id: number, x: number, y: number): void;
    cssRule(id: number, index: number, rule?: string): void;
    /** Where the page is scrolled to, for re-applying once styles have loaded. */
    restoreScroll(): void;
    private view;
    private scrollDocument;
    private assign;
    /** An address of the recorded page as the player loads it, or null when it must not be loaded. */
    url(value: string): string | null;
    /** A stylesheet with its addresses resolved. */
    css(text: string): string;
    private srcset;
    private create;
    private asset;
    private setAttrs;
    private setState;
    private runDeferred;
}
