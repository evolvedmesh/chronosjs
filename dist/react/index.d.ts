import { type CSSProperties } from "react";
import type { Replay } from "../format.js";
import { type RecorderOptions } from "../index.js";
import { ChronosPlayer, type PlayerOptions } from "../player/index.js";
/**
 * Starts recording when mounted (once per page), stops when unmounted. Put it
 * in the root layout. Options are read on the first mount only.
 */
export declare function ChronosRecorder(props: RecorderOptions): null;
/**
 * Reports an error a boundary caught (Next.js `error.tsx`, React error
 * boundaries), which the browser never sees as uncaught.
 */
export declare function useChronosError(error: unknown, kind?: string): void;
export interface ReplayPlayerProps extends PlayerOptions {
    replay: Replay;
    className?: string;
    style?: CSSProperties;
    onReady?: (player: ChronosPlayer) => void;
}
/** The replay player as a React component. */
export declare function ReplayPlayer({ replay, className, style, onReady, ...options }: ReplayPlayerProps): import("react").JSX.Element;
export { captureError } from "../index.js";
