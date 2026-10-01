import { type Codec } from "../codec.js";
import type { Replay } from "../format.js";
/** One `customEvents` row, or just its `customDimensions` (as Log Analytics returns them). */
export type AppInsightsRow = {
    customDimensions: Record<string, unknown> | string;
} | Record<string, unknown>;
/**
 * KQL that returns the rows of every replay in the time range, newest first.
 * Pass them to `assembleReplays()`.
 */
export declare const REPLAYS_KQL = "customEvents\n| where name == \"chronos.replay\"\n| extend id = tostring(customDimensions.chronosId), seq = toint(customDimensions.chronosSeq)\n| project timestamp, id, seq, customDimensions, session_Id, user_Id, cloud_RoleName\n| order by timestamp desc, id, seq asc";
export interface AssembledReplay {
    id: string;
    /** Parts received of the parts sent. A replay is complete when they match. */
    received: number;
    total: number;
    /** Only when complete. */
    data?: {
        bytes: Uint8Array;
        codec: Codec;
    };
    dimensions: Record<string, string>;
}
/** Group telemetry rows by replay and join their parts. */
export declare function assembleReplays(rows: AppInsightsRow[]): AssembledReplay[];
/** Decode one assembled replay. */
export declare function readAssembled(assembled: AssembledReplay): Promise<Replay>;
