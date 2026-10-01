import { ChronosRecorder, type RecorderOptions } from "./recorder/recorder.js";
export type { Codec, DecodeOptions } from "./codec.js";
export { decodeReplay, encodeReplay, fromBase64, toBase64 } from "./codec.js";
export * from "./format.js";
export { ChronosRecorder, type RecorderOptions } from "./recorder/recorder.js";
export { DEFAULT_PRIVACY, type PrivacyOptions } from "./recorder/serialize.js";
export { type AppInsightsOptions, type AppInsightsSdk, appInsightsTransport, EVENT_NAME, parseConnectionString, replayItems, } from "./transports/appinsights.js";
export { type HttpTransportOptions, httpTransport } from "./transports/http.js";
export type { EncodedReplay, SendContext, Transport } from "./transports/types.js";
/**
 * Start recording (once per page; later calls return the running recorder).
 * Does nothing on the server.
 */
export declare function record(options: RecorderOptions): ChronosRecorder | undefined;
/** Stop recording and remove every listener and patch. */
export declare function stopRecording(): void;
/** Report an error the app handled itself (error boundary, failed action): it triggers a replay. */
export declare function captureError(error: unknown, kind?: string): void;
/**
 * Stop recording and discard what was recorded, for something that must
 * never be in a replay. `resumeRecording()` starts again from a fresh snapshot.
 * For whole pages, prefer the `pauseOn` option.
 */
export declare function pauseRecording(): void;
export declare function resumeRecording(delayMs?: number): void;
export declare function currentRecorder(): ChronosRecorder | undefined;
