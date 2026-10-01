/**
 * The cursor is not recorded (that would be most of a replay's size). The
 * player knows where each click landed and when, and draws a cursor that
 * glides to it the way a hand would: it waits, leaves shortly before the
 * click, follows a gentle arc with a minimum-jerk speed profile, and arrives
 * just before the button goes down.
 */
export interface PointerKey {
    /** Milliseconds since the start of the replay. */
    t: number;
    x: number;
    y: number;
    /** A click (it ripples) rather than a resting point. Default true. */
    click?: boolean;
}
export interface CursorFrame {
    x: number;
    y: number;
    /** Whether there is anything to show yet. */
    visible: boolean;
    /** 0…1 while a click's ripple is showing, -1 otherwise. */
    ripple: number;
    /** Where that ripple is. */
    rippleX: number;
    rippleY: number;
}
export declare class CursorPath {
    private readonly keys;
    private readonly segments;
    constructor(keys: PointerKey[]);
    at(t: number): CursorFrame;
}
