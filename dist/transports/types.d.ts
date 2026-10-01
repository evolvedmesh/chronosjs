import type { Codec } from "../codec.js";
import type { Replay } from "../format.js";
export interface EncodedReplay {
    bytes: Uint8Array;
    codec: Codec;
}
export interface SendContext {
    /** True while the page is being unloaded: use `keepalive` or a beacon. */
    unloading: boolean;
}
/** Where replays go. Implement this to support another telemetry service. */
export interface Transport {
    readonly name: string;
    send(replay: Replay, encoded: EncodedReplay, context: SendContext): Promise<void>;
    /** True for the transport's own requests, so the recorder doesn't record them. */
    ignores?(url: string): boolean;
}
