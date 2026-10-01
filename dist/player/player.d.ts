import { type Replay, type ReplayEvent } from "../format.js";
import { type Action } from "./actions.js";
export interface PlayerOptions {
    /** Start playing at once. Default false. */
    autoplay?: boolean;
    /** Playback speed. Default 1. */
    speed?: number;
    /** Jump over quiet stretches (more than 2.5 s without anything happening). Default true. */
    skipIdle?: boolean;
    /** Show the action list next to the page. Default true. */
    showActions?: boolean;
    /** List successful network calls too (failed ones are always listed). Default false. */
    showNetwork?: boolean;
    /** Colours of the player chrome; the page itself is always shown as recorded. Default: the system's. */
    theme?: "light" | "dark";
    /** Where to start, in ms since the start of the replay. */
    startAt?: number;
    /** `fit` scales the page to the player; `1` shows it at its real size (the stage scrolls). Default `fit`. */
    zoom?: "fit" | number;
    /**
     * Draw the player's own controls, error banner and action list. False gives
     * just the page and the cursor, for a host that draws its own controls with
     * the API (`play`, `pause`, `seek`, `setSpeed`, `setZoom`, `on("time")`). Default true.
     */
    controls?: boolean;
    /**
     * Where to load the recorded page's images, stylesheets and fonts from: gets
     * the absolute URL, returns another (a proxy on your own origin, say).
     */
    resolveUrl?: (url: string) => string;
    /** Nodes a replay may create, at most (replays are untrusted input). Default 500,000. */
    maxNodes?: number;
}
type PlayerEvent = "time" | "play" | "pause" | "end" | "error";
/**
 * Plays a Chronos replay: the page as the user saw it, in a sandboxed iframe
 * (no script from the recording ever runs), with a cursor that moves to each
 * click, a timeline and the list of what the user did.
 */
export declare class ChronosPlayer {
    readonly replay: Replay;
    readonly events: ReplayEvent[];
    readonly actions: Action[];
    readonly duration: number;
    /** Set once the iframe's own document has loaded (see `ready`). */
    private builder;
    private isReady;
    /** Set when the replay could not be rebuilt; the player then stays still. */
    failure?: Error;
    private statesCheck;
    private readonly cursor;
    private emulator;
    /** The focused element's id (0: none) and whether `:focus-visible` matched. */
    private focus;
    private readonly metas;
    private readonly times;
    private readonly errors;
    private segment;
    private applied;
    private time;
    private playing;
    private speed;
    private skipIdle;
    private raf;
    private lastFrame;
    private viewport;
    private scale;
    private zoom;
    private currentAction;
    private readonly listeners;
    private readonly resizeObserver;
    private readonly root;
    private readonly stage;
    private readonly frame;
    private readonly iframe;
    private readonly cursorEl;
    private readonly rippleEl;
    private readonly banner;
    private readonly playButton;
    private readonly timeEl;
    private readonly track;
    private readonly fill;
    private readonly thumb;
    private readonly items;
    constructor(container: HTMLElement, replay: Replay, options?: PlayerOptions);
    /** Resolves when the player shows the page; calls made before then apply when it does. */
    readonly ready: Promise<void>;
    get currentTime(): number;
    get isPlaying(): boolean;
    on(event: PlayerEvent, listener: (time: number) => void): () => void;
    play(): void;
    pause(): void;
    toggle(): void;
    setSpeed(speed: number): void;
    /** `fit`, or a fixed scale (1 is the page's real size). */
    setZoom(zoom: "fit" | number): void;
    seek(time: number): void;
    destroy(): void;
    private loop;
    private nextEventAfter;
    /** Bring the iframe to the state at `t`: rebuild from the last snapshot if needed, then apply events. */
    private applyUntil;
    private loadSnapshot;
    /** Once a stylesheet loads: scroll again (the page has its height now) and adapt its rules. */
    private watchStylesheets;
    private apply;
    private render;
    /** Hover follows the cursor, press the click, focus the recorded focus. */
    private renderStates;
    private setViewport;
    private layout;
    private updatePlayButton;
    private bindTrack;
    private buildActionList;
    private highlightAction;
    private emit;
}
export {};
