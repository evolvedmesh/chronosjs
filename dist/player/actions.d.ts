import { type ReplayEvent } from "../format.js";
export type ActionKind = "page" | "click" | "input" | "key" | "nav" | "http" | "error" | "visibility";
export interface Action {
    /** Milliseconds since the start of the replay. */
    t: number;
    kind: ActionKind;
    /** Plain words: "Clicked “Pay now”". */
    label: string;
    /** Extra detail (a stack, a status, a duration). */
    detail?: string;
    severity: "info" | "warning" | "error";
}
/**
 * The replay as a list of plain-language actions. The page is rebuilt in a
 * detached document (nothing loads or renders there) so each click can be
 * named after what was on screen at that moment.
 */
export declare function deriveActions(events: ReplayEvent[]): Action[];
/** What a person would call the element: its label, text or purpose. */
export declare function name(node: Node | undefined): string;
