import type { Replay } from "../format.js";
import type { EncodedReplay, Transport } from "./types.js";
/**
 * Application Insights limits that shape a replay upload:
 * - a property value holds at most 8,192 characters;
 * - one telemetry item should stay under 64 KB.
 * A replay is sent as one or more `customEvents` named `chronos.replay`,
 * each carrying up to 7 base64 parts of 8,000 characters (`d0`…`d6`).
 */
export declare const EVENT_NAME = "chronos.replay";
export declare const PART_CHARS = 8000;
export declare const PARTS_PER_ITEM = 7;
/** The part of the Application Insights web SDK the transport needs. */
export interface AppInsightsSdk {
    trackEvent(event: {
        name: string;
    }, properties?: Record<string, unknown>): void;
    flush?(async?: boolean): void;
}
export interface AppInsightsOptions {
    /**
     * The resource's connection string. Required unless `sdk` is given.
     * `IngestionEndpoint` may point at a proxy on your own domain (ad blockers
     * sometimes block the Azure endpoint).
     */
    connectionString?: string;
    /**
     * An `ApplicationInsights` instance the app already runs. Replays then go
     * through it, so they get its session, user and operation ids and its
     * telemetry initializers (redaction rules) apply to them too.
     */
    sdk?: AppInsightsSdk;
    /** `cloud_RoleName` when sending directly. */
    roleName?: string;
    /** Session and user ids when sending directly. */
    context?: () => {
        sessionId?: string;
        userId?: string;
        operationId?: string;
    };
}
interface ConnectionString {
    instrumentationKey: string;
    ingestionEndpoint: string;
}
export declare function parseConnectionString(value: string): ConnectionString;
/** The custom properties of each telemetry item a replay is split into. */
export declare function replayItems(replay: Replay, encoded: EncodedReplay): Record<string, string>[];
export declare function appInsightsTransport(options: AppInsightsOptions): Transport;
export {};
