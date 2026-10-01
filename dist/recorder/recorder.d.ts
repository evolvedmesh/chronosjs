import { type Replay, type ReplayMeta } from "../format.js";
import type { Transport } from "../transports/types.js";
import { type PrivacyOptions } from "./serialize.js";
export interface RecorderOptions {
    /** Where replays are sent. Every transport gets every replay. */
    transports: Transport[];
    meta?: ReplayMeta;
    /** History a replay keeps before the error, at least. Default 60 s. */
    bufferMs?: number;
    /** Recording kept after the error, so the replay shows how the page reacted. Default 1500 ms. */
    tailMs?: number;
    /** Replays sent per page load at most. Default 5. */
    maxReplays?: number;
    privacy?: Partial<PrivacyOptions>;
    /**
     * Copy same-origin stylesheets into the replay. Off by default: replays stay
     * small and the player loads the CSS from the app, which works until a
     * deployment removes the old files. Turn it on when replays must outlive
     * deployments.
     */
    inlineStylesheets?: boolean;
    /** Whether a response is an error worth a replay. Default: status 500 and up. */
    httpError?: (status: number, url: string) => boolean;
    /** Treat `console.error` as an error. Default false (frameworks log warnings there). */
    captureConsoleErrors?: boolean;
    /** Errors whose message matches are recorded but never trigger a replay. */
    ignoreErrors?: (string | RegExp)[];
    /** Keep the buffer across full page loads in the same tab (sessionStorage). Default true. */
    persist?: boolean;
    /** Last chance to change or drop (return null) a replay before it is sent. */
    beforeSend?: (replay: Replay) => Replay | null;
    /**
     * Pages that must never be recorded (sealed or secret information). Checked
     * on load and on every navigation; while it returns true nothing is
     * recorded, and the history before it is discarded, so no replay can hold
     * what was on that page. Gets `location.pathname`.
     */
    pauseOn?: (path: string) => boolean;
    /** Called after a replay was handed to the transports. */
    onReplay?: (replay: Replay, bytes: number) => void;
}
export declare class ChronosRecorder {
    readonly options: RecorderOptions;
    private events;
    /** Indexes of `Meta` events that start a snapshot. */
    private checkpoints;
    private readonly serializer;
    private observer?;
    private restores;
    private lastSnapshotAt;
    private pending?;
    private sent;
    private recentErrors;
    private assets;
    private scrollTimers;
    private lastScroll;
    private resizeTimer?;
    private lastPath;
    /** Why recording is paused: by the app (`pause()`), or by `pauseOn` for the page shown. */
    private paused?;
    private resumeTimer?;
    /** Where the mouse last rested, and the timer that notices it resting again. */
    private pointer?;
    private readonly bufferMs;
    private readonly tailMs;
    private readonly maxReplays;
    running: boolean;
    constructor(options: RecorderOptions);
    start(): void;
    /**
     * Stop recording and discard everything recorded so far (nothing from
     * before is ever sent). `resume()` starts again from a fresh snapshot.
     */
    pause(by?: "app" | "page"): void;
    /**
     * Record again, from a fresh snapshot taken after `delayMs` (give a page
     * that is still being replaced time to render, so the snapshot never holds
     * what was paused).
     */
    resume(delayMs?: number): void;
    get isPaused(): boolean;
    stop(): void;
    /** Report an error the app caught itself (an error boundary, a failed action). */
    captureError(error: unknown, kind?: string): void;
    /** The replay as it would be sent now, without sending it. For tests and tools. */
    takeReplay(reason?: {
        kind: string;
        message: string;
    }): Replay;
    private now;
    /** Record an event, after any DOM change that happened before it. */
    private push;
    /**
     * Report earlier DOM changes and take a due snapshot. Called before a change
     * that is not idempotent (a CSSOM rule), so a snapshot never includes the
     * change its event is about to replay again.
     */
    private prepare;
    private checkoutDue;
    /** A new starting point: a full snapshot. Older history is dropped once it is not needed. */
    private snapshot;
    /** Keep the newest checkpoint that is at least `bufferMs` old, and everything after it. */
    private trim;
    private flush;
    private onMutations;
    private on;
    /** The id of a node, or of its nearest recorded ancestor. */
    private idOf;
    private listen;
    /**
     * Scroll positions at most every 50 ms per scroller: the first at once, the
     * last within 50 ms of the scroll ending (smooth scrolling keeps going after
     * the wheel event), so the replay never lags the page by more than that.
     */
    private onScroll;
    /**
     * Mouse movement is not recorded, only its ends: the last resting point
     * when it starts moving, and the new one when it stops for 150 ms. That
     * pins where the cursor was (and what it hovered) at almost no cost.
     */
    private onPointerMove;
    private recordValue;
    private onNavigate;
    private onPageHide;
    /** History from earlier pages in this tab. */
    private restore;
    private patch;
    private ignored;
    private http;
    private error;
    private trigger;
    private send;
    private inlineStylesheet;
}
/** Make relative `url()`s in an inlined stylesheet absolute. */
export declare function rebaseCssUrls(css: string, base: string): string;
