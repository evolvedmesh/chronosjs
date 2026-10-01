import { ChronosRecorder } from "./recorder/recorder.js";
export { decodeReplay, encodeReplay, fromBase64, toBase64 } from "./codec.js";
export * from "./format.js";
export { ChronosRecorder } from "./recorder/recorder.js";
export { DEFAULT_PRIVACY } from "./recorder/serialize.js";
export { appInsightsTransport, EVENT_NAME, parseConnectionString, replayItems, } from "./transports/appinsights.js";
export { httpTransport } from "./transports/http.js";
let current;
/**
 * Start recording (once per page; later calls return the running recorder).
 * Does nothing on the server.
 */
export function record(options) {
    if (typeof window === "undefined")
        return undefined;
    if (current?.running)
        return current;
    current = new ChronosRecorder(options);
    current.start();
    return current;
}
/** Stop recording and remove every listener and patch. */
export function stopRecording() {
    current?.stop();
    current = undefined;
}
/** Report an error the app handled itself (error boundary, failed action): it triggers a replay. */
export function captureError(error, kind = "captured") {
    current?.captureError(error, kind);
}
/**
 * Stop recording and discard what was recorded, for something that must
 * never be in a replay. `resumeRecording()` starts again from a fresh snapshot.
 * For whole pages, prefer the `pauseOn` option.
 */
export function pauseRecording() {
    current?.pause("app");
}
export function resumeRecording(delayMs = 0) {
    current?.resume(delayMs);
}
export function currentRecorder() {
    return current;
}
//# sourceMappingURL=index.js.map