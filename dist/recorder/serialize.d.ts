import type { SAttrs, SElement, SNode } from "../format.js";
export interface PrivacyOptions {
    /** Replace what people type with `*` (same length). Default true. */
    maskInputs: boolean;
    /** Text inside matching elements is replaced with `*`. */
    maskTextSelector: string;
    /** Matching elements are recorded as an empty box of the same size. */
    blockSelector: string;
    /** Inputs inside matching elements are recorded as typed (never passwords). */
    unmaskSelector: string;
}
export declare const DEFAULT_PRIVACY: PrivacyOptions;
/** Node ids for one snapshot generation. A new snapshot starts a new mirror. */
export declare class Mirror {
    private ids;
    next: number;
    id(node: Node | null | undefined): number | undefined;
    assign(node: Node): number;
}
export declare const SVG_NS = "http://www.w3.org/2000/svg";
/** Whether children of `parent` are SVG by default, as the HTML parser would decide. */
export declare function inSvg(parent: Node): boolean;
export declare function maskText(text: string): string;
export declare class Serializer {
    readonly privacy: PrivacyOptions;
    /** Called for each `<link rel=stylesheet>`, to inline its CSS. */
    private onStylesheet?;
    /** Elements whose children are not recorded (scripts, blocked elements, …). */
    readonly opaque: WeakSet<Node>;
    mirror: Mirror;
    /** The last form state recorded per control, so unchanged values are not recorded again. */
    values: WeakMap<Node, string | number>;
    constructor(privacy: PrivacyOptions, 
    /** Called for each `<link rel=stylesheet>`, to inline its CSS. */
    onStylesheet?: ((link: HTMLLinkElement) => void) | undefined);
    /** Start a new generation and serialize the whole document. */
    snapshot(doc: Document): SElement;
    /** Whether text under `parent` is masked. */
    masked(parent: Node | null): boolean;
    /**
     * Serialize a node and its subtree, assigning ids in document order.
     * `svg`: whether the parent makes its children SVG (see `inSvg()`).
     */
    node(node: Node, mask: boolean, svg?: boolean): SNode | null;
    private element;
    /** The recorded attributes of an element, including Chronos state (`$…`). */
    attributes(el: Element, tag?: string): SAttrs | undefined;
    /** One attribute as recorded, or null when it is dropped. */
    attribute(el: Element, tag: string, name: string, value: string): string | null;
    /** Live state that is not in the attributes: values, CSSOM rules, scroll. */
    state(el: Element, tag: string): SAttrs | undefined;
    /**
     * A form control's state as recorded: its text (masked), 1/0 for a checkbox
     * or radio, the selected index of a select. Undefined for anything else.
     */
    formValue(el: Element): string | number | undefined;
    /** What a text field's value is recorded as. */
    value(el: HTMLInputElement | HTMLTextAreaElement): string;
    isMasked(el: Element): boolean;
}
/**
 * Rules a `<style>` holds only in the CSSOM (CSS-in-JS libraries such as
 * emotion insert them with `insertRule`, leaving the element empty).
 */
export declare function cssomRules(style: HTMLStyleElement): string[] | undefined;
