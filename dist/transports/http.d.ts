import type { Transport } from "./types.js";
export interface HttpTransportOptions {
    /** Absolute or same-origin URL that accepts `POST` with the encoded replay as the body. */
    url: string;
    headers?: Record<string, string>;
}
/**
 * Sends the encoded replay as is (`application/octet-stream`) to an endpoint
 * of your own. Headers: `x-chronos-id`, `x-chronos-codec`.
 */
export declare function httpTransport(options: HttpTransportOptions): Transport;
